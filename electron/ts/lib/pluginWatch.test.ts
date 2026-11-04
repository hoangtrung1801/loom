import { describe, it, expect } from 'vitest';
import { classifyPluginChange, PluginChangeSet } from './pluginWatch';

describe('pluginWatch', () => {

	it('maps a file change to its plugin', () => {
		expect(classifyPluginChange('sample/main.js')).toEqual({ id: 'sample' });
		expect(classifyPluginChange('sample\\styles.css')).toEqual({ id: 'sample' });
	});

	it('ignores plugin data writes', () => {
		expect(classifyPluginChange('sample/data.json')).toEqual({ ignore: true, id: null });
		expect(classifyPluginChange('sample/data.json.tmp')).toEqual({ ignore: true, id: null });
	});

	it('asks for a full rescan when the scope is unknown or a folder itself changed', () => {
		expect(classifyPluginChange(null)).toEqual({ id: null });
		expect(classifyPluginChange('')).toEqual({ id: null });
		expect(classifyPluginChange('sample')).toEqual({ id: null });
		expect(classifyPluginChange('Bad Name/main.js')).toEqual({ id: null });
	});

	it('collects the ids of one debounce window', () => {
		const set = new PluginChangeSet();

		expect(set.add('a/main.js')).toBe(true);
		expect(set.add('b/manifest.json')).toBe(true);
		expect(set.add('a/styles.css')).toBe(true);
		expect(set.add('a/data.json')).toBe(false);
		expect(set.flush()).toEqual([ 'a', 'b' ]);
		expect(set.flush()).toEqual([]);
	});

	it('becomes a full rescan once any change has an unknown scope', () => {
		const set = new PluginChangeSet();

		set.add('a/main.js');
		set.add('c');
		expect(set.flush()).toBeNull();
	});

	it('attributes changes reported by a per-plugin watcher to that plugin', () => {
		const set = new PluginChangeSet();

		expect(set.add('main.js', 'a')).toBe(true);
		expect(set.add(null, 'b')).toBe(true);
		expect(set.add('data.json', 'a')).toBe(false);
		expect(set.flush()).toEqual([ 'a', 'b' ]);
	});

});
