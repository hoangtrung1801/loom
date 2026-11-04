import React, { forwardRef, useEffect, useRef } from 'react';
import { Title, Label, EmptyState, PluginErrorBoundary } from 'Component';
import * as I from 'Interface';

const PageMainSettingsPluginSettings = forwardRef<I.PageRef, I.PageSettingsComponent>((props, ref) => {

	const id = S.Plugin.settingsTarget.get();
	const record = S.Plugin.get(id);
	const item = S.Plugin.getSettingTab(id);
	const nodeRef = useRef(null);
	const tab = item?.tab;
	const name = tab?.name || record?.manifest?.name || id;

	useEffect(() => {
		if (!tab?.render || !nodeRef.current) {
			return;
		};

		const container = nodeRef.current;
		const dispose = S.Plugin.guard(id, () => tab.render(container));

		return () => {
			S.Plugin.guard(id, () => ('function' == typeof(dispose)) ? dispose() : null);
			container.innerHTML = '';
		};
	}, [ id, tab ]);

	let content = null;

	if (!tab) {
		content = <EmptyState text={translate(record?.loaded ? 'pluginsSettingsNone' : 'pluginsSettingsMissing')} />;
	} else
	if (tab.component) {
		const Tab = tab.component;

		content = (
			<PluginErrorBoundary pluginId={id}>
				<Tab plugin={record} />
			</PluginErrorBoundary>
		);
	} else {
		content = <div ref={nodeRef} className="pluginSettingsContainer" />;
	};

	return (
		<>
			<Title text={name} />
			{record?.manifest?.description ? <Label className="description" text={record.manifest.description} /> : ''}
			{content}
		</>
	);

});

export default PageMainSettingsPluginSettings;
