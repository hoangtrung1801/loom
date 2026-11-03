import { describe, it, expect } from 'vitest';
import {
	getBinding, setBinding, clearBinding, getConfig, setConfig, copyBinding, mergeField, parseKey, BindingDeps,
} from './viewBinding';

const makeDeps = (initial: Record<string, any>) => {
	const state = { fields: initial, writes: 0 };
	const deps: BindingDeps = {
		getFields: () => state.fields,
		setFields: (rootId, blockId, fields, callBack) => {
			state.fields = fields;
			state.writes++;
			callBack?.({ error: { code: 0 } });
		},
	};
	return { state, deps };
};

describe('viewBinding', () => {

	it('writes a binding without clobbering other block fields', () => {
		const { state, deps } = makeDeps({ isLocked: true, other: { a: 1 } });

		setBinding('root', 'block', 'v1', 'sample:progress', undefined, deps);

		expect(state.fields).toEqual({ isLocked: true, other: { a: 1 }, pluginViews: { v1: 'sample:progress' } });
		expect(getBinding('root', 'block', 'v1', deps)).toBe('sample:progress');
	});

	it('keeps the bindings of other views', () => {
		const { state, deps } = makeDeps({ pluginViews: { v1: 'a:x' } });

		setBinding('root', 'block', 'v2', 'b:y', undefined, deps);

		expect(state.fields.pluginViews).toEqual({ v1: 'a:x', v2: 'b:y' });
	});

	it('does not mutate the fields it was given', () => {
		const fields = { pluginViews: { v1: 'a:x' } };
		const { deps } = makeDeps(fields);

		setBinding('root', 'block', 'v2', 'b:y', undefined, deps);

		expect(fields).toEqual({ pluginViews: { v1: 'a:x' } });
	});

	it('clears the binding and the config of one view only', () => {
		const { state, deps } = makeDeps({
			isLocked: true,
			pluginViews: { v1: 'a:x', v2: 'b:y' },
			pluginViewConfig: { v1: { size: 2 }, v2: { size: 3 } },
		});

		clearBinding('root', 'block', 'v1', undefined, deps);

		expect(state.fields).toEqual({ isLocked: true, pluginViews: { v2: 'b:y' }, pluginViewConfig: { v2: { size: 3 } } });
	});

	it('drops the empty maps and skips the write when there is nothing to clear', () => {
		const { state, deps } = makeDeps({ pluginViews: { v1: 'a:x' } });

		clearBinding('root', 'block', 'v1', undefined, deps);
		expect(state.fields).toEqual({});

		clearBinding('root', 'block', 'v1', undefined, deps);
		expect(state.writes).toBe(1);
	});

	it('stores the config next to the binding', () => {
		const { state, deps } = makeDeps({ pluginViews: { v1: 'a:x' } });

		setConfig('root', 'block', 'v1', { relation: 'done' }, undefined, deps);

		expect(getConfig('root', 'block', 'v1', deps)).toEqual({ relation: 'done' });
		expect(state.fields.pluginViews).toEqual({ v1: 'a:x' });
	});

	it('copies the binding with its config to a duplicated view', () => {
		const { state, deps } = makeDeps({ pluginViews: { v1: 'a:x' }, pluginViewConfig: { v1: { n: 1 } } });

		copyBinding('root', 'block', 'v1', 'v2', deps);

		expect(state.fields.pluginViews).toEqual({ v1: 'a:x', v2: 'a:x' });
		expect(state.fields.pluginViewConfig).toEqual({ v1: { n: 1 }, v2: { n: 1 } });
	});

	it('does nothing when copying a view without a binding', () => {
		const { state, deps } = makeDeps({});

		copyBinding('root', 'block', 'v1', 'v2', deps);
		expect(state.writes).toBe(0);
	});

	it('survives malformed fields', () => {
		const { deps } = makeDeps({ pluginViews: 'oops', pluginViewConfig: [ 1 ] });

		expect(getBinding('root', 'block', 'v1', deps)).toBe('');
		expect(getConfig('root', 'block', 'v1', deps)).toEqual({});
		expect(mergeField({ pluginViews: 'oops' }, 'pluginViews', 'v1', 'a:x')).toEqual({ pluginViews: { v1: 'a:x' } });
	});

	it('splits a key at the first colon', () => {
		expect(parseKey('sample:progress')).toEqual({ pluginId: 'sample', type: 'progress' });
		expect(parseKey('sample:a:b')).toEqual({ pluginId: 'sample', type: 'a:b' });
		expect(parseKey('')).toEqual({ pluginId: '', type: '' });
	});

});
