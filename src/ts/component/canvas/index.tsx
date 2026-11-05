import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { reaction } from 'mobx';
import { I, S, U, J, keyboard, translate } from 'Lib';
import { CanvasController, CanvasElement, ElementType, Scene, SOFT_ELEMENT_LIMIT, Tool } from 'Lib/canvas';
import { CanvasRenderer, RendererTheme } from './renderer';
import { CanvasAdapter } from './adapter';
import CanvasToolbar from './toolbar';
import CanvasStylebar from './stylebar';

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
		muted: theme.graph.muted,
		selected: theme.graph.selected,
		highlight: theme.graph.highlight,
		card: theme.graph.bg,
		cardBorder: theme.graph.link,
		stroke: theme.color,
		fill,
		textColor: theme.textColor,
		fontFamily,
	};
};

const MediaCanvas = forwardRef<CanvasRef, Props>(({
	rootId,
	readonly = false,
	isPopup = false,
	onOpenObject,
}, ref) => {

	const nodeRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const controllerRef = useRef<CanvasController | null>(null);
	const rendererRef = useRef<CanvasRenderer | null>(null);
	const adapterRef = useRef<CanvasAdapter | null>(null);
	const editorRef = useRef<HTMLTextAreaElement>(null);
	const objectIdsRef = useRef('');
	const [ tool, setTool ] = useState<Tool>(Tool.Select);
	const [ editing, setEditing ] = useState<Editing | null>(null);
	const [ dummy, setDummy ] = useState(0);
	const [ overLimit, setOverLimit ] = useState(false);
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

	const getObject = (id: string) => {
		const object = S.Detail.get(subId, id, [ 'name', 'layout', 'type', 'isDeleted' ], true);
		const type = S.Record.getTypeById(object.type);

		return { name: object.isDeleted ? translate('commonDeletedObject') : (object.name || translate('defaultNamePage')), type: type?.name || '' };
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

		if (!controller || editing || ((e.target as HTMLElement).tagName == 'TEXTAREA')) {
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
		controllerRef.current?.addObjectCard(objectId, world || getCenter());
		loadObjects();
		refresh();
	};

	const onAddObject = () => {
		S.Menu.open('searchObject', {
			element: '#canvasAddObject',
			className: 'single fixed',
			offsetY: -8,
			vertical: I.MenuDirection.Top,
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

		const unsubScene = scene.subscribe(() => renderer.requestRender());

		// Changes from other clients arrive through the block store
		const unsubStore = reaction(() => adapter.signature(), () => {
			adapter.pull();
			setOverLimit(scene.count() > SOFT_ELEMENT_LIMIT);
			loadObjects();
		});

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

		const onThemeChange = () => renderer.setTheme(getTheme());

		canvasRef.current.addEventListener('wheel', onWheel, { passive: false });
		window.addEventListener('mousedown', onMouseDown);
		window.addEventListener('updateTheme', onThemeChange);

		return () => {
			canvasRef.current?.removeEventListener('wheel', onWheel);
			window.removeEventListener('mousedown', onMouseDown);
			window.removeEventListener('updateTheme', onThemeChange);
			unsubScene();
			unsubStore();
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
		const isText = editEl.type == ElementType.Text;
		const theme = J.Theme[S.Common.getThemeClass()] as any;

		editStyle.left = p.x;
		editStyle.top = p.y;
		editStyle.width = Math.max(40, editEl.w * zoom);
		editStyle.height = Math.max(24, editEl.h * zoom);
		editStyle.fontSize = (editEl.fontSize || 16) * zoom;
		editStyle.lineHeight = 1.3;
		editStyle.color = theme.textColor[editEl.color || 'default'];
		editStyle.padding = isText ? 0 : 12 * zoom;
		editStyle.textAlign = [ ElementType.Rect, ElementType.Ellipse ].includes(editEl.type) ? 'center' : 'left';
		editStyle.transform = `rotate(${editEl.angle || 0}rad)`;

		if (editEl.type == ElementType.Frame) {
			editStyle.height = 24;
			editStyle.top = p.y - 28;
			editStyle.fontSize = 12;
			editStyle.padding = 0;
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
			<canvas
				ref={canvasRef}
				className="canvasSurface"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onDoubleClick={onDoubleClick}
			/>

			{editing ? (
				<textarea
					ref={editorRef}
					className="canvasTextEditor"
					style={editStyle}
					defaultValue={editing.text}
					onBlur={commitEdit}
					onKeyDown={onEditorKeyDown}
					placeholder={translate('canvasTextPlaceholder')}
				/>
			) : ''}

			{overLimit ? <div className="canvasLimit">{translate('canvasLimitWarning')}</div> : ''}

			{controller ? (
				<>
					{!readonly ? (
						<CanvasStylebar controller={controller} onChange={refresh} />
					) : ''}

					<CanvasToolbar
						controller={controller}
						tool={tool}
						readonly={readonly}
						onAddObject={onAddObject}
						onChange={refresh}
					/>
				</>
			) : ''}
		</div>
	);

});

export default MediaCanvas;
