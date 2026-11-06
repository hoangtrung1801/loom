import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { reaction } from 'mobx';
import { C, I, S, U, J, keyboard, translate } from 'Lib';
import { CanvasController, CanvasElement, ElementType, Scene, SOFT_ELEMENT_LIMIT, Tool } from 'Lib/canvas';
import { CanvasRenderer, RendererTheme, ObjectInfo, ObjectKind, PreviewBlock } from './renderer';
import { CanvasAdapter } from './adapter';
import CanvasToolbar from './toolbar';
import CanvasPanel from './panel';
import CanvasLibrary from './library';
import CanvasExport from './export';

export interface CanvasRef {
	getController: () => CanvasController;
	addObject: (objectId: string) => void;
};

interface Props {
	rootId: string;
	readonly?: boolean;
	isPopup?: boolean;
	onOpenObject?: (objectId: string) => void;
};

interface Editing {
	id: string;
	text: string;
};

const getTheme = (): RendererTheme => {
	const key = S.Common.getThemeClass();
	const theme = J.Theme[key] as any;
	const fontFamily = window.getComputedStyle(document.body).fontFamily || 'sans-serif';
	const fill: { [key: string]: string } = {};

	// Soft fills for stickies and shapes come from the same palette as object icons
	J.Theme.icon.list.forEach((name: string) => fill[name] = J.Theme.icon.text[name]);

	return {
		bg: theme.graph.bg,
		grid: theme.graph.link,
		text: theme.color.default,
		// Fills are the same soft colors in every theme, so text on them stays the light theme's dark text
		onFill: (J.Theme[''] as any).color.default,
		muted: theme.graph.muted,
		selected: theme.graph.selected,
		highlight: theme.graph.highlight,
		card: theme.graph.bg,
		cardBorder: theme.graph.link,
		stroke: theme.color,
		fill,
		textColor: theme.textColor,
		fontFamily,
		openLabel: translate('canvasOpenInPanel'),
	};
};

const PREVIEW_BLOCKS = 40;

const getKind = (layout: I.ObjectLayout): ObjectKind => {
	switch (layout) {
		case I.ObjectLayout.Image: return 'image';
		case I.ObjectLayout.Bookmark: return 'bookmark';
		case I.ObjectLayout.Set:
		case I.ObjectLayout.Collection: return 'set';
	};
	return 'page';
};

/** Size an object preview starts with on the board. */
const getCardSize = (kind: ObjectKind) => {
	switch (kind) {
		case 'image': return { w: 280, h: 200 };
		case 'bookmark': return { w: 320, h: 96 };
		case 'set': return { w: 360, h: 220 };
	};
	return { w: 340, h: 420 };
};

const isShapeType = (type: ElementType) => [ ElementType.Rect, ElementType.Diamond, ElementType.Ellipse ].includes(type);

/** Area inside the element where its text lives, in element space. Matches the renderer. */
const getTextRegion = (el: CanvasElement) => {
	if (el.type == ElementType.Diamond) {
		return { x: el.w / 4, y: el.h / 4, w: el.w / 2, h: el.h / 2 };
	};
	if (el.type == ElementType.Text) {
		return { x: 0, y: 0, w: el.w, h: el.h };
	};

	const pad = 12;
	return { x: pad, y: pad, w: Math.max(10, el.w - (pad * 2)), h: Math.max(10, el.h - (pad * 2)) };
};

const MediaCanvas = forwardRef<CanvasRef, Props>(({
	rootId,
	readonly = false,
	isPopup = false,
	onOpenObject,
}, ref) => {

	const nodeRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLDivElement>(null);
	const controllerRef = useRef<CanvasController | null>(null);
	const rendererRef = useRef<CanvasRenderer | null>(null);
	const adapterRef = useRef<CanvasAdapter | null>(null);
	const editorRef = useRef<HTMLTextAreaElement>(null);
	const objectIdsRef = useRef('');
	const shownRef = useRef(new Map<string, string>());
	const [ tool, setTool ] = useState<Tool>(Tool.Select);
	const [ editing, setEditing ] = useState<Editing | null>(null);
	const [ dummy, setDummy ] = useState(0);
	const [ overLimit, setOverLimit ] = useState(false);
	const [ libraryOpen, setLibraryOpen ] = useState(false);
	const [ exportOpen, setExportOpen ] = useState(false);
	const [ zen, setZen ] = useState(false);
	const subId = `canvasObjects-${rootId}`;

	const frameRef = useRef(0);

	// Coalesced so a stream of pointer events does not re-render React for every move
	const refresh = () => {
		if (frameRef.current) {
			return;
		};

		frameRef.current = window.requestAnimationFrame(() => {
			frameRef.current = 0;
			setDummy(v => v + 1);
		});
	};

	/** Top level blocks of a page that was loaded with ObjectShow, reduced to what the preview draws. */
	const getPreviewBlocks = (id: string): PreviewBlock[] => {
		const out: PreviewBlock[] = [];
		const walk = (parentId: string, depth: number) => {
			let number = 0;

			S.Block.getChildren(id, parentId).forEach(block => {
				if ((out.length >= PREVIEW_BLOCKS) || (block.id == 'header')) {
					return;
				};

				if (block.type == I.BlockType.Layout) {
					walk(block.id, depth);
					return;
				};

				if (block.type == I.BlockType.Div) {
					out.push({ kind: 'div', style: 0, text: '', checked: false, depth, number: 0 });
					return;
				};

				if (block.type != I.BlockType.Text) {
					return;
				};

				const style = Number(block.content.style) || 0;

				if ([ I.TextStyle.Title, I.TextStyle.Description ].includes(style)) {
					return;
				};

				number = (style == I.TextStyle.Numbered) ? number + 1 : 0;
				out.push({ kind: 'text', style, text: String(block.content.text || ''), checked: !!block.content.checked, depth, number });

				// Toggles are closed in the preview, everything else shows its nested blocks
				if ((depth < 2) && ![ I.TextStyle.Toggle, I.TextStyle.ToggleHeader1, I.TextStyle.ToggleHeader2, I.TextStyle.ToggleHeader3 ].includes(style)) {
					walk(block.id, depth + 1);
				};
			});
		};

		walk(id, 0);
		return out;
	};

	const getObject = (id: string): ObjectInfo => {
		const object = S.Detail.get(subId, id, [ 'name', 'layout', 'type', 'isDeleted', 'description', 'snippet', 'source' ], true);
		const type = S.Record.getTypeById(object.type);
		const kind = getKind(object.layout);
		const deleted = !!object.isDeleted;

		return {
			name: deleted ? translate('commonDeletedObject') : (object.name || translate('defaultNamePage')),
			type: type?.name || '',
			kind,
			text: deleted ? '' : String(object.snippet || object.description || ''),
			source: String(object.source || ''),
			imageUrl: ((kind == 'image') && !deleted) ? S.Common.imageUrl(id, 640) : '',
			blocks: (kind == 'page') ? getPreviewBlocks(id) : [],
		};
	};

	/** Object cards need name and type of their targets, which are not part of this object's own details. */
	const loadObjects = () => {
		const controller = controllerRef.current;
		if (!controller) {
			return;
		};

		const ids = U.Common.arrayUnique(controller.scene.list().filter(el => (el.type == ElementType.Object) && el.targetObjectId).map(el => el.targetObjectId));
		const sig = ids.slice().sort().join(',');

		if (sig == objectIdsRef.current) {
			return;
		};
		objectIdsRef.current = sig;

		if (!ids.length) {
			return;
		};

		U.Subscription.subscribeIds({ subId, ids, keys: J.Relation.default, noDeps: true }, () => {
			rendererRef.current?.invalidateObjects();
			showPages(ids);
		});
	};

	/**
	 * Page previews draw the page's blocks, so load them once (ObjectShow does not open the object).
	 * Later edits arrive through the block store; reloading would reset blocks that an open editor is using.
	 */
	const showPages = (ids: string[]) => {
		ids.forEach(id => {
			const object = S.Detail.get(subId, id, [ 'layout' ], true);

			if ((getKind(object.layout) != 'page') || shownRef.current.has(id) || S.Block.getChildrenIds(id, id).length) {
				return;
			};

			shownRef.current.set(id, '1');
			C.ObjectShow(id, '', S.Common.space, () => rendererRef.current?.invalidateObjects());
		});
	};

	const getPoint = (e: React.PointerEvent | React.MouseEvent | React.DragEvent) => {
		const rect = canvasRef.current.getBoundingClientRect();

		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	};

	const getMods = (e: any) => ({ shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey, button: e.button });

	const onPointerDown = (e: React.PointerEvent) => {
		const controller = controllerRef.current;
		if (!controller || (e.button > 1)) {
			return;
		};

		if (editing) {
			commitEdit();
		};

		canvasRef.current.setPointerCapture(e.pointerId);
		nodeRef.current?.focus();
		controller.pointerDown(getPoint(e), getMods(e));
	};

	const onPointerMove = (e: React.PointerEvent) => {
		controllerRef.current?.pointerMove(getPoint(e), getMods(e));
	};

	const onPointerUp = (e: React.PointerEvent) => {
		controllerRef.current?.pointerUp(getPoint(e), getMods(e));

		if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
			canvasRef.current.releasePointerCapture(e.pointerId);
		};
		refresh();
	};

	const onDoubleClick = (e: React.MouseEvent) => {
		controllerRef.current?.doubleClick(getPoint(e));
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		const controller = controllerRef.current;

		// Menus handle their own keys (arrows, enter, escape)
		if (!controller || editing || S.Menu.isOpen() || ((e.target as HTMLElement).tagName == 'TEXTAREA')) {
			return;
		};

		const mod = e.metaKey || e.ctrlKey;
		const key = e.key.toLowerCase();
		let handled = true;

		if (mod && e.shiftKey && (key == 'e')) {
			onExport();
		} else
		if (e.altKey && !mod && (e.code == 'KeyZ')) {
			setZen(v => !v);
		} else
		if (mod && (key == '\'')) {
			onMenuAction('grid');
		} else
		if (mod && e.altKey && (e.code == 'KeyC')) {
			controller.copyStyle();
		} else
		if (mod && e.altKey && (e.code == 'KeyV')) {
			controller.pasteStyle();
		} else {
			handled = false;
		};

		if (handled) {
			e.preventDefault();
			e.stopPropagation();
			refresh();
			return;
		};

		if (controller.keyDown({ key: e.key, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey })) {
			e.preventDefault();
			e.stopPropagation();
			refresh();
		};
	};

	const onKeyUp = (e: React.KeyboardEvent) => {
		controllerRef.current?.keyUp({ key: e.key });
	};

	const onPaste = (e: React.ClipboardEvent) => {
		const text = e.clipboardData.getData('text/plain');
		const controller = controllerRef.current;

		if (!controller || editing || readonly) {
			return;
		};

		// Loom object link: openObject/<id> style deep links drop an object card
		const match = String(text || '').match(/[?&]objectId=([a-zA-Z0-9]+)/) || String(text || '').match(/\/object\/([a-zA-Z0-9]+)/);
		if (match) {
			e.preventDefault();
			addObject(match[1]);
		};
	};

	const getCenter = () => {
		const controller = controllerRef.current;
		return controller.toWorld({ x: controller.width / 2, y: controller.height / 2 });
	};

	const addObject = (objectId: string, world?: { x: number, y: number }) => {
		const hint = getCardSize(getObject(objectId).kind);

		controllerRef.current?.addObjectCard(objectId, world || getCenter(), hint);
		loadObjects();
		refresh();
	};

	const onAddObject = () => {
		S.Menu.open('searchObject', {
			element: '#canvasAddObject',
			className: 'single fixed',
			offsetY: 8,
			vertical: I.MenuDirection.Bottom,
			data: {
				noFilter: false,
				withPlural: true,
				filters: [
					{ relationKey: 'resolvedLayout', condition: I.FilterCondition.NotIn, value: U.Object.getSystemLayouts().filter(it => !U.Object.isTypeLayout(it)).concat(I.ObjectLayout.Participant) },
					{ relationKey: 'type.uniqueKey', condition: I.FilterCondition.NotIn, value: [ J.Constant.typeKey.template ] },
					{ relationKey: 'id', condition: I.FilterCondition.NotEqual, value: rootId },
				],
				onSelect: (el: any) => addObject(el.id),
			},
		});
	};

	// Text inside shapes and stickies can sit at the top, middle or bottom of its area; a textarea can't do that on its own
	const layoutEditor = () => {
		const ta = editorRef.current;
		const controller = controllerRef.current;
		const el = (editing && controller) ? controller.scene.get(editing.id) : null;

		if (!ta || !el || ![ ElementType.Sticky, ElementType.Rect, ElementType.Diamond, ElementType.Ellipse ].includes(el.type)) {
			return;
		};

		const { zoom, y } = controller.viewport;
		const region = getTextRegion(el);
		const top = (el.y * zoom) + y + (region.y * zoom);
		const full = Math.max(24, region.h * zoom);
		const align = el.verticalAlign || (isShapeType(el.type) ? 'middle' : 'top');

		ta.style.height = 'auto';

		const content = Math.min(full, Math.max(24, ta.scrollHeight));
		const free = full - content;

		ta.style.height = `${content}px`;
		ta.style.top = `${top + ((align == 'middle') ? free / 2 : ((align == 'bottom') ? free : 0))}px`;
	};

	useEffect(() => {
		layoutEditor();
	}, [ editing, dummy ]);

	// --------------------------------------------------------- //
	// Menus

	const onExport = () => {
		if (controllerRef.current?.scene.count()) {
			setExportOpen(true);
		};
	};

	const onLibrary = () => setLibraryOpen(v => !v);

	const onMenu = () => {
		const controller = controllerRef.current;
		if (!controller) {
			return;
		};

		const options: any[] = [
			{ id: 'export', name: translate('canvasMenuExport'), caption: 'Ctrl Shift E' },
			{ id: 'library', name: translate('canvasMenuLibrary') },
			{ isDiv: true },
			{ id: 'zen', name: translate('canvasMenuZen'), caption: 'Alt Z', checkbox: zen },
			{ id: 'grid', name: translate('canvasMenuGrid'), caption: 'Ctrl \'', checkbox: controller.showGrid },
			{ id: 'fit', name: translate('canvasTool_fit') },
		];

		if (!readonly) {
			options.push({ isDiv: true }, { id: 'clear', name: translate('canvasMenuClear'), color: 'red' });
		};

		S.Menu.open('select', {
			element: '#canvasMenuButton',
			className: 'fixed',
			offsetY: 8,
			vertical: I.MenuDirection.Bottom,
			data: {
				options,
				onSelect: (e: any, item: any) => onMenuAction(item.id),
			},
		});
	};

	const onMenuAction = (id: string) => {
		const controller = controllerRef.current;
		if (!controller) {
			return;
		};

		switch (id) {
			case 'export': onExport(); break;
			case 'library': setLibraryOpen(true); break;
			case 'zen': setZen(v => !v); break;
			case 'grid':
				controller.showGrid = !controller.showGrid;
				controller.setViewport({ ...controller.viewport });
				break;

			case 'fit': controller.fit(); break;

			case 'clear':
				S.Popup.open('confirm', {
					data: {
						title: translate('canvasClearTitle'),
						text: translate('canvasClearText'),
						textConfirm: translate('commonDelete'),
						colorConfirm: 'red',
						onConfirm: () => {
							controller.clearAll();
							refresh();
						},
					},
				});
				break;
		};

		refresh();
	};

	const onContextMenu = (e: React.MouseEvent) => {
		e.preventDefault();

		const controller = controllerRef.current;
		if (!controller || editing) {
			return;
		};

		const hit = controller.contextAt(getPoint(e));
		const hasSelection = controller.scene.selected().length > 0;
		const options: any[] = [];

		if (readonly) {
			if (hasSelection) {
				options.push({ id: 'copy', name: translate('commonCopy'), caption: 'Ctrl C' });
			};
		} else {
			if (hasSelection) {
				options.push(
					{ id: 'cut', name: translate('commonCut'), caption: 'Ctrl X' },
					{ id: 'copy', name: translate('commonCopy'), caption: 'Ctrl C' },
				);
			};
			options.push({ id: 'paste', name: translate('commonPaste'), caption: 'Ctrl V', disabled: !controller.hasClipboard() });

			if (hasSelection) {
				options.push(
					{ isDiv: true },
					{ id: 'copyStyle', name: translate('canvasCopyStyle'), caption: 'Ctrl Alt C' },
					{ id: 'pasteStyle', name: translate('canvasPasteStyle'), caption: 'Ctrl Alt V', disabled: !controller.hasStyle() },
					{ isDiv: true },
					{ id: 'library', name: translate('canvasAddToLibrary') },
					{ id: 'front', name: translate('canvasBringToFront') },
					{ id: 'back', name: translate('canvasSendToBack') },
					{ id: 'duplicate', name: translate('canvasDuplicate'), caption: 'Ctrl D' },
					{ isDiv: true },
					{ id: 'delete', name: translate('commonDelete'), caption: 'Del', color: 'red' },
				);
			};
		};

		if (hit && (hit.type == ElementType.Object) && hit.targetObjectId) {
			options.unshift({ id: 'open', name: translate('canvasOpenInPanel') }, { isDiv: true });
		};

		if (!options.length) {
			return;
		};

		S.Menu.closeAll([], () => {
			S.Menu.open('select', {
				rect: { x: e.pageX, y: e.pageY, width: 0, height: 0 },
				noFlipX: true,
				data: {
					options,
					onSelect: (ev: any, item: any) => {
						switch (item.id) {
							case 'open': onOpenObject?.(hit.targetObjectId); break;
							case 'cut': controller.cut(); break;
							case 'copy': controller.copy(); break;
							case 'paste': controller.paste(); break;
							case 'copyStyle': controller.copyStyle(); break;
							case 'pasteStyle': controller.pasteStyle(); break;
							case 'library': setLibraryOpen(true); break;
							case 'front': controller.reorder('front'); break;
							case 'back': controller.reorder('back'); break;
							case 'duplicate': controller.duplicate(); break;
							case 'delete': controller.deleteSelection(); break;
						};
						refresh();
					},
				},
			});
		});
	};

	// Objects dragged from the sidebar or lists carry their ids in the drag payload
	const onDragOver = (e: React.DragEvent) => {
		if (!readonly) {
			e.preventDefault();
		};
	};

	const onDrop = (e: React.DragEvent) => {
		if (readonly) {
			return;
		};

		let data: any = null;
		try {
			data = JSON.parse(e.dataTransfer.getData('text/plain'));
		} catch (err) {};

		const ids: string[] = (data && Array.isArray(data.ids)) ? data.ids : [];
		if (!ids.length) {
			return;
		};

		e.preventDefault();

		const world = controllerRef.current.toWorld(getPoint(e));
		ids.filter(id => id && (id != rootId)).forEach((id, i) => addObject(id, { x: world.x + (i * 24), y: world.y + (i * 24) }));
	};

	// --------------------------------------------------------- //
	// Text editing

	const startEdit = (el: CanvasElement) => {
		rendererRef.current?.setHidden(el.id);
		setEditing({ id: el.id, text: el.text || '' });
		window.setTimeout(() => editorRef.current?.focus(), 0);
	};

	const commitEdit = () => {
		if (!editing) {
			return;
		};

		const value = editorRef.current ? editorRef.current.value : editing.text;
		const { id } = editing;

		setEditing(null);
		rendererRef.current?.setHidden('');
		controllerRef.current?.commitText(id, value);
		refresh();
	};

	const onEditorKeyDown = (e: React.KeyboardEvent) => {
		e.stopPropagation();

		if ((e.key == 'Escape') || ((e.key == 'Enter') && (e.metaKey || e.ctrlKey))) {
			e.preventDefault();
			commitEdit();
			nodeRef.current?.focus();
		};
	};

	// --------------------------------------------------------- //

	useEffect(() => {
		const scene = new Scene();
		const controller = new CanvasController(scene);
		const adapter = new CanvasAdapter(rootId, controller);
		const renderer = new CanvasRenderer(controller, getTheme(), getObject);

		controller.readonly = readonly;
		controller.setCallbacks({
			onCommit: changed => {
				adapter.push(changed);
				setOverLimit(scene.count() > SOFT_ELEMENT_LIMIT);
				loadObjects();
			},
			onViewport: () => refresh(),
			onToolChange: t => setTool(t),
			onRender: () => {
				renderer.requestRender();
				refresh();
			},
			onEditText: el => startEdit(el),
			onOpenObject: id => onOpenObject?.(id),
			onRequestObject: () => onAddObject(),
		});

		controllerRef.current = controller;
		rendererRef.current = renderer;
		adapterRef.current = adapter;

		scene.load(adapter.read());
		setOverLimit(scene.count() > SOFT_ELEMENT_LIMIT);

		const rect = nodeRef.current.getBoundingClientRect();
		controller.setSize(rect.width, rect.height);
		controller.fit();
		loadObjects();

		renderer.init(canvasRef.current, nodeRef.current).then(() => controller.fit());

		const unsubScene = scene.subscribe(change => {
			renderer.requestRender();

			// Remote changes should refresh the style bar and toolbar state too
			if (change.reason != 'local') {
				refresh();
			};
		});

		// Changes from other clients arrive through the block store
		// Delayed so that a burst of block events (paste, import, remote bulk edit) is merged once, not per event
		const unsubStore = reaction(() => adapter.signature(), () => {
			adapter.pull();
			setOverLimit(scene.count() > SOFT_ELEMENT_LIMIT);
			loadObjects();
		}, { delay: 60 });

		// Colors come from the theme, so rebuild the views when it changes
		// The object that is open in the side panel is outlined on the board
		const getOpened = () => String(S.Popup.get('page')?.param?.data?.matchPopup?.params?.id || '');
		// Previews follow edits made in the side panel or by others
		const unsubPreviews = reaction(
			() => objectIdsRef.current.split(',').filter(it => it).map(id => {
				const info = getObject(id);
				return `${info.name}|${info.text}|${info.blocks.map(b => `${b.style}${b.checked}${b.text}`).join('\n')}`;
			}).join('§'),
			() => {
				renderer.invalidateObjects();
				showPages(objectIdsRef.current.split(',').filter(it => it));
			},
			{ delay: 150 },
		);
		const unsubOpened = reaction(() => getOpened(), id => renderer.setHighlightObject(id), { fireImmediately: true });
		const unsubTheme = reaction(() => S.Common.getThemeClass(), () => renderer.setTheme(getTheme()));

		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = canvasRef.current.getBoundingClientRect();
			controller.wheel({ x: e.clientX - rect.left, y: e.clientY - rect.top }, e.deltaX, e.deltaY, e.ctrlKey || e.metaKey);
		};

		const onMouseDown = (e: MouseEvent) => {
			if (nodeRef.current && !nodeRef.current.contains(e.target as Node)) {
				keyboard.setFocus(false);
			};
		};

		canvasRef.current.addEventListener('wheel', onWheel, { passive: false });
		window.addEventListener('mousedown', onMouseDown);

		return () => {
			canvasRef.current?.removeEventListener('wheel', onWheel);
			window.removeEventListener('mousedown', onMouseDown);
			unsubScene();
			unsubStore();
			unsubTheme();
			unsubOpened();
			unsubPreviews();
			adapter.destroy();
			renderer.destroy();
			keyboard.setFocus(false);
			window.cancelAnimationFrame(frameRef.current);
			U.Subscription.destroyList([ subId ]);
		};
	}, [ rootId ]);

	useEffect(() => {
		if (controllerRef.current) {
			controllerRef.current.readonly = readonly;
		};
	}, [ readonly ]);

	useEffect(() => {
		const node = nodeRef.current;
		if (!node) {
			return;
		};

		const observer = new ResizeObserver(() => {
			const rect = node.getBoundingClientRect();
			controllerRef.current?.setSize(rect.width, rect.height);
		});

		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	useImperativeHandle(ref, () => ({
		getController: () => controllerRef.current,
		addObject: (id: string) => addObject(id),
	}));

	const controller = controllerRef.current;
	const editEl = (editing && controller) ? controller.scene.get(editing.id) : null;
	const cn = [ 'canvasWrap' ];
	const editStyle: any = {};

	if (editEl && controller) {
		const { zoom } = controller.viewport;
		const p = { x: (editEl.x * zoom) + controller.viewport.x, y: (editEl.y * zoom) + controller.viewport.y };
		const theme = J.Theme[S.Common.getThemeClass()] as any;
		const region = getTextRegion(editEl);
		const family = editEl.fontFamily || 'normal';

		editStyle.left = p.x + (region.x * zoom);
		editStyle.top = p.y + (region.y * zoom);
		editStyle.width = Math.max(40, region.w * zoom);
		editStyle.height = Math.max(24, region.h * zoom);
		editStyle.fontSize = (editEl.fontSize || 16) * zoom;
		editStyle.lineHeight = `${Math.round((editEl.fontSize || 16) * 1.3) * zoom}px`;
		editStyle.fontFamily = (family == 'hand') ? 'Caveat, cursive' : ((family == 'code') ? 'ui-monospace, Menlo, Consolas, monospace' : 'inherit');
		editStyle.color = (editEl.fill && ((editEl.fillStyle || 'solid') == 'solid')) ? (J.Theme[''] as any).color.default : theme.textColor[editEl.color || 'default'];
		editStyle.padding = 0;
		editStyle.textAlign = editEl.textAlign || (isShapeType(editEl.type) ? 'center' : 'left');
		editStyle.transformOrigin = `${((editEl.w / 2) - region.x) * zoom}px ${((editEl.h / 2) - region.y) * zoom}px`;
		editStyle.transform = `rotate(${editEl.angle || 0}rad)`;

		if (editEl.type == ElementType.Frame) {
			editStyle.left = p.x;
			editStyle.width = Math.max(120, editEl.w * zoom);
			editStyle.height = 24;
			editStyle.top = p.y - 28;
			editStyle.fontSize = 12;
			editStyle.lineHeight = '16px';
			editStyle.fontFamily = 'inherit';
			editStyle.textAlign = 'left';
			editStyle.transformOrigin = 'left center';
			editStyle.transform = 'none';
		};
	};

	if (readonly) {
		cn.push('isReadonly');
	};
	cn.push(`tool-${tool}`);
	void dummy;

	return (
		<div
			ref={nodeRef}
			className={cn.join(' ')}
			tabIndex={0}
			onKeyDown={onKeyDown}
			onKeyUp={onKeyUp}
			onPaste={onPaste}
			onMouseDownCapture={() => keyboard.setFocus(true)}
			onDragOver={onDragOver}
			onDrop={onDrop}
		>
			<div
				ref={canvasRef}
				className="canvasSurface"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onDoubleClick={onDoubleClick}
				onContextMenu={onContextMenu}
			/>

			{editing ? (
				<textarea
					ref={editorRef}
					className="canvasTextEditor"
					style={editStyle}
					defaultValue={editing.text}
					onBlur={commitEdit}
					onInput={layoutEditor}
					onKeyDown={onEditorKeyDown}
					placeholder={translate('canvasTextPlaceholder')}
				/>
			) : ''}

			{exportOpen && controller && rendererRef.current ? (
				<CanvasExport
					controller={controller}
					renderer={rendererRef.current}
					name={S.Detail.get(rootId, rootId, [ 'name' ]).name}
					onClose={() => setExportOpen(false)}
				/>
			) : ''}

			{zen ? <div className="canvasZenHint" onClick={() => setZen(false)}>{translate('canvasZenExit')}</div> : ''}

			{overLimit ? <div className="canvasLimit">{translate('canvasLimitWarning')}</div> : ''}

			{controller && !zen ? (
				<>
					{!readonly ? (
						<CanvasPanel controller={controller} tool={tool} onChange={refresh} />
					) : ''}

					{libraryOpen && rendererRef.current ? (
						<CanvasLibrary
							rootId={rootId}
							controller={controller}
							renderer={rendererRef.current}
							readonly={readonly}
							onAddObject={id => addObject(id)}
							onClose={() => setLibraryOpen(false)}
							onChange={refresh}
						/>
					) : ''}

					<CanvasToolbar
						controller={controller}
						tool={tool}
						readonly={readonly}
						onAddObject={onAddObject}
						onMenu={onMenu}
						onLibrary={onLibrary}
						onChange={refresh}
					/>
				</>
			) : ''}
		</div>
	);

});

export default MediaCanvas;
