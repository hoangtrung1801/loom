const ALIASES: Record<string, string> = {
	meta: 'cmd',
	command: 'cmd',
	control: 'ctrl',
	option: 'alt',
	esc: 'escape',
	return: 'enter',
	up: 'arrowup',
	down: 'arrowdown',
	left: 'arrowleft',
	right: 'arrowright',
};

/**
 * Turns 'Mod+Shift+K' into the lowercase key list the keyboard module understands. "Mod" is cmd on macOS and ctrl elsewhere.
 */
export const parseHotkey = (hotkey: string, mod: string): string[] => {
	const keys = String(hotkey || '').split('+').map(it => it.trim().toLowerCase()).filter(it => it);

	return keys.map(it => (it == 'mod') ? mod : (ALIASES[it] || it));
};

export const hotkeyCombo = (keys: string[]): string => keys.join('+');

const sortedKey = (keys: string[]): string => keys.slice().sort().join('+');

/**
 * Returns the id of a built-in shortcut that uses the same keys, or an empty string.
 */
export const findShortcutConflict = (keys: string[], shortcuts: Record<string, { keys?: string[] }>): string => {
	const target = sortedKey(keys);

	for (const id of Object.keys(shortcuts || {})) {
		const list = shortcuts[id]?.keys || [];

		if (list.length && (sortedKey(list) == target)) {
			return id;
		};
	};
	return '';
};
