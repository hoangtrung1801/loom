import { describe, it, expect } from 'vitest';
import { parseHotkey, hotkeyCombo, findShortcutConflict } from './hotkey';
import { compareVersions } from './version';

describe('hotkey', () => {

	it('maps Mod to the platform key and lowercases the rest', () => {
		expect(parseHotkey('Mod+Shift+K', 'cmd')).toEqual([ 'cmd', 'shift', 'k' ]);
		expect(parseHotkey('Mod+Shift+K', 'ctrl')).toEqual([ 'ctrl', 'shift', 'k' ]);
		expect(parseHotkey('Control+Option+Up', 'cmd')).toEqual([ 'ctrl', 'alt', 'arrowup' ]);
		expect(hotkeyCombo(parseHotkey('Mod+J', 'cmd'))).toBe('cmd+j');
	});

	it('returns nothing for an empty hotkey', () => {
		expect(parseHotkey('', 'cmd')).toEqual([]);
		expect(parseHotkey(undefined, 'cmd')).toEqual([]);
	});

	it('finds built-in shortcuts with the same keys regardless of order', () => {
		const shortcuts = { search: { keys: [ 'cmd', 'k' ] }, none: { keys: [] } };

		expect(findShortcutConflict([ 'k', 'cmd' ], shortcuts)).toBe('search');
		expect(findShortcutConflict([ 'cmd', 'j' ], shortcuts)).toBe('');
	});

});

describe('compareVersions', () => {

	it('compares dotted versions numerically', () => {
		expect(compareVersions('0.54.11', '0.54.9')).toBe(1);
		expect(compareVersions('0.54', '0.54.0')).toBe(0);
		expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
		expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(0);
	});

});
