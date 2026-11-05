import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginRegistry, RegistryDeps, STORAGE_ENABLED, STORAGE_RESTRICTED } from './registry';

const HELLO = `
	const { Plugin } = require('loom');
	module.exports = class extends Plugin {
		async onload () {
			globalThis.__log.push('load');
			this.registerView('progress', { name: 'Progress', component: () => null });
			this.addCommand({ id: 'hello', name: 'Hello', hotkey: 'Mod+Shift+H', callback: () => globalThis.__log.push('hello') });
			this.addCommand({ id: 'hidden', name: 'Hidden', checkCallback: (checking) => {
				if (globalThis.__available) {
					if (!checking) globalThis.__log.push('hidden');
					return true;
				}
				return false;
			} });
			this.addSettingTab({ name: 'Hello', render: () => {} });
			this.addStyle('.x { color: red; }');
			this.registerEvent('theme-change', (theme) => globalThis.__log.push('theme ' + theme));
		}
		onunload () {
			globalThis.__log.push('unload');
		}
	};
`;

const BROKEN = `
	const { Plugin } = require('loom');
	module.exports = class extends Plugin {
		onload () { throw new Error('boom in onload'); }
	};
`;

const info = (id: string, error?: string) => ({
	id,
	dir: `/plugins/${id}`,
	hasStyles: false,
	manifest: { id, name: id, version: '1.0.0' },
	error,
});

const setup = (code: Record<string, string>, storage: Record<string, any> = {}) => {
	const listeners: Record<string, ((...args: any[]) => void)[]> = {};
	const styles: Set<string> = new Set();
	const changed: ((ids: string[] | null) => void)[] = [];
	const deps: RegistryDeps = {
		list: vi.fn(async () => Object.keys(code).map(id => info(id))),
		read: vi.fn(async (id: string) => ({ main: code[id], styles: '' })),
		dataLoad: vi.fn(async () => ({})),
		dataSave: vi.fn(async () => {}),
		openFolder: vi.fn(),
		watch: vi.fn(),
		onChanged: (cb) => changed.push(cb),
		makeApp: () => ({} as any),
		storage: { get: (key: string) => storage[key], set: (key: string, value: any) => { storage[key] = value; } },
		style: (id: string, css: string) => { styles.add(`${id}:${css}`); return () => styles.delete(`${id}:${css}`); },
		subscribe: (name, cb) => {
			(listeners[name] = listeners[name] || []).push(cb);
			return () => { listeners[name] = listeners[name].filter(it => it !== cb); };
		},
		appVersion: () => '0.54.11',
		isSupported: () => true,
	};

	return { registry: new PluginRegistry(deps), deps, storage, listeners, styles, changed };
};

beforeEach(() => {
	(globalThis as any).__log = [];
	(globalThis as any).__available = false;
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('PluginRegistry', () => {

	it('starts in restricted mode and loads nothing', async () => {
		const { registry } = setup({ hello: HELLO }, { [STORAGE_ENABLED]: [ 'hello' ] });

		await registry.init();

		expect(registry.restricted).toBe(true);
		expect(registry.getList().map(it => it.id)).toEqual([ 'hello' ]);
		expect(registry.get('hello').loaded).toBe(false);
		expect((globalThis as any).__log).toEqual([]);
		expect(registry.getViews()).toEqual([]);
	});

	it('loads the enabled plugins when restricted mode is off', async () => {
		const { registry, styles } = setup({ hello: HELLO, other: HELLO }, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'hello' ] });

		await registry.init();

		expect(registry.get('hello').loaded).toBe(true);
		expect(registry.get('other').loaded).toBe(false);
		expect(registry.getView('hello:progress').def.name).toBe('Progress');
		expect(registry.getCommands().map(it => it.key)).toEqual([ 'hello:hello', 'hello:hidden' ]);
		expect(registry.getSettingTab('hello')).toBeTruthy();
		expect(Array.from(styles)).toEqual([ 'hello:.x { color: red; }' ]);
	});

	it('enables and disables a plugin and persists the choice', async () => {
		const { registry, storage } = setup({ hello: HELLO }, { [STORAGE_RESTRICTED]: false });

		await registry.init();
		await registry.enable('hello');

		expect(registry.get('hello').loaded).toBe(true);
		expect(storage[STORAGE_ENABLED]).toEqual([ 'hello' ]);

		registry.disable('hello');

		expect(registry.get('hello').loaded).toBe(false);
		expect(registry.get('hello').enabled).toBe(false);
		expect(storage[STORAGE_ENABLED]).toEqual([]);
		expect(registry.getViews()).toEqual([]);
		expect(registry.getCommands()).toEqual([]);
		expect(registry.getSettingTab('hello')).toBeUndefined();
		expect((globalThis as any).__log).toEqual([ 'load', 'unload' ]);
	});

	it('removes everything a plugin registered, including styles and event handlers', async () => {
		const { registry, styles, listeners } = setup({ hello: HELLO }, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'hello' ] });

		await registry.init();
		listeners['theme-change'].forEach(cb => cb('dark'));
		expect((globalThis as any).__log).toContain('theme dark');

		registry.disable('hello');

		expect(styles.size).toBe(0);
		expect(listeners['theme-change']).toEqual([]);
	});

	it('reloads a plugin', async () => {
		const { registry } = setup({ hello: HELLO }, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'hello' ] });

		await registry.init();
		await registry.reload('hello');

		expect((globalThis as any).__log).toEqual([ 'load', 'unload', 'load' ]);
		expect(registry.get('hello').loaded).toBe(true);
	});

	it('reloads everything when the scope of a folder change is unknown', async () => {
		const { registry, changed, deps } = setup({ hello: HELLO }, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'hello' ] });

		await registry.init();
		changed.forEach(cb => cb(null));
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(deps.list).toHaveBeenCalledTimes(2);
		expect((globalThis as any).__log.filter((it: string) => it == 'load').length).toBe(2);
	});

	it('reloads only the plugins whose files changed', async () => {
		const code = { hello: HELLO, other: HELLO.replace(/'load'/, "'load other'").replace(/'unload'/, "'unload other'") };
		const { registry, changed } = setup(code, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'hello', 'other' ] });

		await registry.init();
		(globalThis as any).__log = [];

		changed.forEach(cb => cb([ 'other' ]));
		await new Promise(resolve => setTimeout(resolve, 0));

		expect((globalThis as any).__log).toEqual([ 'unload other', 'load other' ]);
		expect(registry.get('hello').loaded).toBe(true);
		expect(registry.get('other').loaded).toBe(true);
	});

	it('keeps a runtime error through an unrelated change, retries after its own change or a manual reload', async () => {
		const code = { hello: HELLO, broken: BROKEN };
		const { registry, changed } = setup(code, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'hello', 'broken' ] });
		const flush = () => new Promise(resolve => setTimeout(resolve, 0));

		await registry.init();
		expect(registry.get('broken').error).toBe('boom in onload');

		// An edit of another plugin, or a change of unknown scope, does not retry it
		changed.forEach(cb => cb([ 'hello' ]));
		await flush();
		expect(registry.get('broken').error).toBe('boom in onload');

		changed.forEach(cb => cb(null));
		await flush();
		expect(registry.get('broken').error).toBe('boom in onload');
		expect(registry.get('hello').loaded).toBe(true);

		// Fixing the plugin's own file retries it
		code.broken = HELLO;
		changed.forEach(cb => cb([ 'broken' ]));
		await flush();
		expect(registry.get('broken').error).toBe('');
		expect(registry.get('broken').loaded).toBe(true);

		// The Reload button retries everything
		code.broken = BROKEN;
		changed.forEach(cb => cb([ 'broken' ]));
		await flush();
		expect(registry.get('broken').error).toBe('boom in onload');

		code.broken = HELLO;
		await registry.reloadAll();
		expect(registry.get('broken').loaded).toBe(true);
	});

	it('unloads a plugin whose folder disappeared', async () => {
		const code: Record<string, string> = { hello: HELLO };
		const { registry, changed } = setup(code, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'hello' ] });

		await registry.init();
		delete code.hello;
		changed.forEach(cb => cb(null));
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(registry.get('hello')).toBeUndefined();
		expect(registry.getViews()).toEqual([]);
		expect((globalThis as any).__log).toEqual([ 'load', 'unload' ]);
	});

	it('turning restricted mode on unloads plugins, turning it off loads them', async () => {
		const { registry, storage } = setup({ hello: HELLO }, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'hello' ] });

		await registry.init();
		registry.setRestricted(true);

		expect(storage[STORAGE_RESTRICTED]).toBe(true);
		expect(registry.get('hello').loaded).toBe(false);
		expect(registry.getViews()).toEqual([]);

		registry.setRestricted(false);
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(registry.get('hello').loaded).toBe(true);
	});

	it('marks a plugin as errored when onload throws and keeps the others running', async () => {
		const { registry } = setup({ hello: HELLO, broken: BROKEN }, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'hello', 'broken' ] });

		await registry.init();

		expect(registry.get('broken').loaded).toBe(false);
		expect(registry.get('broken').error).toBe('boom in onload');
		expect(registry.get('hello').loaded).toBe(true);
	});

	it('reports a manifest error and a missing minimum app version without loading', async () => {
		const { registry, deps } = setup({ bad: HELLO, newer: HELLO }, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'bad', 'newer' ] });

		(deps.list as any).mockResolvedValue([
			info('bad', 'id must match the folder name'),
			{ ...info('newer'), manifest: { id: 'newer', name: 'newer', version: '1', minAppVersion: '9.0.0' } },
		]);

		await registry.init();

		expect(registry.get('bad').error).toBe('id must match the folder name');
		expect(registry.get('newer').error).toContain('9.0.0');
		expect(deps.read).not.toHaveBeenCalled();
	});

	it('disables a plugin for the session when its command throws', async () => {
		const code = `
			const { Plugin } = require('loom');
			module.exports = class extends Plugin {
				onload () { this.addCommand({ id: 'bad', name: 'Bad', callback: () => { throw new Error('command failed'); } }); }
			};
		`;
		const { registry } = setup({ bad: code }, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'bad' ] });

		await registry.init();

		expect(registry.runCommand('bad:bad')).toBe(false);
		expect(registry.get('bad').error).toBe('command failed');
		expect(registry.get('bad').loaded).toBe(false);
		expect(registry.getCommands()).toEqual([]);
	});

	it('hides commands whose checkCallback says no and runs them when available', async () => {
		const { registry } = setup({ hello: HELLO }, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'hello' ] });

		await registry.init();

		const hidden = registry.getCommands().find(it => it.key == 'hello:hidden');

		expect(registry.isCommandAvailable(hidden)).toBe(false);
		expect(registry.runCommand('hello:hidden')).toBe(false);

		(globalThis as any).__available = true;

		expect(registry.isCommandAvailable(hidden)).toBe(true);
		expect(registry.runCommand('hello:hidden')).toBe(true);
		expect((globalThis as any).__log).toContain('hidden');
	});

	it('runs a plain command callback', async () => {
		const { registry } = setup({ hello: HELLO }, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'hello' ] });

		await registry.init();

		expect(registry.runCommand('hello:hello')).toBe(true);
		expect(registry.runCommand('hello:missing')).toBe(false);
		expect((globalThis as any).__log).toContain('hello');
	});

	it('lets built-in shortcuts win over plugin hotkeys and the first plugin keep a shared combo', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { registry } = setup({ hello: HELLO }, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'hello' ] });

		await registry.init();

		expect(registry.getHotkeys('cmd', {})).toEqual([ { combo: 'cmd+shift+h', key: 'hello:hello' } ]);
		expect(registry.getHotkeys('cmd', { other: { keys: [ 'cmd', 'shift', 'h' ] } })).toEqual([]);

		registry.getHotkeys('cmd', { other: { keys: [ 'cmd', 'shift', 'h' ] } });
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('applies user hotkey overrides and lets an empty one disable the command hotkey', async () => {
		const { registry } = setup({ hello: HELLO }, { [STORAGE_RESTRICTED]: false, [STORAGE_ENABLED]: [ 'hello' ] });

		await registry.init();

		expect(registry.getHotkeys('cmd', {}, { 'hello:hello': [ 'cmd', 'alt', 'j' ] })).toEqual([ { combo: 'cmd+alt+j', key: 'hello:hello' } ]);
		expect(registry.getHotkeys('cmd', {}, { 'hello:hello': [] })).toEqual([]);
	});

	it('does nothing where plugins are not supported', async () => {
		const { registry, deps } = setup({ hello: HELLO });

		(deps.isSupported as any) = () => false;
		await registry.init();

		expect(deps.list).not.toHaveBeenCalled();
		expect(registry.getList()).toEqual([]);
	});

});
