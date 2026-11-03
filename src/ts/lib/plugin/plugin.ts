import type { LoomApi, PluginManifest, PluginHost, ViewDefinition, Command, SettingTab, EventName } from './types';

/**
 * Base class of every plugin. A plugin module exports a subclass:
 *
 *   const { Plugin } = require('loom');
 *   module.exports = class extends Plugin { onload () { ... } };
 *
 * Everything registered through the register* / add* methods is undone on unload, in reverse order.
 */
export class Plugin {

	app: LoomApi;
	manifest: PluginManifest;
	private host: PluginHost | null;
	private disposers: (() => void)[] = [];

	constructor (app: LoomApi, manifest: PluginManifest, host?: PluginHost) {
		this.app = app;
		this.manifest = manifest;
		this.host = host || null;
	};

	onload (): void | Promise<void> {};

	onunload (): void {};

	registerView (type: string, def: ViewDefinition): void {
		this.register(this.requireHost().addView(type, def));
	};

	addCommand (cmd: Command): void {
		this.register(this.requireHost().addCommand(cmd));
	};

	addSettingTab (tab: SettingTab): void {
		this.register(this.requireHost().addSettingTab(tab));
	};

	registerEvent (name: EventName, cb: (...args: any[]) => void): void {
		this.register(this.requireHost().addEvent(name, cb));
	};

	addStyle (css: string): void {
		this.register(this.requireHost().addStyle(css));
	};

	register (disposer: () => void): void {
		if ('function' == typeof(disposer)) {
			this.disposers.push(disposer);
		};
	};

	loadData (): Promise<any> {
		return this.requireHost().loadData();
	};

	saveData (obj: any): Promise<void> {
		return this.requireHost().saveData(obj);
	};

	/**
	 * Runs onunload and then every disposer in reverse order. A failing step never stops the rest.
	 */
	unloadInternal (): void {
		try {
			this.onunload();
		} catch (e) {
			console.error(`[Plugin] ${this.manifest?.id}: onunload failed`, e);
		};

		const list = this.disposers.slice().reverse();

		this.disposers = [];
		list.forEach(fn => {
			try {
				fn();
			} catch (e) {
				console.error(`[Plugin] ${this.manifest?.id}: dispose failed`, e);
			};
		});
	};

	private requireHost (): PluginHost {
		if (!this.host) {
			throw new Error(`Plugin ${this.manifest?.id}: not attached to the app`);
		};
		return this.host;
	};

};
