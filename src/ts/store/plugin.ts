import { PluginRegistry } from 'Lib/plugin/registry';
import { createApi } from 'Lib/plugin/api';
import { injectStyle } from 'Lib/plugin/style';
import { pluginEvents } from 'Lib/plugin/events';
import Storage from 'Lib/storage';

const call = (cmd: string, ...args: any[]) => Renderer.send(cmd, ...args);

/**
 * Plugins installed on this device and what the enabled ones registered. Desktop only: in web mode every call is a no-op.
 */
export const Plugin: PluginRegistry = new PluginRegistry({
	list: () => call('pluginList'),
	read: (id: string) => call('pluginRead', id),
	dataLoad: (id: string) => call('pluginDataLoad', id),
	dataSave: (id: string, obj: any) => call('pluginDataSave', id, obj),
	openFolder: () => call('pluginOpenFolder'),
	watch: () => call('pluginWatch'),
	onChanged: cb => Renderer.on('plugins-changed', (e: any, ids: string[] | null) => cb(Array.isArray(ids) ? ids : null)),
	makeApp: manifest => createApi(manifest),
	storage: {
		get: (key: string) => Storage.get(key),
		set: (key: string, value: any) => Storage.set(key, value),
	},
	style: injectStyle,
	subscribe: (name, cb) => pluginEvents.on(name, cb),
	appVersion: () => String(U.Common.getElectron().version?.app || ''),
	isSupported: () => !(window as any).isWebVersion && !!U.Common.getElectron().Api,
});
