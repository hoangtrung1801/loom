import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { Title, Label, Button, Filter } from 'Component';
import * as I from 'Interface';
import Storage from 'Lib/storage';
import { parseHotkey } from 'Lib/plugin/hotkey';

interface Binding {
	id: string;
	name: string;
	keys: string[];
	isPlugin: boolean;
	isCustom: boolean;
	isLocked: boolean;
	description?: string;
};

const MODIFIERS = [ 'cmd', 'ctrl', 'alt', 'shift' ];
// What KeyboardEvent.key reports while a modifier alone is held
const MODIFIER_EVENT_KEYS = [ 'control', 'meta', 'os', 'alt', 'altgraph', 'shift', 'cmd', 'ctrl' ];
const CODE_PREFIXES = [ 'key', 'digit' ];
const SPECIAL_KEYS = [ 'comma', 'space' ];

const sameKeys = (a: string[], b: string[]): boolean => {
	return (a.length > 0) && (a.slice().sort().join('+') == b.slice().sort().join('+'));
};

const PageMainSettingsShortcuts = forwardRef<I.PageRef, I.PageSettingsComponent>((props, ref) => {

	const [ dummy, setDummy ] = useState(0);
	const [ filter, setFilter ] = useState('');
	const [ editingId, setEditingId ] = useState('');
	const [ editingKeys, setEditingKeys ] = useState<string[]>([]);
	const [ errorId, setErrorId ] = useState('');
	const [ globalStatus, setGlobalStatus ] = useState<any>(null);
	const refresh = () => setDummy(v => v + 1);
	const cmd = keyboard.cmdKey();
	const showPlugins = S.Plugin.isSupported && !S.Plugin.restricted;

	const getBindings = (): { builtin: { name: string, children: Binding[] }[], plugin: Binding[] } => {
		const custom = Storage.getShortcuts();
		const overrides = Storage.getPluginHotkeys();
		const section = J.Shortcut.getSections().find(it => it.id == 'shortcut');
		const builtin = (section?.children || []).map((group: any) => ({
			name: group.name,
			children: (group.children || []).filter((it: any) => it.id && !it.noEdit).map((it: any) => ({
				id: it.id,
				name: it.name,
				keys: it.keys || [],
				isPlugin: false,
				isCustom: !!custom[it.id],
				isLocked: false,
			})),
		}));

		const plugin = !showPlugins ? [] : S.Plugin.getCommands().map(item => ({
			id: item.key,
			name: item.command.name,
			description: S.Plugin.get(item.pluginId)?.manifest?.name || item.pluginId,
			keys: overrides[item.key] || parseHotkey(item.command.hotkey, cmd),
			isPlugin: true,
			isCustom: !!overrides[item.key],
			isLocked: false,
		}));

		return { builtin, plugin };
	};

	const findConflict = (id: string, keys: string[]): Binding | null => {
		const { builtin, plugin } = getBindings();
		const all: Binding[] = [].concat(...builtin.map(it => it.children), plugin);

		return all.find(it => (it.id != id) && sameKeys(it.keys, keys)) || null;
	};

	const save = (item: Binding, keys: string[]) => {
		if (item.isPlugin) {
			Storage.setPluginHotkey(item.id, keys);
		} else {
			Storage.updateShortcuts(item.id, keys);
		};
	};

	const stopEditing = () => {
		keyboard.setShortcutEditing(false);
		setEditingId('');
		setEditingKeys([]);
		Renderer.send('initMenu');
	};

	const commit = (item: Binding, keys: string[]) => {
		if (item.id == 'globalSearch') {
			if (!keys.some(k => MODIFIERS.includes(k))) {
				// A bare key registered with the OS would swallow typing system-wide
				Preview.toastShow({ text: translate('popupShortcutGlobalSearchModifier') });
				stopEditing();
				return;
			};
		};

		if (item.isPlugin && !keys.some(k => MODIFIERS.includes(k))) {
			Preview.toastShow({ text: translate('pageSettingsShortcutsPluginModifier') });
			stopEditing();
			return;
		};

		const conflict = findConflict(item.id, keys);

		if (!conflict) {
			save(item, keys);
			stopEditing();
			refresh();
			Preview.toastShow({ text: translate('popupShortcutToastSaved') });
			analytics.event('UpdateShortcut', { name: item.id });
			return;
		};

		setErrorId(item.id);
		keyboard.setShortcutEditing(false);

		S.Popup.open('confirm', {
			data: {
				title: translate('pageSettingsShortcutsConflictTitle'),
				text: U.String.sprintf(translate('pageSettingsShortcutsConflictText'), keyboard.getSymbolsFromKeys(keys).join(' '), conflict.name),
				textConfirm: translate('popupShortcutOverride'),
				textCancel: translate('commonCancel'),
				onConfirm: () => {
					// The new owner wins, the previous one is left unassigned
					save(conflict, []);
					save(item, keys);
					Preview.toastShow({ text: translate('popupShortcutToastSaved') });
					analytics.event('UpdateShortcut', { name: item.id });
				},
			},
			onClose: () => {
				setErrorId('');
				stopEditing();
				refresh();
			},
		});
	};

	const onReset = (item: Binding) => {
		if (item.isPlugin) {
			Storage.setPluginHotkey(item.id, null);
		} else {
			Storage.resetShortcut(item.id);
		};

		Renderer.send('initMenu');
		refresh();
	};

	const onResetAll = () => {
		S.Popup.open('confirm', {
			data: {
				title: translate('commonAreYouSure'),
				text: translate('popupShortcutResetAllText'),
				textConfirm: translate('commonConfirm'),
				onConfirm: () => {
					Storage.resetShortcuts();
					Storage.resetPluginHotkeys();
					Renderer.send('initMenu');
					refresh();

					Preview.toastShow({ text: translate('popupShortcutToastUpdated') });
					analytics.event('ResetShortcutMapping');
				},
			},
		});
	};

	// Records one chord: modifiers held together with a single main key
	useEffect(() => {
		keyboard.setShortcutEditing(!!editingId);

		if (!editingId) {
			return;
		};

		const { builtin, plugin } = getBindings();
		const item: Binding = [].concat(...builtin.map(it => it.children), plugin).find((it: Binding) => it.id == editingId);

		const onKeyDown = (e: any) => {
			e.preventDefault();
			e.stopPropagation();

			const key = keyboard.eventKey(e);

			if (key == Key.escape) {
				stopEditing();
				return;
			};

			const pressed = keyboard.metaKeys(e);
			const code = String(e.code || '').toLowerCase();

			if (MODIFIER_EVENT_KEYS.includes(String(key).toLowerCase())) {
				setEditingKeys(pressed);
				return;
			};

			let main = '';

			CODE_PREFIXES.forEach(prefix => {
				if (!main && code.startsWith(prefix)) {
					main = code.replace(prefix, '');
				};
			});

			SPECIAL_KEYS.forEach(special => {
				if (!main && (e.which == J.Key[special])) {
					main = special;
				};
			});

			main = main || key;

			if (main) {
				const keys = U.Common.arrayUnique(pressed.concat(main));

				setEditingKeys(keys);
				if (item) {
					commit(item, keys);
				};
			};
		};

		U.Dom.addEvent(window, 'keydown', onKeyDown);

		return () => {
			U.Dom.removeEvent(window, 'keydown', onKeyDown);
			keyboard.setShortcutEditing(false);
		};
	}, [ editingId ]);

	// OS-level registration state for the global search shortcut
	useEffect(() => {
		if (editingId) {
			return;
		};

		const t = window.setTimeout(() => {
			Renderer.send('getGlobalShortcutStatus').then((status: any) => setGlobalStatus(status || null));
		}, 100);

		return () => window.clearTimeout(t);
	}, [ editingId, dummy ]);

	const matches = (item: Binding): boolean => {
		if (!filter) {
			return true;
		};

		const reg = new RegExp(U.String.regexEscape(filter), 'gi');
		const text = [ item.name, item.description, ...item.keys, ...keyboard.getSymbolsFromKeys(item.keys) ].join(' ');

		return !!text.match(reg);
	};

	const renderRow = (item: Binding) => {
		const isEditing = (editingId == item.id);
		const isUnavailable = (item.id == 'globalSearch') && globalStatus?.unavailable;
		const cn = [ 'item', 'shortcutItem' ];

		const keys = isEditing ? editingKeys : item.keys;
		let value: any = null;

		if (isEditing) {
			cn.push('isEditing');
		};
		if (errorId == item.id) {
			cn.push('hasError');
		};

		if (isUnavailable) {
			value = <Label className="hint" text={translate('popupShortcutGlobalSearchUnavailable')} />;
		} else
		if (isEditing && !keys.length) {
			value = <Label className="hint" text={translate('popupShortcutPress')} />;
		} else
		if (keys.length) {
			value = (
				<div className="symbols">
					{keyboard.getSymbolsFromKeys(keys).map((symbol: string, i: number) => (
						<Label key={i} text={(symbol == '[,]') ? ',' : symbol} />
					))}
				</div>
			);
		} else {
			value = <Label className="hint" text={translate('commonAdd')} />;
		};

		return (
			<div key={item.id} id={`shortcut-${item.id}`} className={cn.join(' ')}>
				<div className="details">
					<div className="name">{item.name}</div>
					{item.description ? <Label className="meta" text={item.description} /> : ''}
				</div>
				<div className="controls">
					<div
						className="keys"
						onClick={() => {
							if (!isUnavailable) {
								setEditingKeys([]);
								setEditingId(isEditing ? '' : item.id);
								analytics.event('ClickShortcut', { name: item.id });
							};
						}}
					>
						{value}
					</div>
					{item.isCustom ? <Button size={28} color="blank" text={translate('commonReset')} onClick={() => onReset(item)} /> : ''}
					{item.keys.length && !isEditing ? (
						<Button size={28} color="blank" text={translate('commonRemove')} onClick={() => { save(item, []); Renderer.send('initMenu'); refresh(); }} />
					) : ''}
				</div>
			</div>
		);
	};

	const { builtin, plugin } = getBindings();
	const groups = builtin.map(group => ({ ...group, children: group.children.filter(matches) })).filter(group => group.children.length);
	const pluginItems = plugin.filter(matches);

	return (
		<>
			<Title text={translate('pageSettingsShortcutsTitle')} />
			<Label className="description" text={translate('pageSettingsShortcutsDescription')} />

			<div className="toolbar">
				<Filter className="outlined" onChange={setFilter} />
				<Button size={28} color="blank" text={translate('popupShortcutResetAll')} onClick={onResetAll} />
			</div>

			{groups.map((group, i) => (
				<React.Fragment key={i}>
					<Label className="section" text={group.name} />
					<div className="actionItems">
						{group.children.map(renderRow)}
					</div>
				</React.Fragment>
			))}

			{pluginItems.length ? (
				<>
					<Label className="section" text={translate('pageSettingsShortcutsPlugins')} />
					<div className="actionItems">
						{pluginItems.map(renderRow)}
					</div>
				</>
			) : ''}
		</>
	);

});

export default PageMainSettingsShortcuts;
