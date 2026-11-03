import { observable, runInAction } from 'mobx';
import type {
	LoomApi, PluginInfo, PluginManifest, PluginHost, ViewDefinition, Command, SettingTab, EventName,
	RegisteredView, RegisteredCommand, RegisteredSettingTab,
} from './types';
import type { Plugin } from './plugin';
import { evaluate } from './loader';
import { compareVersions } from './version';
import { parseHotkey, hotkeyCombo, findShortcutConflict } from './hotkey';

export const STORAGE_RESTRICTED = 'pluginsRestricted';
export const STORAGE_ENABLED = 'pluginsEnabled';

export interface PluginRecord {
	id: string;
	manifest: PluginManifest | null;
	dir: string;
	hasStyles: boolean;
	enabled: boolean;
	loaded: boolean;
	error: string;
};

export interface RegistryDeps {
	list(): Promise<PluginInfo[]>;
	read(id: string): Promise<{ main: string; styles: string }>;
	dataLoad(id: string): Promise<any>;
	dataSave(id: string, obj: any): Promise<void>;
	openFolder(): void;
	watch(): void;
	onChanged(cb: () => void): void;
	makeApp(manifest: PluginManifest): LoomApi;
	storage: { get(key: string): any; set(key: string, value: any): void };
	style(id: string, css: string): () => void;
	subscribe(name: EventName, cb: (...args: any[]) => void): () => void;
	appVersion(): string;
	isSupported(): boolean;
};

/**
 * Knows every installed plugin, loads the enabled ones and holds what they registered (views, commands, settings tabs).
 * Plugin code is only evaluated when restricted mode is off.
 */
export class PluginRegistry {

	plugins: Map<string, PluginRecord> = observable.map({}, { deep: false });
	views: Map<string, RegisteredView> = observable.map({}, { deep: false });
	commands: Map<string, RegisteredCommand> = observable.map({}, { deep: false });
	settingTabs: Map<string, RegisteredSettingTab> = observable.map({}, { deep: false });
	state = observable({ restricted: true, ready: false });
	settingsTarget = observable.box('');

	private instances: Map<string, Plugin> = new Map();
	private tokens: Map<string, number> = new Map();
	private deps: RegistryDeps;
	private enabledIds: Set<string> = new Set();
	private warned: Set<string> = new Set();

	constructor (deps: RegistryDeps) {
		this.deps = deps;
	};

	get restricted (): boolean {
		return this.state.restricted;
	};

	get isSupported (): boolean {
		return this.deps.isSupported();
	};

	/**
	 * Reads the persisted settings, starts watching the folder and loads the enabled plugins. Called once after sign in.
	 */
	async init (): Promise<void> {
		if (!this.isSupported || this.state.ready) {
			return;
		};

		const restricted = this.deps.storage.get(STORAGE_RESTRICTED);
		const enabled = this.deps.storage.get(STORAGE_ENABLED);

		this.enabledIds = new Set(Array.isArray(enabled) ? enabled : []);

		runInAction(() => {
			this.state.restricted = (restricted !== false);
			this.state.ready = true;
		});

		this.deps.onChanged(() => this.reloadAll());
		this.deps.watch();

		await this.reloadAll();
	};

	/**
	 * Unloads everything, rescans the plugins folder and loads the enabled plugins again.
	 */
	async reloadAll (): Promise<void> {
		if (!this.isSupported) {
			return;
		};

		this.unloadAll();
		await this.refresh();

		if (!this.restricted) {
			await Promise.all(Array.from(this.plugins.keys()).map(id => this.load(id)));
		};
	};

	async refresh (): Promise<void> {
		let list: PluginInfo[] = [];

		try {
			list = (await this.deps.list()) || [];
		} catch (e) {
			console.error('[Plugin] list failed', e);
		};

		runInAction(() => {
			const ids = new Set(list.map(it => it.id));

			Array.from(this.plugins.keys()).forEach(id => {
				if (!ids.has(id)) {
					this.plugins.delete(id);
				};
			});

			list.forEach(info => {
				this.plugins.set(info.id, {
					id: info.id,
					manifest: info.manifest,
					dir: info.dir,
					hasStyles: info.hasStyles,
					enabled: this.enabledIds.has(info.id),
					loaded: this.instances.has(info.id),
					error: info.error || '',
				});
			});
		});
	};

	getList (): PluginRecord[] {
		return Array.from(this.plugins.values());
	};

	get (id: string): PluginRecord | undefined {
		return this.plugins.get(id);
	};

	setRestricted (v: boolean): void {
		this.deps.storage.set(STORAGE_RESTRICTED, v);

		runInAction(() => {
			this.state.restricted = v;
		});

		if (v) {
			this.unloadAll();
		} else {
			this.getList().forEach(it => this.load(it.id));
		};
	};

	async enable (id: string): Promise<void> {
		this.enabledIds.add(id);
		this.saveEnabled();
		this.patch(id, { enabled: true, error: '' });

		if (!this.restricted) {
			await this.load(id);
		};
	};

	disable (id: string): void {
		this.enabledIds.delete(id);
		this.saveEnabled();
		this.unload(id);
		this.patch(id, { enabled: false, error: '' });
	};

	async reload (id: string): Promise<void> {
		this.unload(id);
		await this.refresh();

		if (!this.restricted) {
			await this.load(id);
		};
	};

	openFolder (): void {
		this.deps.openFolder();
	};

	getView (key: string): RegisteredView | undefined {
		return this.views.get(key);
	};

	getViews (): RegisteredView[] {
		return this.restricted ? [] : Array.from(this.views.values());
	};

	getCommands (): RegisteredCommand[] {
		return Array.from(this.commands.values());
	};

	/**
	 * Hotkeys of the registered commands. Built-in shortcuts always win and the first plugin to claim a combo keeps it;
	 * each conflict is logged once.
	 */
	getHotkeys (mod: string, shortcuts: Record<string, { keys?: string[] }>): { combo: string; key: string }[] {
		const ret: { combo: string; key: string }[] = [];
		const used: Map<string, string> = new Map();

		this.commands.forEach(item => {
			const keys = parseHotkey(item.command.hotkey, mod);

			if (!keys.length) {
				return;
			};

			const combo = hotkeyCombo(keys);
			const builtIn = findShortcutConflict(keys, shortcuts);
			const owner = used.get(combo);

			if (builtIn || owner) {
				this.warnOnce(`${item.key}|${combo}`, `[Plugin] ${item.key}: hotkey "${item.command.hotkey}" is already used by ${builtIn ? `the "${builtIn}" shortcut` : `"${owner}"`}`);
				return;
			};

			used.set(combo, item.key);
			ret.push({ combo, key: item.key });
		});

		return ret;
	};

	private warnOnce (id: string, message: string): void {
		if (!this.warned.has(id)) {
			this.warned.add(id);
			console.warn(message);
		};
	};

	getSettingTab (pluginId: string): RegisteredSettingTab | undefined {
		return this.settingTabs.get(pluginId);
	};

	/**
	 * Whether a command can run right now. checkCallback(true) only asks, it never runs the command.
	 */
	isCommandAvailable (item: RegisteredCommand): boolean {
		const { checkCallback } = item.command;

		if (!checkCallback) {
			return true;
		};

		try {
			return !!checkCallback.call(item.command, true);
		} catch (e) {
			this.fail(item.pluginId, e);
			return false;
		};
	};

	/**
	 * Runs a command by its key ("pluginId:commandId"). Returns false when it is unknown or unavailable.
	 */
	runCommand (key: string): boolean {
		const item = this.commands.get(key);

		if (!item) {
			return false;
		};

		const { command, pluginId } = item;

		try {
			if (command.checkCallback) {
				const ret = !!command.checkCallback.call(command, true);

				if (ret) {
					command.checkCallback.call(command, false);
				};
				return ret;
			};

			if (command.callback) {
				const ret: any = command.callback.call(command);

				if (ret && ('function' == typeof(ret.catch))) {
					ret.catch((e: any) => this.fail(pluginId, e));
				};
				return true;
			};
		} catch (e) {
			this.fail(pluginId, e);
		};
		return false;
	};

	/**
	 * Runs a piece of plugin code. A throw disables the plugin for the session.
	 */
	guard<T> (pluginId: string, fn: () => T, fallback?: T): T {
		try {
			const ret: any = fn();

			if (ret && ('function' == typeof(ret.then)) && ('function' == typeof(ret.catch))) {
				ret.catch((e: any) => this.fail(pluginId, e));
			};
			return ret;
		} catch (e) {
			this.fail(pluginId, e);
			return fallback;
		};
	};

	/**
	 * A plugin threw: remember the error, unload it and keep it off until the next reload.
	 */
	fail (id: string, error: any): void {
		const message = (error instanceof Error) ? error.message : String(error);

		console.error(`[Plugin] ${id}:`, error);

		this.unload(id);
		this.patch(id, { error: message });
	};

	private saveEnabled (): void {
		this.deps.storage.set(STORAGE_ENABLED, Array.from(this.enabledIds));
	};

	private patch (id: string, data: Partial<PluginRecord>): void {
		const item = this.plugins.get(id);

		if (item) {
			runInAction(() => this.plugins.set(id, { ...item, ...data }));
		};
	};

	private nextToken (id: string): number {
		const n = (this.tokens.get(id) || 0) + 1;

		this.tokens.set(id, n);
		return n;
	};

	/**
	 * Evaluates and starts one plugin, if it is installed, valid, enabled and not blocked by restricted mode.
	 */
	async load (id: string): Promise<void> {
		const item = this.plugins.get(id);

		if (this.restricted || !item || !item.manifest || !item.enabled || item.loaded || this.instances.has(id)) {
			return;
		};

		if (item.error) {
			return;
		};

		const { manifest } = item;

		if (manifest.minAppVersion && (compareVersions(this.deps.appVersion(), manifest.minAppVersion) < 0)) {
			this.patch(id, { error: `Requires app version ${manifest.minAppVersion}` });
			return;
		};

		const token = this.nextToken(id);

		try {
			const { main, styles } = await this.deps.read(id);

			if (this.tokens.get(id) !== token) {
				return;
			};

			const Ctor = evaluate(id, main);
			const plugin = new Ctor(this.deps.makeApp(manifest), manifest, this.createHost(id));

			this.instances.set(id, plugin);

			if (styles) {
				plugin.addStyle(styles);
			};

			await plugin.onload();

			if (this.tokens.get(id) !== token) {
				plugin.unloadInternal();
				this.instances.delete(id);
				return;
			};

			this.patch(id, { loaded: true, error: '' });
		} catch (e) {
			if (this.tokens.get(id) === token) {
				this.fail(id, e);
			};
		};
	};

	unload (id: string): void {
		this.nextToken(id);

		const plugin = this.instances.get(id);

		this.instances.delete(id);
		plugin?.unloadInternal();

		// Whatever the plugin left behind (it may have thrown halfway through onload)
		runInAction(() => {
			[ this.views, this.commands ].forEach((map: Map<string, any>) => {
				Array.from(map.entries()).forEach(([ key, value ]) => {
					if (value.pluginId == id) {
						map.delete(key);
					};
				});
			});
			this.settingTabs.delete(id);
		});

		const item = this.plugins.get(id);
		if (item?.loaded) {
			this.patch(id, { loaded: false });
		};
	};

	unloadAll (): void {
		Array.from(new Set([ ...this.instances.keys(), ...this.plugins.keys() ])).forEach(id => this.unload(id));
	};

	private createHost (id: string): PluginHost {
		return {
			addView: (type: string, def: ViewDefinition) => {
				const key = `${id}:${type}`;
				const item: RegisteredView = { key, pluginId: id, type, def };

				runInAction(() => this.views.set(key, item));
				return () => runInAction(() => {
					if (this.views.get(key) === item) {
						this.views.delete(key);
					};
				});
			},

			addCommand: (command: Command) => {
				const key = `${id}:${command.id}`;
				const item: RegisteredCommand = { key, pluginId: id, command };

				runInAction(() => this.commands.set(key, item));
				return () => runInAction(() => {
					if (this.commands.get(key) === item) {
						this.commands.delete(key);
					};
				});
			},

			addSettingTab: (tab: SettingTab) => {
				const item: RegisteredSettingTab = { pluginId: id, tab };

				runInAction(() => this.settingTabs.set(id, item));
				return () => runInAction(() => {
					if (this.settingTabs.get(id) === item) {
						this.settingTabs.delete(id);
					};
				});
			},

			addStyle: (css: string) => this.deps.style(id, css),

			addEvent: (name: EventName, cb: (...args: any[]) => void) => {
				return this.deps.subscribe(name, (...args: any[]) => this.guard(id, () => cb(...args)));
			},

			loadData: async () => (await this.deps.dataLoad(id)) || {},
			saveData: async (obj: any) => {
				await this.deps.dataSave(id, obj);
			},
		};
	};

};
