import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { Filter, Icon, Label } from 'Component';
import * as I from 'Interface';
import { parseHotkey } from 'Lib/plugin/hotkey';

const PopupCommand = forwardRef<{}, I.Popup>((props, ref) => {

	const { close, position } = props;
	const [ filter, setFilter ] = useState('');
	const [ index, setIndex ] = useState(0);
	const bodyRef = useRef(null);

	// Commands the plugin hides through checkCallback(true) are not listed
	const items = S.Plugin.getCommands().filter(it => S.Plugin.isCommandAvailable(it)).filter(it => {
		return !filter || it.command.name.toLowerCase().includes(filter.toLowerCase());
	});

	const onRun = (item: any) => {
		if (item) {
			close(() => S.Plugin.runCommand(item.key));
		};
	};

	const onFilterChange = (v: string) => {
		setFilter(v);
		setIndex(0);
	};

	const onKeyDown = (e: any) => {
		keyboard.shortcut('arrowdown', e, () => {
			e.preventDefault();
			setIndex(items.length ? (index + 1) % items.length : 0);
		});

		keyboard.shortcut('arrowup', e, () => {
			e.preventDefault();
			setIndex(items.length ? (index - 1 + items.length) % items.length : 0);
		});

		keyboard.shortcut('enter', e, () => {
			e.preventDefault();
			onRun(items[index]);
		});
	};

	const getCaption = (hotkey: string) => {
		return keyboard.getSymbolsFromKeys(parseHotkey(hotkey, keyboard.cmdKey())).join(' ');
	};

	useEffect(() => {
		position?.();
	}, [ items.length ]);

	useEffect(() => {
		U.Dom.select('.item.active', bodyRef.current)?.scrollIntoView({ block: 'nearest' });
	}, [ index ]);

	const Item = (item: any) => {
		const { command, pluginId, idx } = item;
		const cn = [ 'item' ];

		if (idx == index) {
			cn.push('active');
		};

		return (
			<div className={cn.join(' ')} onClick={() => onRun(item)} onMouseEnter={() => setIndex(idx)}>
				{command.icon ? <Icon name={command.icon} /> : ''}
				<div className="name">{command.name}</div>
				<div className="plugin">{S.Plugin.get(pluginId)?.manifest?.name || pluginId}</div>
				{command.hotkey ? <div className="caption" dangerouslySetInnerHTML={{ __html: U.String.sanitize(getCaption(command.hotkey)) }} /> : ''}
			</div>
		);
	};

	return (
		<>
			<div className="head">
				<Filter
					className="outlined"
					placeholder={translate('popupCommandPlaceholder')}
					focusOnMount={true}
					onChange={onFilterChange}
					onKeyDown={onKeyDown}
				/>
			</div>

			<div ref={bodyRef} className="body customScrollbar">
				{items.length ? (
					items.map((item, i) => <Item key={item.key} {...item} idx={i} />)
				) : (
					<Label className="empty" text={translate('popupCommandEmpty')} />
				)}
			</div>
		</>
	);

});

export default PopupCommand;
