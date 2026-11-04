import { isValidPluginId } from './pluginManifest';

/**
 * What a change reported by fs.watch inside the plugins folder means.
 * - `{ ignore: true }`: nothing to reload (a plugin writing its own data.json would otherwise loop)
 * - `{ id }`: only that plugin changed
 * - `{ id: null }`: unknown scope, the whole folder has to be rescanned
 */
export const classifyPluginChange = (name: string | Buffer | null | undefined): { ignore?: boolean; id: string | null } => {
	if (!name) {
		return { id: null };
	};

	const parts = String(name).split(/[\\/]+/).filter(it => it);

	if (!parts.length) {
		return { id: null };
	};

	if (/^data\.json(\.tmp)?$/.test(parts[parts.length - 1]) && (parts.length > 1)) {
		return { ignore: true, id: null };
	};

	// A change of the folder entry itself (added, removed, renamed) also changes the list of plugins
	if (parts.length == 1) {
		return { id: null };
	};

	return { id: isValidPluginId(parts[0]) ? parts[0] : null };
};

/**
 * Collects the changes of one debounce window. Returns null when the whole folder has to be rescanned.
 */
export class PluginChangeSet {

	private ids: Set<string> = new Set();
	private all = false;

	/**
	 * @param name - path relative to the watched folder, as fs.watch reports it (may be empty)
	 * @param pluginId - set when the watched folder is a single plugin's folder rather than the plugins root
	 */
	add (name: string | Buffer | null | undefined, pluginId?: string): boolean {
		const { ignore, id } = pluginId ?
			(name ? classifyPluginChange(`${pluginId}/${name}`) : { id: pluginId }) :
			classifyPluginChange(name);

		if (ignore) {
			return false;
		};

		if (id) {
			this.ids.add(id);
		} else {
			this.all = true;
		};
		return true;
	};

	flush (): string[] | null {
		const ret = this.all ? null : Array.from(this.ids);

		this.ids.clear();
		this.all = false;
		return ret;
	};

};
