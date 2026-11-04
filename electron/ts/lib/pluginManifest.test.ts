import { describe, it, expect } from 'vitest';
import { isValidPluginId, validateManifest } from './pluginManifest';

describe('isValidPluginId', () => {

	it('accepts lowercase letters, digits and dashes', () => {
		expect(isValidPluginId('sample-plugin-2')).toBe(true);
	});

	it('rejects path traversal and other characters', () => {
		[ '', '..', '../x', 'a/b', 'a\\b', 'Upper', 'with space', 'dot.dot', null, undefined, 5 ].forEach(id => {
			expect(isValidPluginId(id)).toBe(false);
		});
	});

});

describe('validateManifest', () => {

	it('accepts a minimal manifest', () => {
		const res = validateManifest({ id: 'sample', name: 'Sample', version: '1.0.0' }, 'sample');

		expect(res.error).toBe('');
		expect(res.manifest).toEqual({ id: 'sample', name: 'Sample', version: '1.0.0' });
	});

	it('keeps the optional fields', () => {
		const res = validateManifest({ id: 'sample', name: 'Sample', version: '1', description: 'd', author: 'a', minAppVersion: '0.54.0', extra: 1 }, 'sample');

		expect(res.manifest).toEqual({ id: 'sample', name: 'Sample', version: '1', description: 'd', author: 'a', minAppVersion: '0.54.0' });
	});

	it('rejects an id that differs from the folder', () => {
		expect(validateManifest({ id: 'other', name: 'S', version: '1' }, 'sample').manifest).toBeNull();
	});

	it('rejects invalid ids, missing name and version, and non-objects', () => {
		expect(validateManifest({ id: 'Bad Id', name: 'S', version: '1' }, 'Bad Id').error).toBeTruthy();
		expect(validateManifest({ id: 'a', version: '1' }, 'a').error).toBeTruthy();
		expect(validateManifest({ id: 'a', name: 'A' }, 'a').error).toBeTruthy();
		expect(validateManifest(null, 'a').error).toBeTruthy();
		expect(validateManifest([], 'a').error).toBeTruthy();
	});

});
