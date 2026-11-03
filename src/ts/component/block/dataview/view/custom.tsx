import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EmptyState, PluginErrorBoundary } from 'Component';
import * as I from 'Interface';
import { getBinding, getConfig, parseKey } from 'Lib/plugin/viewBinding';
import type { ViewRenderProps } from 'Lib/plugin/types';

const ViewCustom = forwardRef<I.ViewRef, I.ViewComponent>((props, ref) => {

	const {
		rootId, block, className, readonly, getView, getSubId, getRecords, getRecord, getVisibleRelations, getLimit,
		loadData, onRecordAdd, onCellChange,
	} = props;
	const view = getView();
	const subId = getSubId();
	const nodeRef = useRef(null);
	const cn = [ 'viewContent', 'viewCustom', className ];
	const key = view ? getBinding(rootId, block.id, view.id) : '';
	const item = S.Plugin.getView(key);
	const { pluginId } = parseKey(key);

	useImperativeHandle(ref, () => ({
		resize: () => {},
	}));

	const getProps = (): ViewRenderProps => {
		const { offset, total } = S.Record.getMeta(subId, '');
		const records = getRecords().map(id => getRecord(id)).filter(it => it && !it._empty_);
		const limit = getLimit();
		const settings = item?.def.settings || [];
		const config: Record<string, any> = {};

		settings.forEach(it => config[it.id] = it.default);
		Object.assign(config, getConfig(rootId, block.id, view.id));

		const relations = getVisibleRelations().map(it => {
			const relation = S.Record.getRelationByKey(it.relationKey);

			return { key: it.relationKey, name: relation?.name || it.relationKey, format: relation?.format || 0 };
		});

		return {
			records,
			relations,
			view: { id: view.id, name: view.name },
			config,
			readonly: !!readonly,
			hasMore: (records.length < total),
			open: (id: string) => U.Object.openConfig(null, getRecord(id)),
			update: (id: string, relationKey: string, value: any) => onCellChange?.(id, relationKey, value),
			create: () => onRecordAdd?.({}, 1),
			loadMore: () => {
				const next = offset + limit;

				loadData(view.id, next, false);
				S.Record.metaSet(subId, '', { offset: next });
			},
		};
	};

	const viewProps = item ? getProps() : null;

	// Vanilla plugins draw into the node themselves; the effect re-runs on every render, so the plugin always sees fresh props
	useEffect(() => {
		const el = nodeRef.current;

		if (!item || !item.def.render || item.def.component || !el) {
			return;
		};

		const dispose = S.Plugin.guard(pluginId, () => item.def.render(el, viewProps));

		return () => {
			S.Plugin.guard(pluginId, () => ('function' == typeof(dispose)) ? dispose() : null);
			el.innerHTML = '';
		};
	});

	if (!view) {
		return null;
	};

	if (!item) {
		const error = S.Plugin.get(pluginId)?.error;
		const text = error
			? U.String.sprintf(translate('pluginViewError'), error)
			: U.String.sprintf(translate('pluginViewMissing'), key || translate('viewName7'));

		return (
			<div className={cn.join(' ')}>
				<EmptyState
					text={text}
					buttonText={translate('pluginViewMissingButton')}
					onButton={() => Action.openSettings('plugins', '')}
				/>
			</div>
		);
	};

	const { component: PluginView } = item.def;

	let content = null;

	if (PluginView) {
		content = (
			<PluginErrorBoundary pluginId={pluginId}>
				<PluginView {...viewProps} />
			</PluginErrorBoundary>
		);
	} else
	if (item.def.render) {
		content = <div ref={nodeRef} className="pluginViewNode" />;
	} else {
		content = <EmptyState text={translate('pluginViewNoRender')} />;
	};

	return (
		<div className={cn.join(' ')}>
			{content}
		</div>
	);

});

export default ViewCustom;
