import fs from 'fs';
import path from 'path';

/**
 * The app's user-data folder is <app data>/loom (~/.config/loom, ~/Library/Application Support/loom,
 * %APPDATA%\loom). Earlier versions used the app's own name ("anytype"); the first launch moves that
 * folder over so nobody opens an empty library.
 */
export const USER_DATA_NAME = 'loom';

/** Folder names earlier versions used, in the order they are tried. */
export const LEGACY_USER_DATA_NAMES = [ 'anytype', 'Anytype' ];

/** What only a folder the app has actually used contains: account data or the app's settings. */
const MARKERS = [ 'data', 'devconfig.json' ];

export const hasAppData = (dir: string): boolean => MARKERS.some(name => fs.existsSync(path.join(dir, name)));

/**
 * Returns the folder to use as userData, moving a legacy folder's contents into <appData>/loom first when
 * the new folder holds no app data yet. The new folder may already exist (the loom CLI keeps its config
 * there), so contents are moved entry by entry and never over an existing entry. If the move fails before
 * the account data is across (files locked on Windows, say), the legacy folder keeps being used.
 */
export const resolveUserData = (appData: string, legacyNames: string[] = LEGACY_USER_DATA_NAMES): string => {
	const target = path.join(appData, USER_DATA_NAME);

	if (hasAppData(target)) {
		return target;
	};

	const legacy = [ ...new Set(legacyNames) ].map(name => path.join(appData, name)).find(dir => (dir != target) && hasAppData(dir));
	if (!legacy) {
		return target;
	};

	try {
		if (!fs.existsSync(target)) {
			fs.renameSync(legacy, target);
			return target;
		};

		for (const entry of fs.readdirSync(legacy)) {
			const dst = path.join(target, entry);

			if (!fs.existsSync(dst)) {
				fs.renameSync(path.join(legacy, entry), dst);
			};
		};

		if (!fs.readdirSync(legacy).length) {
			fs.rmdirSync(legacy);
		};
	} catch (e) {
		console.error('[UserData] Moving', legacy, 'to', target, 'failed:', e);
	};

	return hasAppData(target) ? target : legacy;
};
