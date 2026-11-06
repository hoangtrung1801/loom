import React, { useEffect, useRef, useState } from 'react';
import { C, I, J, S, U, translate } from 'Lib';
import { CanvasController, LibraryItem, loadLibrary, saveLibrary, toLibraryElements, newElementId } from 'Lib/canvas';
import { CanvasRenderer } from './renderer';
import { CanvasIcon } from './icons';

interface Props {
	rootId: string;
	controller: CanvasController;
	renderer: CanvasRenderer;
	readonly?: boolean;
	onAddObject: (id: string) => void;
	onClose: () => void;
	onChange: () => void;
};

type Tab = 'items' | 'objects';

const THUMB_SIZE = 112;
const SEARCH_LIMIT = 30;
const SEARCH_DELAY = 200;

/** Sidebar with reusable groups of elements (kept per user) and a search for Loom objects to drop on the board. */
const CanvasLibrary = ({ rootId, controller, renderer, readonly, onAddObject, onClose, onChange }: Props) => {

	const [ tab, setTab ] = useState<Tab>('items');
	const [ items, setItems ] = useState<LibraryItem[]>(loadLibrary());
	const [ filter, setFilter ] = useState('');
	const [ objects, setObjects ] = useState<any[]>([]);
	const timerRef = useRef(0);
	const selected = controller.scene.selected();

	const getCenter = () => controller.toWorld({ x: controller.width / 2, y: controller.height / 2 });

	const update = (list: LibraryItem[]) => {
		setItems(list);
		saveLibrary(list);
	};

	const onAdd = () => {
		const elements = toLibraryElements(selected);
		if (!elements.length) {
			return;
		};

		const canvas = renderer.exportImage(elements, { scale: 2, background: false, padding: 4, maxSize: THUMB_SIZE * 2 });
		const name = (elements.find(el => el.text)?.text || translate('canvasLibraryItem')).slice(0, 40);

		update([ { id: newElementId(), name, thumb: canvas ? canvas.toDataURL('image/png') : '', elements } ].concat(items));
	};

	const onInsert = (item: LibraryItem) => {
		if (readonly) {
			return;
		};

		controller.insertElements(item.elements, getCenter());
		onChange();
	};

	const onRemove = (e: React.MouseEvent, item: LibraryItem) => {
		e.stopPropagation();
		update(items.filter(it => it.id != item.id));
	};

	useEffect(() => {
		if (tab != 'objects') {
			return;
		};

		window.clearTimeout(timerRef.current);
		timerRef.current = window.setTimeout(() => {
			const filters: I.Filter[] = [
				{ relationKey: 'resolvedLayout', condition: I.FilterCondition.NotIn, value: U.Object.getSystemLayouts().filter(it => !U.Object.isTypeLayout(it)).concat(I.ObjectLayout.Participant) },
				{ relationKey: 'type.uniqueKey', condition: I.FilterCondition.NotIn, value: [ J.Constant.typeKey.template ] },
				{ relationKey: 'id', condition: I.FilterCondition.NotEqual, value: rootId },
			];
			const sorts: I.Sort[] = [ { relationKey: 'lastModifiedDate', type: I.SortType.Desc } ];

			C.ObjectSearch(S.Common.space, filters, sorts, J.Relation.default, filter, 0, SEARCH_LIMIT, (message: any) => {
				setObjects((message.records || []).filter((it: any) => it && !it.isDeleted));
			});
		}, SEARCH_DELAY);

		return () => window.clearTimeout(timerRef.current);
	}, [ tab, filter ]);

	const shown = items.filter(it => !filter || it.name.toLowerCase().includes(filter.toLowerCase()));

	const tabButton = (id: Tab, text: string) => (
		<div className={[ 'segment', (tab == id ? 'active' : '') ].join(' ')} onClick={() => setTab(id)}>{translate(text)}</div>
	);

	return (
		<div className="canvasLibrary" onMouseDown={e => e.stopPropagation()}>
			<div className="head">
				<div className="title">{translate('canvasLibraryTitle')}</div>
				<div className="canvasButton" onClick={onClose}><CanvasIcon.close /></div>
			</div>

			<div className="segments">
				{tabButton('items', 'canvasLibraryMine')}
				{tabButton('objects', 'canvasLibraryObjects')}
			</div>

			<input className="search" type="text" value={filter} placeholder={translate('canvasLibrarySearch')} onChange={e => setFilter(e.target.value)} />

			<div className="list">
				{tab == 'items' ? (
					shown.length ? (
						<div className="tiles">
							{shown.map(item => (
								<div key={item.id} className="tile" title={item.name} onClick={() => onInsert(item)}>
									{item.thumb ? <img src={item.thumb} alt="" /> : <span>{item.name}</span>}
									<div className="remove" onClick={e => onRemove(e, item)}><CanvasIcon.close /></div>
								</div>
							))}
						</div>
					) : <div className="empty">{translate('canvasLibraryEmpty')}</div>
				) : (
					objects.length ? (
						<div className="objects">
							{objects.map(object => (
								<div key={object.id} className="object" onClick={() => !readonly && onAddObject(object.id)}>
									<div className="name">{object.name || translate('defaultNamePage')}</div>
									<div className="type">{S.Record.getTypeById(object.type)?.name || ''}</div>
								</div>
							))}
						</div>
					) : <div className="empty">{translate('canvasLibraryNoObjects')}</div>
				)}
			</div>

			{(tab == 'items') && !readonly ? (
				<div className={[ 'button', 'primary', (selected.length ? '' : 'disabled') ].join(' ')} onClick={onAdd}>{translate('canvasLibraryAdd')}</div>
			) : ''}
		</div>
	);

};

export default CanvasLibrary;
