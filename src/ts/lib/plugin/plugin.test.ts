import { describe, it, expect, vi } from 'vitest';
import { Plugin } from './plugin';
import type { PluginHost } from './types';

const manifest = { id: 'test', name: 'Test', version: '1.0.0' };

const makeHost = (log: string[]): PluginHost => ({
	addView: (type) => { log.push(`add view ${type}`); return () => log.push(`remove view ${type}`); },
	addCommand: (cmd) => { log.push(`add command ${cmd.id}`); return () => log.push(`remove command ${cmd.id}`); },
	addSettingTab: () => { log.push('add tab'); return () => log.push('remove tab'); },
	addStyle: () => { log.push('add style'); return () => log.push('remove style'); },
	addEvent: (name) => { log.push(`add event ${name}`); return () => log.push(`remove event ${name}`); },
	loadData: async () => ({ saved: true }),
	saveData: async () => {},
});

describe('Plugin', () => {

	it('runs onunload first and then the disposers in reverse order', () => {
		const log: string[] = [];

		class Test extends Plugin {
			onload () {
				this.addStyle('a { color: red; }');
				this.registerView('progress', { name: 'Progress' });
				this.addCommand({ id: 'hello', name: 'Hello', callback: () => {} });
				this.register(() => log.push('custom'));
			};
			onunload () {
				log.push('onunload');
			};
		};

		const plugin = new Test({} as any, manifest, makeHost(log));

		plugin.onload();
		log.length = 0;
		plugin.unloadInternal();

		expect(log).toEqual([ 'onunload', 'custom', 'remove command hello', 'remove view progress', 'remove style' ]);
	});

	it('keeps disposing when one of them throws', () => {
		const log: string[] = [];
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const plugin = new Plugin({} as any, manifest, makeHost(log));

		plugin.register(() => log.push('first'));
		plugin.register(() => { throw new Error('boom'); });
		plugin.register(() => log.push('last'));
		plugin.unloadInternal();

		expect(log).toEqual([ 'last', 'first' ]);
		error.mockRestore();
	});

	it('runs the disposers only once', () => {
		const fn = vi.fn();
		const plugin = new Plugin({} as any, manifest, makeHost([]));

		plugin.register(fn);
		plugin.unloadInternal();
		plugin.unloadInternal();

		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('loads and saves data through the host', async () => {
		const plugin = new Plugin({} as any, manifest, makeHost([]));

		expect(await plugin.loadData()).toEqual({ saved: true });
	});

	it('throws when it is not attached to the app', () => {
		expect(() => new Plugin({} as any, manifest).addStyle('')).toThrow('not attached');
	});

});
