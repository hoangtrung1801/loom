import React, { forwardRef, useEffect, useRef } from 'react';
import { Title, Label, Button, EmptyState, Switch } from 'Component';
import * as I from 'Interface';

const PageMainSettingsPlugins = forwardRef<I.PageRef, I.PageSettingsComponent>((props, ref) => {

	const { onPage } = props;
	const { restricted } = S.Plugin;
	const list = S.Plugin.getList();
	const isSupported = S.Plugin.isSupported;
	const switchRef = useRef(null);

	const onRestricted = (v: boolean) => {
		// v is the new state of the "Restricted mode" switch
		if (v) {
			S.Plugin.setRestricted(true);
			return;
		};

		S.Popup.open('confirm', {
			data: {
				title: translate('pluginsConfirmTitle'),
				text: translate('pluginsConfirmText'),
				textConfirm: translate('pluginsConfirmButton'),
				textCancel: translate('commonCancel'),
				colorConfirm: 'red',
				onConfirm: () => S.Plugin.setRestricted(false),
			},
			onClose: () => switchRef.current?.setValue(S.Plugin.restricted),
		});
	};

	const onEnable = (id: string, v: boolean) => {
		v ? S.Plugin.enable(id) : S.Plugin.disable(id);
	};

	const onOptions = (id: string) => {
		S.Plugin.settingsTarget.set(id);
		onPage('pluginSettings');
	};

	const Row = (item: any) => {
		const { id, manifest, error, loaded, enabled } = item;
		const name = manifest?.name || id;
		const meta = [];
		const cn = [ 'item', 'pluginItem' ];

		if (manifest) {
			meta.push(U.String.sprintf(translate('pluginsVersion'), manifest.version));

			if (manifest.author) {
				meta.push(U.String.sprintf(translate('pluginsAuthor'), manifest.author));
			};
		};

		if (error) {
			cn.push('hasError');
		};

		return (
			<div className={cn.join(' ')}>
				<div className="details">
					<div className="name" title={name}>{name}</div>
					{meta.length ? <Label className="meta" text={meta.join(' · ')} /> : ''}
					{manifest?.description ? <Label className="text" text={manifest.description} /> : ''}
					{error ? <Label className="error" text={U.String.sprintf(translate('pluginsError'), error)} /> : ''}
				</div>
				<div className="controls">
					{(loaded && S.Plugin.getSettingTab(id)) ? (
						<Button size={28} color="blank" text={translate('pluginsOptions')} onClick={() => onOptions(id)} />
					) : ''}
					<Switch
						className="big"
						value={enabled}
						readonly={!manifest}
						onChange={(e: any, v: boolean) => onEnable(id, v)}
					/>
				</div>
			</div>
		);
	};

	useEffect(() => {
		S.Plugin.refresh();
	}, []);

	if (!isSupported) {
		return (
			<>
				<Title text={translate('pageSettingsPluginsTitle')} />
				<EmptyState text={translate('pluginsUnsupported')} />
			</>
		);
	};

	return (
		<>
			<Title text={translate('pageSettingsPluginsTitle')} />
			<Label className="description" text={translate('pluginsDescription')} />

			<div className="actionItems">
				<div className="item">
					<div className="details">
						<Label text={translate('pluginsRestrictedMode')} />
						<Label className="meta" text={translate('pluginsRestrictedModeText')} />
					</div>
					<Switch ref={switchRef} className="big" value={restricted} onChange={(e: any, v: boolean) => onRestricted(v)} />
				</div>
			</div>

			<div className="buttons">
				<Button size={28} color="blank" text={translate('pluginsOpenFolder')} onClick={() => S.Plugin.openFolder()} />
				<Button size={28} color="blank" text={translate('pluginsReload')} onClick={() => S.Plugin.reloadAll()} />
				<Button size={28} color="blank" text={translate('pluginsDocs')} onClick={() => Renderer.send('openUrl', J.Url.pluginDocs)} />
			</div>

			{list.length ? (
				<div className="actionItems pluginList">
					{list.map(item => <Row key={item.id} {...item} />)}
				</div>
			) : (
				<EmptyState
					text={translate('pluginsEmpty')}
					buttonText={translate('pluginsOpenFolder')}
					onButton={() => S.Plugin.openFolder()}
				/>
			)}
		</>
	);

});

export default PageMainSettingsPlugins;
