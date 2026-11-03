import { app, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import Util from './util';
import { AppWindow } from './types';
import { isValidPluginId, validateManifest, PluginManifest } from './lib/pluginManifest';

const WATCH_DELAY = 300;
const MAX_FILE_SIZE = 16 * 1024 * 1024;

export interface PluginInfo {
	manifest: PluginManifest | null;
	id: string;
	dir: string;
	hasStyles: boolean;
	error?: string;
};

interface Watcher {
	watcher: fs.FSWatcher;
	timer: NodeJS.Timeout | null;
};

/**
 * Plugins live on the device, in <userData>/plugins/<id>/. The main process only reads and writes their files;
 * the code itself is evaluated by the renderer.
 */
class PluginManager {

	watchers: Map<number, Watcher> = new Map();

	dir (): string {
		const dir = path.join(app.getPath('userData'), 'plugins');

		try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {};
		return dir;
	};

	/**
	 * Resolves the folder of a plugin, rejecting ids that could escape the plugins folder.
	 */
	pluginDir (id: string): string {
		if (!isValidPluginId(id)) {
			throw new Error(`Invalid plugin id: ${id}`);
		};
		return path.join(this.dir(), id);
	};

	list (): PluginInfo[] {
		const root = this.dir();
		const ret: PluginInfo[] = [];

		let entries: fs.Dirent[] = [];
		try {
			entries = fs.readdirSync(root, { withFileTypes: true });
		} catch (e) {
			return ret;
		};

		entries.forEach(entry => {
			if (!entry.isDirectory() && !entry.isSymbolicLink()) {
				return;
			};

			const id = entry.name;
			const dir = path.join(root, id);
			const info: PluginInfo = { manifest: null, id, dir, hasStyles: false };

			try {
				const raw = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
				const res = validateManifest(raw, id);

				info.manifest = res.manifest;
				if (res.error) {
					info.error = res.error;
				} else
				if (!fs.existsSync(path.join(dir, 'main.js'))) {
					info.error = 'main.js not found';
				};
			} catch (e) {
				info.error = `manifest.json: ${e instanceof Error ? e.message : String(e)}`;
			};

			info.hasStyles = fs.existsSync(path.join(dir, 'styles.css'));
			ret.push(info);
		});

		return ret.sort((c1, c2) => c1.id.localeCompare(c2.id));
	};

	private readText (fp: string, optional: boolean): string {
		try {
			if (fs.statSync(fp).size > MAX_FILE_SIZE) {
				throw new Error(`File is too large: ${fp}`);
			};
			return fs.readFileSync(fp, 'utf8');
		} catch (e) {
			if (optional) {
				return '';
			};
			throw e;
		};
	};

	read (id: string): { main: string, styles: string } {
		const dir = this.pluginDir(id);

		return {
			main: this.readText(path.join(dir, 'main.js'), false),
			styles: this.readText(path.join(dir, 'styles.css'), true),
		};
	};

	dataLoad (id: string): any {
		const fp = path.join(this.pluginDir(id), 'data.json');

		try {
			return JSON.parse(fs.readFileSync(fp, 'utf8'));
		} catch (e) {
			return {};
		};
	};

	dataSave (id: string, obj: any): void {
		const fp = path.join(this.pluginDir(id), 'data.json');
		const tmp = `${fp}.tmp`;

		fs.mkdirSync(path.dirname(fp), { recursive: true });
		fs.writeFileSync(tmp, JSON.stringify(obj || {}, null, '\t'), 'utf8');
		fs.renameSync(tmp, fp);
	};

	openFolder (): void {
		shell.openPath(this.dir()).catch(err => Util.log('error', '[Plugin] openFolder', err));
	};

	watch (win: AppWindow): void {
		if (!win || win.isDestroyed() || this.watchers.has(win.id)) {
			return;
		};

		const item: Watcher = { watcher: null, timer: null };

		try {
			item.watcher = fs.watch(this.dir(), { recursive: true }, (event, name) => {
				// Plugin data is written by the plugins themselves, reloading on it would loop
				if (name && /(^|[\\/])data\.json(\.tmp)?$/.test(String(name))) {
					return;
				};

				clearTimeout(item.timer);
				item.timer = setTimeout(() => Util.sendToAllTabs(win, 'plugins-changed'), WATCH_DELAY);
			});

			item.watcher.on('error', err => Util.log('error', '[Plugin] watch', err));
		} catch (e) {
			Util.log('error', '[Plugin] watch failed', e);
			return;
		};

		const id = win.id;

		this.watchers.set(id, item);
		win.once('closed', () => this.unwatch(id));
	};

	unwatch (id: number): void {
		const item = this.watchers.get(id);

		if (item) {
			clearTimeout(item.timer);
			item.watcher?.close();
			this.watchers.delete(id);
		};
	};

};

export default new PluginManager();
