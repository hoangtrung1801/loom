/**
 * Which plugin view a dataview view shows. The middleware knows nothing about plugins, so the binding lives in
 * the dataview block's synced `fields`:
 *
 *   fields.pluginViews      = { [viewId]: 'pluginId:viewType' }
 *   fields.pluginViewConfig = { [viewId]: { ...plugin view settings } }
 *
 * Every write merges into the current fields so keys that belong to other features are never clobbered.
 */
export const FIELD_VIEWS = 'pluginViews';
export const FIELD_CONFIG = 'pluginViewConfig';

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

export const setBinding = (rootId: string, blockId: string, viewId: string, key: string, callBack?: (message: any) => void, deps: BindingDeps = defaultDeps): void => {
	deps.setFields(rootId, blockId, mergeField(deps.getFields(rootId, blockId), FIELD_VIEWS, viewId, key), callBack);
};

/**
 * Removes the binding of a view together with its plugin settings.
 */
export const clearBinding = (rootId: string, blockId: string, viewId: string, callBack?: (message: any) => void, deps: BindingDeps = defaultDeps): void => {
	const fields = deps.getFields(rootId, blockId) || {};

	const hasView = isObject(fields[FIELD_VIEWS]) && (viewId in fields[FIELD_VIEWS]);
	const hasConfig = isObject(fields[FIELD_CONFIG]) && (viewId in fields[FIELD_CONFIG]);

	if (!hasView && !hasConfig) {
		callBack?.({ error: { code: 0 } });
		return;
	};

	let next = mergeField(fields, FIELD_VIEWS, viewId, undefined);
	next = mergeField(next, FIELD_CONFIG, viewId, undefined);

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

	if (Object.keys(config).length) {
		fields = mergeField(fields, FIELD_CONFIG, toViewId, { ...config });
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
