export const PLUGIN_ID_REGEX = /^[a-z0-9-]+$/;

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	minAppVersion?: string;
	description?: string;
	author?: string;
};

export interface PluginManifestResult {
	manifest: PluginManifest | null;
	error: string;
};

/**
 * Whether the value can be used as a plugin id (also a folder name, so it must never contain a path separator).
 */
export const isValidPluginId = (id: any): boolean => {
	return (typeof id == 'string') && PLUGIN_ID_REGEX.test(id);
};

const optionalString = (v: any): string | undefined => {
	return (typeof v == 'string') ? v : undefined;
};

/**
 * Validates a parsed manifest.json. The id has to match the folder the plugin lives in.
 */
export const validateManifest = (raw: any, folder: string): PluginManifestResult => {
	if (!raw || (typeof raw != 'object') || Array.isArray(raw)) {
		return { manifest: null, error: 'manifest.json must contain an object' };
	};

	if (!isValidPluginId(raw.id)) {
		return { manifest: null, error: 'id must match /^[a-z0-9-]+$/' };
	};

	if (raw.id !== folder) {
		return { manifest: null, error: `id "${raw.id}" must match the folder name "${folder}"` };
	};

	if ((typeof raw.name != 'string') || !raw.name.trim()) {
		return { manifest: null, error: 'name is required' };
	};

	if ((typeof raw.version != 'string') || !raw.version.trim()) {
		return { manifest: null, error: 'version is required' };
	};

	const manifest: PluginManifest = {
		id: raw.id,
		name: raw.name,
		version: raw.version,
	};

	const minAppVersion = optionalString(raw.minAppVersion);
	const description = optionalString(raw.description);
	const author = optionalString(raw.author);

	if (minAppVersion) {
		manifest.minAppVersion = minAppVersion;
	};
	if (description) {
		manifest.description = description;
	};
	if (author) {
		manifest.author = author;
	};

	return { manifest, error: '' };
};
