import type * as React from 'react';
import type * as mobx from 'mobx';

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	minAppVersion?: string;
	description?: string;
	author?: string;
};

export interface PluginInfo {
	manifest: PluginManifest | null;
	id: string;
	dir: string;
	hasStyles: boolean;
	error?: string;
};

export interface Command {
	id: string;
	name: string;
	icon?: string;
	hotkey?: string;
	callback?(): void;
	checkCallback?(checking: boolean): boolean;
};

export interface ViewSetting {
	id: string;
	name: string;
	type: 'switch' | 'text' | 'select';
	options?: { id: string; name: string }[];
	default?: any;
};

export interface ViewRenderProps {
	records: any[];
	relations: { key: string; name: string; format: number }[];
	view: { id: string; name: string };
	config: Record<string, any>;
	readonly: boolean;
	hasMore: boolean;
	open(id: string): void;
	update(id: string, key: string, value: any): void;
	create(details?: any): Promise<any>;
	menu(e: any, id: string): void;
	loadMore(): void;
};

export interface ViewDefinition {
	name: string;
	icon?: string;
	component?: React.FC<ViewRenderProps>;
	render?(el: HTMLElement, props: ViewRenderProps): void | (() => void);
	settings?: ViewSetting[];
};

export interface SettingTab {
	name?: string;
	render?(container: HTMLElement): void | (() => void);
	component?: React.FC<{ plugin: any }>;
};

export type EventName = 'theme-change' | 'object-open';

export interface SearchParam {
	query?: string;
	filters?: any[];
	sorts?: any[];
	limit?: number;
	keys?: string[];
};

export interface LoomApi {
	version: string;
	theme(): 'light' | 'dark';
	notice(text: string): void;
	space: {
		id(): string;
	};
	objects: {
		search(param?: SearchParam): Promise<any[]>;
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
};

export interface RegisteredView {
	key: string;
	pluginId: string;
	type: string;
	def: ViewDefinition;
};

export interface RegisteredCommand {
	key: string;
	pluginId: string;
	command: Command;
};

export interface RegisteredSettingTab {
	pluginId: string;
	tab: SettingTab;
};

/**
 * What a Plugin instance talks to. The registry implements it per plugin, so the base class never imports the registry.
 */
export interface PluginHost {
	addView(type: string, def: ViewDefinition): () => void;
	addCommand(cmd: Command): () => void;
	addSettingTab(tab: SettingTab): () => void;
	addStyle(css: string): () => void;
	addEvent(name: EventName, cb: (...args: any[]) => void): () => void;
	loadData(): Promise<any>;
	saveData(obj: any): Promise<void>;
};
