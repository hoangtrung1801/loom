/**
 * Which plugin view a dataview view shows. The middleware knows nothing about plugins, so the binding lives in
 * the dataview block's synced `fields`:
 *
 *   fields.pluginViews      = { [viewId]: 'pluginId:viewType' }
 *   fields.pluginViewConfig = { [viewId]: { ...plugin view settings } }
 *   fields.pluginViewNames  = { [viewId]: 'name of the plugin view when it was bound' }
 *
 * The name is kept so the view can still be told apart from a renamed one when the plugin is not loaded.
 *
 * Every write merges into the current fields so keys that belong to other features are never clobbered.
 */
export const FIELD_VIEWS = 'pluginViews';
export const FIELD_CONFIG = 'pluginViewConfig';
export const FIELD_NAMES = 'pluginViewNames';

export interface BindingDeps {
	getFields(rootId: string, blockId: string): Record<string, any>;
	setFields(rootId: string, blockId: string, fields: Record<string, any>, callBack?: (message: any) => void): void;
};

const defaultDeps: BindingDeps = {
	getFields: (rootId: string, blockId: string) => S.Block.getLeaf(rootId, blockId)?.fields || {},
	setFields: (rootId: string, blockId: string, fields: Record<string, any>, callBack?: (message: any) => void) => {
		S.Block.update(rootId, blockId, { fields });
		C.BlockSetFields(rootId, blockId, fields, callBack);
	},
};

const isObject = (v: any): boolean => !!v && ('object' == typeof(v)) && !Array.isArray(v);

/**
 * Returns a copy of fields with one entry of a per-view map set (or removed, when value is undefined).
 */
export const mergeField = (fields: Record<string, any>, field: string, viewId: string, value: any): Record<string, any> => {
	const ret = { ...(fields || {}) };
	const map = { ...(isObject(ret[field]) ? ret[field] : {}) };

	if (undefined === value) {
		delete map[viewId];
	} else {
		map[viewId] = value;
	};

	if (Object.keys(map).length) {
		ret[field] = map;
	} else {
		delete ret[field];
	};
	return ret;
};

export const getBinding = (rootId: string, blockId: string, viewId: string, deps: BindingDeps = defaultDeps): string => {
	const map = deps.getFields(rootId, blockId)?.[FIELD_VIEWS];

	return isObject(map) ? String(map[viewId] || '') : '';
};

/**
 * Binds a view to a plugin view. Settings of a different plugin view do not carry over: they would mean nothing to it.
 * @param name - the plugin view's name, remembered for getBindingName
 */
export const setBinding = (rootId: string, blockId: string, viewId: string, key: string, name?: string, callBack?: (message: any) => void, deps: BindingDeps = defaultDeps): void => {
	const prev = getBinding(rootId, blockId, viewId, deps);

	let fields = mergeField(deps.getFields(rootId, blockId), FIELD_VIEWS, viewId, key);

	if (prev && (prev != key)) {
		fields = mergeField(fields, FIELD_CONFIG, viewId, undefined);
	};

	fields = mergeField(fields, FIELD_NAMES, viewId, name ? String(name) : undefined);
	deps.setFields(rootId, blockId, fields, callBack);
};

/**
 * The name the bound plugin view had when it was bound, or '' when unknown.
 */
export const getBindingName = (rootId: string, blockId: string, viewId: string, deps: BindingDeps = defaultDeps): string => {
	const map = deps.getFields(rootId, blockId)?.[FIELD_NAMES];

	return isObject(map) ? String(map[viewId] || '') : '';
};

/**
 * Removes the binding of a view together with its plugin settings.
 */
export const clearBinding = (rootId: string, blockId: string, viewId: string, callBack?: (message: any) => void, deps: BindingDeps = defaultDeps): void => {
	const fields = deps.getFields(rootId, blockId) || {};

	const hasView = isObject(fields[FIELD_VIEWS]) && (viewId in fields[FIELD_VIEWS]);
	const hasConfig = isObject(fields[FIELD_CONFIG]) && (viewId in fields[FIELD_CONFIG]);
	const hasName = isObject(fields[FIELD_NAMES]) && (viewId in fields[FIELD_NAMES]);

	if (!hasView && !hasConfig && !hasName) {
		callBack?.({ error: { code: 0 } });
		return;
	};

	let next = mergeField(fields, FIELD_VIEWS, viewId, undefined);
	next = mergeField(next, FIELD_CONFIG, viewId, undefined);
	next = mergeField(next, FIELD_NAMES, viewId, undefined);

	deps.setFields(rootId, blockId, next, callBack);
};

export const getConfig = (rootId: string, blockId: string, viewId: string, deps: BindingDeps = defaultDeps): Record<string, any> => {
	const map = deps.getFields(rootId, blockId)?.[FIELD_CONFIG];

	return (isObject(map) && isObject(map[viewId])) ? map[viewId] : {};
};

export const setConfig = (rootId: string, blockId: string, viewId: string, config: Record<string, any>, callBack?: (message: any) => void, deps: BindingDeps = defaultDeps): void => {
	deps.setFields(rootId, blockId, mergeField(deps.getFields(rootId, blockId), FIELD_CONFIG, viewId, config), callBack);
};

/**
 * Gives a new view (a duplicate) the binding and settings of an existing one.
 */
export const copyBinding = (rootId: string, blockId: string, fromViewId: string, toViewId: string, deps: BindingDeps = defaultDeps): void => {
	const key = getBinding(rootId, blockId, fromViewId, deps);

	if (!key) {
		return;
	};

	let fields = mergeField(deps.getFields(rootId, blockId), FIELD_VIEWS, toViewId, key);
	const config = getConfig(rootId, blockId, fromViewId, deps);

	const name = getBindingName(rootId, blockId, fromViewId, deps);

	if (Object.keys(config).length) {
		fields = mergeField(fields, FIELD_CONFIG, toViewId, { ...config });
	};

	if (name) {
		fields = mergeField(fields, FIELD_NAMES, toViewId, name);
	};

	deps.setFields(rootId, blockId, fields);
};

/**
 * Splits a binding key "pluginId:viewType" into its parts. The view type may contain colons.
 */
export const parseKey = (key: string): { pluginId: string, type: string } => {
	const idx = String(key || '').indexOf(':');

	return idx < 0 ? { pluginId: '', type: '' } : { pluginId: key.slice(0, idx), type: key.slice(idx + 1) };
};
