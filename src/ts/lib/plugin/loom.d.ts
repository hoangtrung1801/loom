/**
 * Public typings for Loom plugins. Mirrors src/ts/lib/plugin/types.ts and the Plugin base class.
 * Copy this file next to your plugin source (it is also published as docs/plugin/loom.d.ts).
 */
declare module 'loom' {
	import type * as React from 'react';
	import type * as mobx from 'mobx';

	export interface PluginManifest {
		id: string;
		name: string;
		version: string;
		minAppVersion?: string;
		description?: string;
		author?: string;
	}

	export interface Command {
		id: string;
		name: string;
		icon?: string;
		/** For example "Mod+Shift+K". Mod is Cmd on macOS and Ctrl elsewhere. Built-in shortcuts win on conflicts. */
		hotkey?: string;
		callback?(): void;
		/** Called with checking = true to ask whether the command is available, then with false to run it. */
		checkCallback?(checking: boolean): boolean;
	}

	export interface ViewSetting {
		id: string;
		name: string;
		type: 'switch' | 'text' | 'select';
		options?: { id: string; name: string }[];
		default?: any;
	}

	export interface ViewRenderProps {
		/** Plain detail objects of the records the view currently shows. */
		records: any[];
		/** Visible relations (properties) of the view. */
		relations: { key: string; name: string; format: number }[];
		view: { id: string; name: string };
		/** Values of the view settings, defaults applied. */
		config: Record<string, any>;
		readonly: boolean;
		hasMore: boolean;
		open(id: string): void;
		update(id: string, key: string, value: any): void;
		create(details?: any): void;
		loadMore(): void;
	}

	export interface ViewDefinition {
		name: string;
		/** Name of an icon that exists in the app. */
		icon?: string;
		component?: React.FC<ViewRenderProps>;
		/** Vanilla alternative to component. Called again whenever the props change; return a cleanup function. */
		render?(el: HTMLElement, props: ViewRenderProps): void | (() => void);
		settings?: ViewSetting[];
	}

	export interface SettingTab {
		name?: string;
		render?(container: HTMLElement): void | (() => void);
		component?: React.FC<{ plugin: any }>;
	}

	export type EventName = 'theme-change' | 'object-open';

	export interface SearchParam {
		query?: string;
		filters?: { relationKey: string; condition: number; value: any }[];
		sorts?: { relationKey: string; type: number }[];
		limit?: number;
	}

	export interface LoomApi {
		version: string;
		theme(): 'light' | 'dark';
		notice(text: string): void;
		space: {
			id(): string;
		};
		objects: {
			search(param?: SearchParam): Promise<any[]>;
			/** Details already loaded in the app, or null. */
			get(id: string): any;
			getById(id: string): Promise<any>;
			open(id: string): void;
			update(id: string, key: string, value: any): Promise<void>;
			create(details?: any, typeKey?: string): Promise<any>;
		};
		ui: {
			openPopup(id: string, param?: any): void;
			confirm(title: string, text: string): Promise<boolean>;
		};
		React: typeof React;
		mobx: typeof mobx;
	}

	export class Plugin {
		app: LoomApi;
		manifest: PluginManifest;

		constructor (app: LoomApi, manifest: PluginManifest);

		onload (): void | Promise<void>;
		onunload (): void;

		/** Registers a database view. It is addressed as "<plugin id>:<type>". */
		registerView (type: string, def: ViewDefinition): void;
		addCommand (cmd: Command): void;
		addSettingTab (tab: SettingTab): void;
		registerEvent (name: EventName, cb: (...args: any[]) => void): void;
		/** Registers a function that runs on unload, after onunload and in reverse registration order. */
		register (disposer: () => void): void;
		/** Injects CSS, removed on unload. */
		addStyle (css: string): void;
		loadData (): Promise<any>;
		saveData (obj: any): Promise<void>;
	}
}
