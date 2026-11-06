import { CanvasElement, DEFAULT_STYLE, ElementStyle, ElementType, Guide, Point, Rect, Tool, Viewport, MIN_SIZE } from './types';
import {
	anchorPoint, applyRoute, center, elementBounds, estimateTextHeight, expandRect, hitTest, isLinear, normalizeLinear, normalizeRect,
	rectContains, rectsIntersect, rotatePoint, simplify, unionBounds, worldPoints,
} from './geometry';
import { Scene } from './scene';
import { History, Snapshot } from './history';
import { fitRect, pan, screenToWorld, zoomAt } from './viewport';
import { defaultElement, newElementId } from './codec';
import { between } from './order';

export interface ControllerCallbacks {
	onCommit?: (changed: CanvasElement[]) => void;
	onViewport?: (vp: Viewport) => void;
	onToolChange?: (tool: Tool) => void;
	onEditText?: (el: CanvasElement) => void;
	onOpenObject?: (objectId: string) => void;
	onRender?: () => void;
	/** The number key for the image slot was pressed; Loom has no uploads here, so it opens the object search. */
	onRequestObject?: () => void;
};

export interface Modifiers {
	shift?: boolean;
	alt?: boolean;
	meta?: boolean;
	button?: number;
};

export interface Handle {
	id: string;
	point: Point;
};

type DragMode = 'none' | 'pan' | 'move' | 'resize' | 'rotate' | 'marquee' | 'draw' | 'erase';

interface Drag {
	mode: DragMode;
	startWorld: Point;
	startScreen: Point;
	origin: Map<string, CanvasElement>;
	before: Snapshot;
	handle?: string;
	moved: boolean;
	toggleId?: string;
};

const HIT_PX = 6;
const HANDLE_PX = 8;
const ROTATE_OFFSET_PX = 28;
const SNAP_PX = 6;
const NUDGE = 1;
const DEFAULTS = {
	shape: { w: 160, h: 100 },
	sticky: { w: 200, h: 160 },
	text: { w: 200, h: 28 },
	frame: { w: 480, h: 320 },
	object: { w: 320, h: 220 },
};

// Shared between canvases so elements can be copied from one canvas into another
let clipboard: CanvasElement[] = [];
let styleClipboard: Partial<CanvasElement> | null = null;

const STYLE_KEYS = [ 'color', 'fill', 'fillStyle', 'strokeWidth', 'strokeStyle', 'roughness', 'rounded', 'opacity', 'fontFamily', 'fontSize', 'textAlign', 'verticalAlign', 'arrowType', 'startHead', 'endHead' ];

const TOOL_KEYS: { [key: string]: Tool } = {
	v: Tool.Select,
	h: Tool.Hand,
	r: Tool.Rect,
	d: Tool.Diamond,
	o: Tool.Ellipse,
	l: Tool.Line,
	a: Tool.Arrow,
	p: Tool.Pen,
	t: Tool.Text,
	s: Tool.Sticky,
	f: Tool.Frame,
	e: Tool.Eraser,
	// Same number row as other whiteboards: 1 select, 2 rectangle, 3 diamond, 4 ellipse, 5 arrow, 6 line, 7 draw, 8 text, 0 eraser
	'1': Tool.Select,
	'2': Tool.Rect,
	'3': Tool.Diamond,
	'4': Tool.Ellipse,
	'5': Tool.Arrow,
	'6': Tool.Line,
	'7': Tool.Pen,
	'8': Tool.Text,
	'0': Tool.Eraser,
};

const SHAPES = [ ElementType.Rect, ElementType.Diamond, ElementType.Ellipse ];
const EDITABLE = [ ElementType.Text, ElementType.Sticky, ElementType.Rect, ElementType.Diamond, ElementType.Ellipse, ElementType.Frame, ElementType.Arrow, ElementType.Line ];

export class CanvasController {

	scene: Scene;
	history = new History();
	viewport: Viewport = { x: 0, y: 0, zoom: 1 };
	tool: Tool = Tool.Select;
	width = 0;
	height = 0;
	draft: CanvasElement | null = null;
	marquee: Rect | null = null;
	guides: Guide[] = [];
	hoverId = '';
	readonly = false;
	spaceDown = false;
	/** Keep the active drawing tool after drawing one element. */
	locked = false;
	showGrid = true;
	/** Style for new elements; changed from the properties panel. */
	defaults: ElementStyle = { ...DEFAULT_STYLE };
	/** Elements the eraser has touched in the current stroke, removed when the pointer is released. */
	erasing = new Set<string>();
	/** Replaced by the renderer with real text metrics; the estimate is only a fallback (tests, headless). */
	measureText: (text: string, width: number, fontSize: number, fontFamily?: string) => number = estimateTextHeight;
	private drag: Drag | null = null;
	private cb: ControllerCallbacks;

	constructor (scene: Scene, cb: ControllerCallbacks = {}) {
		this.scene = scene;
		this.cb = cb;
	};

	setCallbacks (cb: ControllerCallbacks) {
		this.cb = cb;
	};

	private render () {
		this.cb.onRender?.();
	};

	setSize (width: number, height: number) {
		this.width = width;
		this.height = height;
		this.render();
	};

	setViewport (vp: Viewport) {
		this.viewport = vp;
		this.cb.onViewport?.(vp);
		this.render();
	};

	setTool (tool: Tool) {
		if (this.readonly && ![ Tool.Select, Tool.Hand ].includes(tool)) {
			return;
		};

		this.tool = tool;
		this.draft = null;
		this.erasing.clear();
		this.cb.onToolChange?.(tool);
		this.render();
	};

	zoomBy (factor: number) {
		this.setViewport(zoomAt(this.viewport, { x: this.width / 2, y: this.height / 2 }, factor));
	};

	fit (ids?: string[]) {
		const list = ids ? ids.map(id => this.scene.get(id)).filter(it => it) : this.scene.list();
		const rect = unionBounds(list);

		if (!rect) {
			this.setViewport({ x: this.width / 2, y: this.height / 2, zoom: 1 });
			return;
		};
		this.setViewport(fitRect(rect, this.width, this.height));
	};

	toWorld (screen: Point): Point {
		return screenToWorld(this.viewport, screen);
	};

	// --------------------------------------------------------- //
	// Style for new elements

	toggleLock () {
		this.locked = !this.locked;
		this.render();
	};

	/** Style fields a new element of this type starts with, taken from the current defaults. */
	newStyle (type: ElementType): Partial<CanvasElement> {
		const d = this.defaults;
		const seed = Math.floor(Math.random() * 0x7fffffff);
		const base: Partial<CanvasElement> = { color: d.color, strokeWidth: d.strokeWidth, strokeStyle: d.strokeStyle, roughness: d.roughness, opacity: d.opacity, seed };

		if (SHAPES.includes(type)) {
			return { ...base, fill: d.fill, fillStyle: d.fillStyle, rounded: (type == ElementType.Ellipse) ? false : d.rounded };
		};

		switch (type) {
			case ElementType.Line:
				return { ...base, arrowType: d.arrowType };

			case ElementType.Arrow:
				return { ...base, arrowType: d.arrowType, startHead: d.startHead, endHead: d.endHead };

			case ElementType.Freehand:
				return { color: d.color, strokeWidth: d.strokeWidth, opacity: d.opacity, seed, roughness: 0 };

			case ElementType.Text:
				return { color: d.color, opacity: d.opacity, fontFamily: d.fontFamily, fontSize: d.fontSize, textAlign: d.textAlign, seed };

			case ElementType.Sticky:
				return { opacity: d.opacity, fontFamily: d.fontFamily, fontSize: d.fontSize, textAlign: d.textAlign, verticalAlign: d.verticalAlign, seed };

			case ElementType.Frame:
				return { seed };
		};

		return {};
	};

	// --------------------------------------------------------- //
	// Hit testing

	hitElement (world: Point, filter?: (el: CanvasElement) => boolean): CanvasElement | null {
		const tolerance = HIT_PX / this.viewport.zoom;
		const candidates = this.scene.query(expandRect({ x: world.x, y: world.y, w: 0, h: 0 }, tolerance + 2));

		for (let i = candidates.length - 1; i >= 0; i--) {
			const el = candidates[i];
			if ((!filter || filter(el)) && hitTest(el, world, tolerance)) {
				return el;
			};
		};
		return null;
	};

	/** Resize and rotate handles for a single selected element, in world space. */
	handles (): Handle[] {
		const sel = this.scene.selected();
		if ((sel.length != 1) || this.readonly) {
			return [];
		};

		const el = sel[0];
		const c = center(el);
		const rot = (p: Point) => el.angle ? rotatePoint(p, c, el.angle) : p;
		const x0 = el.x;
		const x1 = el.x + (el.w / 2);
		const x2 = el.x + el.w;
		const y0 = el.y;
		const y1 = el.y + (el.h / 2);
		const y2 = el.y + el.h;
		const list: Handle[] = [
			{ id: 'nw', point: rot({ x: x0, y: y0 }) },
			{ id: 'n', point: rot({ x: x1, y: y0 }) },
			{ id: 'ne', point: rot({ x: x2, y: y0 }) },
			{ id: 'e', point: rot({ x: x2, y: y1 }) },
			{ id: 'se', point: rot({ x: x2, y: y2 }) },
			{ id: 's', point: rot({ x: x1, y: y2 }) },
			{ id: 'sw', point: rot({ x: x0, y: y2 }) },
			{ id: 'w', point: rot({ x: x0, y: y1 }) },
			{ id: 'rotate', point: rot({ x: x1, y: y0 - (ROTATE_OFFSET_PX / this.viewport.zoom) }) },
		];

		return list;
	};

	private hitHandle (world: Point): string {
		const r = HANDLE_PX / this.viewport.zoom;
		const found = this.handles().find(h => Math.hypot(h.point.x - world.x, h.point.y - world.y) <= r);

		return found ? found.id : '';
	};

	// --------------------------------------------------------- //
	// Commit helpers

	private snapshot (ids: string[]): Snapshot {
		const s: Snapshot = new Map();

		ids.forEach(id => {
			const el = this.scene.get(id);
			s.set(id, (el && !el.deleted) ? { ...el } : null);
		});
		return s;
	};

	private commit (ids: string[], before: Snapshot) {
		const after = this.snapshot(ids);
		const changed = ids.map(id => this.scene.get(id)).filter(it => it);

		this.history.record(before, after);
		this.cb.onCommit?.(changed);
		this.render();
	};

	private applySnapshot (snap: Snapshot) {
		const changed: CanvasElement[] = [];
		const upserts: CanvasElement[] = [];
		const removals: string[] = [];

		snap.forEach((el, id) => {
			if (el) {
				upserts.push({ ...el, deleted: false });
			} else
			if (this.scene.get(id) && !this.scene.get(id).deleted) {
				removals.push(id);
			};
		});

		changed.push(...this.scene.upsert(upserts));
		changed.push(...this.scene.remove(removals));
		changed.push(...this.updateBindings(changed.map(el => el.id)));
		this.cb.onCommit?.(changed);
		this.render();
	};

	undo () {
		const snap = this.history.undo();
		if (snap) {
			this.applySnapshot(snap);
		};
	};

	redo () {
		const snap = this.history.redo();
		if (snap) {
			this.applySnapshot(snap);
		};
	};

	// --------------------------------------------------------- //
	// Arrow and line bindings

	/** Re-route lines and arrows that are attached to the given elements. Returns the elements it changed. */
	updateBindings (movedIds: string[]): CanvasElement[] {
		const moved = new Set(movedIds);
		const result: CanvasElement[] = [];

		this.scene.list().forEach(el => {
			if (![ ElementType.Arrow, ElementType.Line ].includes(el.type) || (!el.startId && !el.endId)) {
				return;
			};
			if (!moved.has(el.id) && !moved.has(el.startId) && !moved.has(el.endId)) {
				return;
			};

			const next = this.route(el);
			if (next) {
				result.push(...this.scene.upsert([ next ]));
			};
		});
		return result;
	};

	private route (el: CanvasElement): CanvasElement | null {
		const pts = worldPoints(el);
		if (pts.length < 2) {
			return null;
		};

		const startEl = el.startId ? this.scene.get(el.startId) : null;
		const endEl = el.endId ? this.scene.get(el.endId) : null;
		const first = pts[0];
		const last = pts[pts.length - 1];
		const a = (startEl && !startEl.deleted) ? anchorPoint(startEl, (endEl && !endEl.deleted) ? center(endEl) : last) : first;
		const b = (endEl && !endEl.deleted) ? anchorPoint(endEl, (startEl && !startEl.deleted) ? center(startEl) : first) : last;

		if ((a.x == first.x) && (a.y == first.y) && (b.x == last.x) && (b.y == last.y)) {
			return null;
		};

		return applyRoute({ ...el, x: a.x, y: a.y, points: [ [ 0, 0 ], [ b.x - a.x, b.y - a.y ] ] });
	};

	private unbind (ids: string[]): CanvasElement[] {
		const gone = new Set(ids);
		const list = this.scene.list().filter(el => gone.has(el.startId) || gone.has(el.endId)).map(el => ({
			...el,
			startId: gone.has(el.startId) ? '' : el.startId,
			endId: gone.has(el.endId) ? '' : el.endId,
		}));

		return this.scene.upsert(list);
	};

	// --------------------------------------------------------- //
	// Pointer input (screen coordinates)

	pointerDown (screen: Point, mods: Modifiers = {}) {
		const world = this.toWorld(screen);

		if ((mods.button == 1) || (this.tool == Tool.Hand) || this.spaceDown) {
			this.drag = { mode: 'pan', startWorld: world, startScreen: screen, origin: new Map(), before: new Map(), moved: false };
			return;
		};

		if (this.readonly) {
			return;
		};

		if (this.tool == Tool.Select) {
			const handle = this.hitHandle(world);
			if (handle) {
				const el = this.scene.selected()[0];
				this.drag = {
					mode: (handle == 'rotate') ? 'rotate' : 'resize',
					handle,
					startWorld: world,
					startScreen: screen,
					origin: new Map([ [ el.id, { ...el } ] ]),
					before: this.snapshot([ el.id ]),
					moved: false,
				};
				return;
			};

			const hit = this.hitElement(world);
			if (hit) {
				let toggleId = '';

				if (!this.scene.selection.has(hit.id)) {
					this.scene.setSelection(mods.shift ? [ ...Array.from(this.scene.selection), hit.id ] : [ hit.id ]);
				} else
				if (mods.shift) {
					toggleId = hit.id;
				};

				this.startMove(world, screen);
				this.drag.toggleId = toggleId;
				this.render();
				return;
			};

			if (!mods.shift) {
				this.scene.setSelection([]);
			};
			this.drag = { mode: 'marquee', startWorld: world, startScreen: screen, origin: new Map(), before: new Map(), moved: false };
			this.marquee = { x: world.x, y: world.y, w: 0, h: 0 };
			this.render();
			return;
		};

		if (this.tool == Tool.Eraser) {
			this.drag = { mode: 'erase', startWorld: world, startScreen: screen, origin: new Map(), before: new Map(), moved: false };
			this.eraseAt(world);
			return;
		};

		this.startDraw(world, screen);
	};

	private eraseAt (world: Point) {
		const hit = this.hitElement(world);

		if (hit && !this.erasing.has(hit.id)) {
			this.erasing.add(hit.id);
			this.render();
		};
	};

	private startMove (world: Point, screen: Point) {
		const origin = new Map<string, CanvasElement>();

		this.scene.selected().forEach(el => {
			origin.set(el.id, { ...el });

			// A frame carries everything that sits fully inside it
			if (el.type == ElementType.Frame) {
				const bounds = elementBounds(el);

				this.scene.query(bounds).forEach(child => {
					if ((child.id != el.id) && !origin.has(child.id) && rectContains(bounds, elementBounds(child))) {
						origin.set(child.id, { ...child });
					};
				});
			};
		});

		this.drag = {
			mode: 'move',
			startWorld: world,
			startScreen: screen,
			origin,
			before: this.snapshot(Array.from(origin.keys())),
			moved: false,
		};
	};

	private startDraw (world: Point, screen: Point) {
		const id = newElementId();
		const z = this.scene.nextZ();
		let el: CanvasElement | null = null;

		switch (this.tool) {
			case Tool.Rect:
			case Tool.Diamond:
			case Tool.Ellipse: {
				const type = (this.tool == Tool.Rect) ? ElementType.Rect : ((this.tool == Tool.Diamond) ? ElementType.Diamond : ElementType.Ellipse);

				el = defaultElement(type, id, z, { ...this.newStyle(type), x: world.x, y: world.y });
				break;
			};

			case Tool.Frame:
				el = defaultElement(ElementType.Frame, id, z, { ...this.newStyle(ElementType.Frame), x: world.x, y: world.y, strokeWidth: 1, text: '' });
				break;

			case Tool.Line:
			case Tool.Arrow: {
				const startEl = this.hitElement(world, it => !isLinear(it));
				const type = (this.tool == Tool.Line) ? ElementType.Line : ElementType.Arrow;

				el = defaultElement(type, id, z, {
					...this.newStyle(type), x: world.x, y: world.y, points: [ [ 0, 0 ], [ 0, 0 ] ], startId: startEl?.id || '',
				});
				break;
			};

			case Tool.Pen:
				el = defaultElement(ElementType.Freehand, id, z, { ...this.newStyle(ElementType.Freehand), x: world.x, y: world.y, points: [ [ 0, 0 ] ] });
				break;

			case Tool.Text:
			case Tool.Sticky:
				// Created on pointer up so a click and a drag are both fine
				this.drag = { mode: 'draw', startWorld: world, startScreen: screen, origin: new Map(), before: new Map(), moved: false };
				return;
		};

		if (!el) {
			return;
		};

		this.draft = el;
		this.drag = { mode: 'draw', startWorld: world, startScreen: screen, origin: new Map(), before: new Map(), moved: false };
		this.render();
	};

	pointerMove (screen: Point, mods: Modifiers = {}) {
		const world = this.toWorld(screen);
		const drag = this.drag;

		if (!drag) {
			const hit = (this.tool == Tool.Select) && !this.readonly ? this.hitElement(world) : null;
			const id = hit ? hit.id : '';

			if (id != this.hoverId) {
				this.hoverId = id;
				this.render();
			};
			return;
		};

		if ((Math.abs(screen.x - drag.startScreen.x) > 2) || (Math.abs(screen.y - drag.startScreen.y) > 2)) {
			drag.moved = true;
		};

		switch (drag.mode) {
			case 'pan':
				this.setViewport(pan(this.viewport, screen.x - drag.startScreen.x, screen.y - drag.startScreen.y));
				drag.startScreen = screen;
				break;

			case 'move':
				if (drag.moved) {
					this.doMove(world, mods);
				};
				break;

			case 'resize':
				this.doResize(world, mods);
				break;

			case 'rotate':
				this.doRotate(world, mods);
				break;

			case 'marquee':
				this.marquee = normalizeRect({ x: drag.startWorld.x, y: drag.startWorld.y, w: world.x - drag.startWorld.x, h: world.y - drag.startWorld.y });
				this.scene.setSelection(this.scene.query(this.marquee).filter(el => rectsIntersect(this.marquee, elementBounds(el))).map(el => el.id));
				this.render();
				break;

			case 'draw':
				this.doDraw(world, mods);
				break;

			case 'erase':
				this.eraseAt(world);
				break;
		};
	};

	pointerUp (screen: Point, mods: Modifiers = {}) {
		const drag = this.drag;
		this.drag = null;

		if (!drag) {
			return;
		};

		const world = this.toWorld(screen);

		switch (drag.mode) {
			case 'marquee':
				this.marquee = null;
				this.render();
				break;

			case 'move':
				this.guides = [];

				if (!drag.moved) {
					if (drag.toggleId) {
						this.scene.setSelection(Array.from(this.scene.selection).filter(id => id != drag.toggleId));
					};
					this.render();
					break;
				};

				this.finishChange(Array.from(drag.origin.keys()), drag.before);
				break;

			case 'resize':
			case 'rotate':
				this.finishChange(Array.from(drag.origin.keys()), drag.before);
				break;

			case 'draw':
				this.finishDraw(world, drag);
				break;

			case 'erase': {
				const ids = Array.from(this.erasing);

				this.erasing.clear();
				this.deleteIds(ids);
				this.render();
				break;
			};
		};
	};

	private finishChange (ids: string[], before: Snapshot) {
		const changed = this.updateBindings(ids).map(el => el.id);
		const all = Array.from(new Set(ids.concat(changed)));

		// Bindings re-route arrows that were not part of the snapshot, include them in history
		all.forEach(id => {
			if (!before.has(id)) {
				const el = this.scene.get(id);
				before.set(id, el ? { ...el } : null);
			};
		});

		this.commit(all, before);
	};

	private doMove (world: Point, mods: Modifiers) {
		const drag = this.drag;
		let dx = world.x - drag.startWorld.x;
		let dy = world.y - drag.startWorld.y;

		const originals = Array.from(drag.origin.values());
		const startBounds = unionBounds(originals);

		this.guides = [];

		if (startBounds && !mods.alt) {
			const snap = this.snap({ x: startBounds.x + dx, y: startBounds.y + dy, w: startBounds.w, h: startBounds.h }, new Set(drag.origin.keys()));
			dx += snap.dx;
			dy += snap.dy;
			this.guides = snap.guides;
		};

		const list = originals.map(el => ({ ...el, x: el.x + dx, y: el.y + dy }));
		this.scene.upsert(list);
		this.updateBindings(list.map(el => el.id));
		this.render();
	};

	/** Snap a moving rectangle to edges and centres of nearby elements. */
	private snap (rect: Rect, skip: Set<string>): { dx: number, dy: number, guides: Guide[] } {
		const threshold = SNAP_PX / this.viewport.zoom;
		const near = this.scene.query(expandRect(rect, threshold * 2)).filter(el => !skip.has(el.id));
		const xs = [ rect.x, rect.x + (rect.w / 2), rect.x + rect.w ];
		const ys = [ rect.y, rect.y + (rect.h / 2), rect.y + rect.h ];
		let bestX: { d: number, value: number, from: number, to: number } | null = null;
		let bestY: { d: number, value: number, from: number, to: number } | null = null;

		near.forEach(el => {
			const b = elementBounds(el);
			const targetsX = [ b.x, b.x + (b.w / 2), b.x + b.w ];
			const targetsY = [ b.y, b.y + (b.h / 2), b.y + b.h ];

			xs.forEach(x => targetsX.forEach(t => {
				const d = t - x;
				if ((Math.abs(d) <= threshold) && (!bestX || (Math.abs(d) < Math.abs(bestX.d)))) {
					bestX = { d, value: t, from: Math.min(b.y, rect.y), to: Math.max(b.y + b.h, rect.y + rect.h) };
				};
			}));

			ys.forEach(y => targetsY.forEach(t => {
				const d = t - y;
				if ((Math.abs(d) <= threshold) && (!bestY || (Math.abs(d) < Math.abs(bestY.d)))) {
					bestY = { d, value: t, from: Math.min(b.x, rect.x), to: Math.max(b.x + b.w, rect.x + rect.w) };
				};
			}));
		});

		const guides: Guide[] = [];
		if (bestX) {
			guides.push({ axis: 'x', value: bestX.value, from: bestX.from, to: bestX.to });
		};
		if (bestY) {
			guides.push({ axis: 'y', value: bestY.value, from: bestY.from, to: bestY.to });
		};

		return { dx: bestX ? bestX.d : 0, dy: bestY ? bestY.d : 0, guides };
	};

	private doResize (world: Point, mods: Modifiers) {
		const drag = this.drag;
		const el0 = Array.from(drag.origin.values())[0];
		const h = drag.handle;
		const c0 = center(el0);
		const p = el0.angle ? rotatePoint(world, c0, -el0.angle) : world;
		let left = el0.x;
		let right = el0.x + el0.w;
		let top = el0.y;
		let bottom = el0.y + el0.h;

		if (h.includes('w')) {
			left = Math.min(p.x, right - MIN_SIZE);
		};
		if (h.includes('e')) {
			right = Math.max(p.x, left + MIN_SIZE);
		};
		if (h.includes('n')) {
			top = Math.min(p.y, bottom - MIN_SIZE);
		};
		if (h.includes('s')) {
			bottom = Math.max(p.y, top + MIN_SIZE);
		};

		let w = right - left;
		let hh = bottom - top;

		// Shift keeps the aspect ratio on corner handles
		if (mods.shift && (h.length == 2) && el0.w && el0.h) {
			const ratio = el0.w / el0.h;
			if ((w / hh) > ratio) {
				hh = w / ratio;
			} else {
				w = hh * ratio;
			};

			if (h.includes('w')) {
				left = right - w;
			} else {
				right = left + w;
			};
			if (h.includes('n')) {
				top = bottom - hh;
			} else {
				bottom = top + hh;
			};
		};

		const newCenterLocal = { x: left + (w / 2), y: top + (hh / 2) };
		const newCenter = el0.angle ? rotatePoint(newCenterLocal, c0, el0.angle) : newCenterLocal;
		const next: CanvasElement = { ...el0, x: newCenter.x - (w / 2), y: newCenter.y - (hh / 2), w, h: hh };

		if (isLinear(el0) && el0.points) {
			const sx = el0.w ? w / el0.w : 1;
			const sy = el0.h ? hh / el0.h : 1;

			next.points = el0.points.map(pt => [ pt[0] * sx, pt[1] * sy ]);
		};

		if (el0.type == ElementType.Text) {
			next.h = this.measureText(el0.text, w, el0.fontSize || 16, el0.fontFamily);
		};

		this.scene.upsert([ next ]);
		this.updateBindings([ next.id ]);
		this.render();
	};

	private doRotate (world: Point, mods: Modifiers) {
		const el0 = Array.from(this.drag.origin.values())[0];
		const c = center(el0);
		let angle = Math.atan2(world.y - c.y, world.x - c.x) + (Math.PI / 2);

		if (mods.shift) {
			const step = Math.PI / 12;
			angle = Math.round(angle / step) * step;
		};

		this.scene.upsert([ { ...el0, angle } ]);
		this.render();
	};

	private doDraw (world: Point, mods: Modifiers) {
		const el = this.draft;
		if (!el) {
			return;
		};

		const start = this.drag.startWorld;

		switch (el.type) {
			case ElementType.Rect:
			case ElementType.Diamond:
			case ElementType.Ellipse:
			case ElementType.Frame: {
				let w = world.x - start.x;
				let h = world.y - start.y;

				if (mods.shift) {
					const size = Math.max(Math.abs(w), Math.abs(h));
					w = Math.sign(w || 1) * size;
					h = Math.sign(h || 1) * size;
				};

				this.draft = { ...el, ...normalizeRect({ x: start.x, y: start.y, w, h }) };
				break;
			};

			case ElementType.Line:
			case ElementType.Arrow: {
				let end = world;

				if (mods.shift) {
					const dx = world.x - start.x;
					const dy = world.y - start.y;
					const step = Math.PI / 4;
					const angle = Math.round(Math.atan2(dy, dx) / step) * step;
					const len = Math.hypot(dx, dy);

					end = { x: start.x + (Math.cos(angle) * len), y: start.y + (Math.sin(angle) * len) };
				};

				this.draft = applyRoute({ ...el, points: [ [ 0, 0 ], [ end.x - start.x, end.y - start.y ] ] });
				break;
			};

			case ElementType.Freehand:
				this.draft = { ...el, points: [ ...el.points, [ world.x - el.x, world.y - el.y ] ] };
				break;
		};

		this.render();
	};

	private finishDraw (world: Point, drag: Drag) {
		const z = this.scene.nextZ();
		let el = this.draft;

		this.draft = null;

		if (!el) {
			// Text and sticky tools create on release
			if ([ Tool.Text, Tool.Sticky ].includes(this.tool)) {
				const isText = this.tool == Tool.Text;
				const size = isText ? DEFAULTS.text : DEFAULTS.sticky;
				const x = world.x - (isText ? 0 : size.w / 2);
				const y = world.y - (isText ? 0 : size.h / 2);

				const type = isText ? ElementType.Text : ElementType.Sticky;
				const style = this.newStyle(type);

				el = defaultElement(type, newElementId(), z, {
					...style, x, y, w: size.w, h: isText ? this.measureText(' ', size.w, style.fontSize, style.fontFamily) : size.h, text: '', fill: isText ? '' : 'yellow',
				});
				this.insertAndEdit(el);
			};
			return;
		};

		switch (el.type) {
			case ElementType.Rect:
			case ElementType.Diamond:
			case ElementType.Ellipse:
			case ElementType.Frame:
				if (!drag.moved || (el.w < MIN_SIZE) || (el.h < MIN_SIZE)) {
					const size = (el.type == ElementType.Frame) ? DEFAULTS.frame : DEFAULTS.shape;
					el = { ...el, x: drag.startWorld.x - (size.w / 2), y: drag.startWorld.y - (size.h / 2), w: size.w, h: size.h };
				};
				break;

			case ElementType.Line:
			case ElementType.Arrow: {
				const pts = el.points;

				if (!drag.moved || (Math.hypot(pts[pts.length - 1][0], pts[pts.length - 1][1]) < MIN_SIZE)) {
					this.render();
					return;
				};

				const endEl = this.hitElement(world, it => !isLinear(it) && (it.id != el.startId));
				el = { ...el, endId: endEl?.id || '' };
				el = this.route(el) || el;
				el = applyRoute(el);
				break;
			};

			case ElementType.Freehand: {
				if ((el.points.length < 2) && !drag.moved) {
					// A dot
					el = { ...el, points: [ [ 0, 0 ], [ 0.1, 0.1 ] ] };
				} else {
					el = { ...el, points: simplify(el.points, 1.2 / this.viewport.zoom) };
				};
				el = normalizeLinear(el);
				break;
			};
		};

		const before: Snapshot = new Map([ [ el.id, null ] ]);
		this.scene.upsert([ el ]);
		this.scene.setSelection([ el.id ]);
		this.commit([ el.id ], before);

		if ((this.tool != Tool.Pen) && !this.locked) {
			this.setTool(Tool.Select);
		};
	};

	private insertAndEdit (el: CanvasElement) {
		const before: Snapshot = new Map([ [ el.id, null ] ]);
		const [ saved ] = this.scene.upsert([ el ]);

		this.scene.setSelection([ saved.id ]);
		// Not committed to the middleware until the text is entered
		this.history.record(before, this.snapshot([ saved.id ]));
		this.setTool(Tool.Select);
		this.cb.onEditText?.(saved);
	};

	doubleClick (screen: Point) {
		if (this.readonly) {
			return;
		};

		const world = this.toWorld(screen);
		const hit = this.hitElement(world);

		if (hit) {
			if (EDITABLE.includes(hit.type)) {
				this.scene.setSelection([ hit.id ]);
				this.cb.onEditText?.(hit);
			} else
			if ((hit.type == ElementType.Object) && hit.targetObjectId) {
				this.cb.onOpenObject?.(hit.targetObjectId);
			};
			return;
		};

		// Double click on empty space drops a text box
		const z = this.scene.nextZ();
		const el = defaultElement(ElementType.Text, newElementId(), z, {
			...this.newStyle(ElementType.Text), x: world.x, y: world.y, w: DEFAULTS.text.w, h: DEFAULTS.text.h, text: '',
		});
		this.insertAndEdit(el);
	};

	wheel (screen: Point, dx: number, dy: number, zoomGesture: boolean) {
		if (zoomGesture) {
			this.setViewport(zoomAt(this.viewport, screen, Math.exp(-dy * 0.01)));
		} else {
			this.setViewport(pan(this.viewport, -dx, -dy));
		};
	};

	// --------------------------------------------------------- //
	// Editing operations

	/** Called by the DOM text editor when the user finishes typing. */
	commitText (id: string, text: string) {
		const el = this.scene.get(id);
		if (!el || el.deleted) {
			return;
		};

		const trimmed = String(text || '');
		const isBoxless = el.type == ElementType.Text;

		if (!trimmed.trim() && isBoxless) {
			this.deleteIds([ id ]);
			return;
		};

		const before = this.snapshot([ id ]);
		const next: CanvasElement = { ...el, text: trimmed };

		if (isBoxless) {
			next.h = this.measureText(trimmed, el.w, el.fontSize || 16, el.fontFamily);
		};

		this.scene.upsert([ next ]);
		this.commit([ id ], before);
	};

	deleteIds (ids: string[]) {
		const live = ids.filter(id => this.scene.get(id) && !this.scene.get(id).deleted);
		if (!live.length) {
			return;
		};

		const unbound = this.scene.list().filter(el => !live.includes(el.id) && (live.includes(el.startId) || live.includes(el.endId))).map(el => el.id);
		const before = this.snapshot(live.concat(unbound));
		const changed: CanvasElement[] = [];

		changed.push(...this.unbind(live));
		changed.push(...this.scene.remove(live));
		this.history.record(before, this.snapshot(live.concat(unbound)));
		this.cb.onCommit?.(changed);
		this.render();
	};

	deleteSelection () {
		this.deleteIds(Array.from(this.scene.selection));
	};

	/** Applies a style to the selection and remembers it for the next elements. */
	setStyle (patch: Partial<CanvasElement>) {
		const sel = this.scene.selected();

		Object.keys(patch).forEach(key => {
			if (key in this.defaults) {
				(this.defaults as any)[key] = (patch as any)[key];
			};
		});

		if (!sel.length) {
			this.render();
			return;
		};

		const ids = sel.map(el => el.id);
		const before = this.snapshot(ids);

		const textual = [ 'fontSize', 'fontFamily' ].some(key => key in patch);

		this.scene.upsert(sel.map(el => {
			const next = { ...el, ...patch };

			if (('arrowType' in patch) && [ ElementType.Line, ElementType.Arrow ].includes(el.type)) {
				return applyRoute(next);
			};

			if (textual && (el.type == ElementType.Text)) {
				next.h = this.measureText(next.text || ' ', next.w, next.fontSize || 16, next.fontFamily);
			};
			return next;
		}));
		this.commit(ids, before);
	};

	reorder (action: 'front' | 'back' | 'forward' | 'backward') {
		const sel = this.scene.selected();
		if (!sel.length) {
			return;
		};

		const ids = sel.map(el => el.id);
		const before = this.snapshot(ids);
		const list: CanvasElement[] = [];

		if (action == 'front') {
			let top = this.scene.topZ();
			sel.forEach(el => {
				top = between(top, null);
				list.push({ ...el, z: top });
			});
		} else
		if (action == 'back') {
			let bottom = this.scene.bottomZ();
			sel.slice().reverse().forEach(el => {
				bottom = between(null, bottom);
				list.push({ ...el, z: bottom });
			});
		} else {
			sel.forEach(el => {
				const z = this.scene.zAround(el.id, action == 'forward');
				if (z) {
					list.push({ ...el, z });
				};
			});
		};

		if (!list.length) {
			return;
		};

		this.scene.upsert(list);
		this.commit(ids, before);
	};

	copy () {
		clipboard = this.scene.selected().map(el => ({ ...el }));
	};

	cut () {
		this.copy();
		this.deleteSelection();
	};

	paste (offset = 24) {
		if (!clipboard.length || this.readonly) {
			return;
		};

		const map = new Map<string, string>();
		clipboard.forEach(el => map.set(el.id, newElementId()));

		let top = this.scene.topZ();
		const list = clipboard.map(el => {
			top = between(top, null);

			return {
				...el,
				id: map.get(el.id),
				x: el.x + offset,
				y: el.y + offset,
				z: top,
				startId: map.get(el.startId) || '',
				endId: map.get(el.endId) || '',
			};
		});

		const ids = list.map(el => el.id);
		const before: Snapshot = new Map(ids.map(id => [ id, null ]));

		this.scene.upsert(list);
		this.scene.setSelection(ids);
		this.commit(ids, before);

		// Next paste lands further away, like in most editors
		clipboard = clipboard.map(el => ({ ...el, x: el.x + offset, y: el.y + offset }));
	};

	duplicate () {
		this.copy();
		this.paste();
	};

	/** Right click: selects the element under the pointer (unless it is already part of the selection) and returns it. */
	contextAt (screen: Point): CanvasElement | null {
		const hit = this.hitElement(this.toWorld(screen));

		if (hit && !this.scene.selection.has(hit.id)) {
			this.scene.setSelection([ hit.id ]);
			this.render();
		} else
		if (!hit) {
			this.scene.setSelection([]);
			this.render();
		};
		return hit;
	};

	hasClipboard (): boolean {
		return !!clipboard.length;
	};

	/** Style of the first selected element, applied to other elements with pasteStyle. */
	copyStyle () {
		const [ el ] = this.scene.selected();
		if (!el) {
			return;
		};

		const picked: Partial<CanvasElement> = {};

		STYLE_KEYS.forEach(key => {
			if ((el as any)[key] !== undefined) {
				(picked as any)[key] = (el as any)[key];
			};
		});
		styleClipboard = picked;
	};

	hasStyle (): boolean {
		return !!styleClipboard;
	};

	pasteStyle () {
		const sel = this.scene.selected();
		if (!styleClipboard || !sel.length || this.readonly) {
			return;
		};

		const ids = sel.map(el => el.id);
		const before = this.snapshot(ids);
		const style = styleClipboard;

		this.scene.upsert(sel.map(el => {
			const next: any = { ...el };

			// Only properties the target element type understands are taken over
			Object.keys(style).forEach(key => {
				if ((key in this.newStyle(el.type)) || (key == 'color') || (key == 'opacity')) {
					next[key] = (style as any)[key];
				};
			});
			return applyRoute(next);
		}));
		this.commit(ids, before);
	};

	/** Inserts copies of the elements (library items, other canvases) so that their middle lands on `at`. */
	insertElements (items: CanvasElement[], at: Point) {
		if (!items.length || this.readonly) {
			return;
		};

		const b = unionBounds(items);
		const dx = at.x - (b.x + (b.w / 2));
		const dy = at.y - (b.y + (b.h / 2));
		const map = new Map<string, string>();

		items.forEach(el => map.set(el.id, newElementId()));

		let top = this.scene.topZ();
		const list = items.map(el => {
			top = between(top, null);

			return {
				...el,
				id: map.get(el.id),
				x: el.x + dx,
				y: el.y + dy,
				z: top,
				v: 1,
				deleted: false,
				startId: map.get(el.startId) || '',
				endId: map.get(el.endId) || '',
			};
		});

		const ids = list.map(el => el.id);
		const before: Snapshot = new Map(ids.map(id => [ id, null ]));

		this.scene.upsert(list);
		this.scene.setSelection(ids);
		this.commit(ids, before);
	};

	/** Deletes everything. Can be undone. */
	clearAll () {
		this.deleteIds(this.scene.list().map(el => el.id));
	};

	selectAll () {
		this.scene.setSelection(this.scene.list().map(el => el.id));
		this.render();
	};

	/** Adds a card that points at a Loom object. world is the drop point (centre of the card). */
	addObjectCard (objectId: string, world: Point, hint?: { w: number, h: number }) {
		const existing = this.scene.list().find(el => (el.type == ElementType.Object) && (el.targetObjectId == objectId));
		const size = hint || DEFAULTS.object;
		const el = defaultElement(ElementType.Object, newElementId(), this.scene.nextZ(), {
			x: world.x - (size.w / 2),
			y: world.y - (size.h / 2) + (existing ? 16 : 0),
			w: size.w,
			h: size.h,
			targetObjectId: objectId,
		});

		const before: Snapshot = new Map([ [ el.id, null ] ]);
		this.scene.upsert([ el ]);
		this.scene.setSelection([ el.id ]);
		this.commit([ el.id ], before);
	};

	nudge (dx: number, dy: number) {
		const sel = this.scene.selected();
		if (!sel.length || this.readonly) {
			return;
		};

		const ids = sel.map(el => el.id);
		const before = this.snapshot(ids);

		this.scene.upsert(sel.map(el => ({ ...el, x: el.x + dx, y: el.y + dy })));
		const moved = this.updateBindings(ids).map(el => el.id);
		moved.forEach(id => !before.has(id) && before.set(id, { ...this.scene.get(id) }));
		this.commit(Array.from(new Set(ids.concat(moved))), before);
	};

	/** Returns true when the key was handled. Text editing keys never reach this. */
	keyDown (e: { key: string, shift?: boolean, alt?: boolean, meta?: boolean }): boolean {
		const key = e.key.toLowerCase();

		if (key == ' ') {
			this.spaceDown = true;
			return true;
		};

		if (e.meta) {
			switch (key) {
				case 'z': e.shift ? this.redo() : this.undo(); return true;
				case 'y': this.redo(); return true;
				case 'a': this.selectAll(); return true;
				case 'c': this.copy(); return true;
				case 'x': this.cut(); return true;
				case 'v': this.paste(); return true;
				case 'd': this.duplicate(); return true;
				case '0': this.fit(); return true;
				case '=':
				case '+': this.zoomBy(1.2); return true;
				case '-': this.zoomBy(1 / 1.2); return true;
				case ']': this.reorder(e.shift ? 'front' : 'forward'); return true;
				case '[': this.reorder(e.shift ? 'back' : 'backward'); return true;
			};
			return false;
		};

		switch (key) {
			case 'delete':
			case 'backspace':
				this.deleteSelection();
				return true;

			case 'escape':
				this.draft = null;
				this.scene.setSelection([]);
				this.setTool(Tool.Select);
				return true;

			case 'enter': {
				const sel = this.scene.selected();
				if ((sel.length == 1) && EDITABLE.includes(sel[0].type)) {
					this.cb.onEditText?.(sel[0]);
					return true;
				};
				return false;
			};

			case 'q':
				this.toggleLock();
				return true;

			case '9':
				this.cb.onRequestObject?.();
				return true;

			case 'arrowleft': this.nudge(-(e.shift ? 10 : NUDGE), 0); return true;
			case 'arrowright': this.nudge(e.shift ? 10 : NUDGE, 0); return true;
			case 'arrowup': this.nudge(0, -(e.shift ? 10 : NUDGE)); return true;
			case 'arrowdown': this.nudge(0, e.shift ? 10 : NUDGE); return true;
		};

		if (TOOL_KEYS[key] && !e.alt) {
			this.setTool(TOOL_KEYS[key]);
			return true;
		};

		return false;
	};

	keyUp (e: { key: string }) {
		if (e.key == ' ') {
			this.spaceDown = false;
		};
	};

	get isDragging (): boolean {
		return !!this.drag;
	};

	/** Visible, current bounds of the selection in world space (null when empty). */
	selectionBounds (): Rect | null {
		return unionBounds(this.scene.selected());
	};

};
