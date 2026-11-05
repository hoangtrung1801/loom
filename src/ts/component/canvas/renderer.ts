import Konva from 'konva';
import { CanvasController, CanvasElement, ElementType, elementBounds, isLinear, visibleRect, expandRect, worldPoints, center } from 'Lib/canvas';

export interface RendererTheme {
	bg: string;
	grid: string;
	text: string;
	onFill: string;
	muted: string;
	selected: string;
	highlight: string;
	card: string;
	cardBorder: string;
	stroke: { [key: string]: string };
	fill: { [key: string]: string };
	textColor: { [key: string]: string };
	fontFamily: string;
};

export interface ObjectInfo {
	name: string;
	type: string;
};

interface View {
	node: Konva.Group;
	texts: Konva.Text[];
	key: string;
};

const FRAME_TITLE = 12;
const ARROW_HEAD = 14;
const LINE_HEIGHT = 1.3;
const KEEP_VIEWS = 1500;

const rgba = (hex: string, alpha: number): string => {
	let v = String(hex || '').replace('#', '');

	if (v.length == 3) {
		v = v.split('').map(c => c + c).join('');
	};

	const n = parseInt(v.slice(0, 6) || '000000', 16);

	return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/**
 * Konva (Canvas 2D) renderer for a canvas scene. It only draws what is visible, keeps one Konva group
 * per element and rebuilds a group only when the element (or its object info) changed.
 * Interaction is handled by the controller, so no Konva node listens to events.
 */
export class CanvasRenderer {

	private stage: Konva.Stage | null = null;
	private bgLayer: Konva.Layer | null = null;
	private worldLayer: Konva.Layer | null = null;
	private overlayLayer: Konva.Layer | null = null;
	private world = new Konva.Group({ listening: false });
	private elementsGroup = new Konva.Group({ listening: false });
	private draftGroup = new Konva.Group({ listening: false });
	private observer: ResizeObserver | null = null;
	private views = new Map<string, View>();
	private attached: Konva.Group[] = [];
	private draftNode: Konva.Group | null = null;
	private bgKey = '';
	private frame = 0;
	private destroyed = false;
	private hiddenId = '';
	private objectVersion = 0;
	private ready = false;

	constructor (
		private controller: CanvasController,
		private theme: RendererTheme,
		private getObject: (id: string) => ObjectInfo,
	) {};

	async init (container: HTMLElement, resizeTo: HTMLElement) {
		if (this.destroyed) {
			return;
		};

		const rect = resizeTo.getBoundingClientRect();
		const stage = new Konva.Stage({ container: container as HTMLDivElement, width: Math.max(1, rect.width), height: Math.max(1, rect.height), listening: false });

		this.stage = stage;
		this.bgLayer = new Konva.Layer({ listening: false });
		this.worldLayer = new Konva.Layer({ listening: false });
		this.overlayLayer = new Konva.Layer({ listening: false });

		this.bgLayer.add(new Konva.Shape({ listening: false, sceneFunc: ctx => this.paintBackground((ctx as any)._context) }));
		this.world.add(this.elementsGroup, this.draftGroup);
		this.worldLayer.add(this.world);
		this.overlayLayer.add(new Konva.Shape({ listening: false, sceneFunc: ctx => this.paintOverlay((ctx as any)._context) }));
		stage.add(this.bgLayer, this.worldLayer, this.overlayLayer);

		this.observer = new ResizeObserver(() => {
			const r = resizeTo.getBoundingClientRect();

			if (this.stage && ((r.width != this.stage.width()) || (r.height != this.stage.height()))) {
				this.stage.size({ width: Math.max(1, r.width), height: Math.max(1, r.height) });
				this.bgKey = '';
				this.requestRender();
			};
		});
		this.observer.observe(resizeTo);

		this.ready = true;
		this.controller.measureText = (text, width, fontSize) => this.measure(text, width, fontSize);
		this.requestRender();
	};

	setTheme (theme: RendererTheme) {
		this.theme = theme;
		this.bgKey = '';
		this.views.forEach(view => view.node.destroy());
		this.views.clear();
		this.attached = [];
		this.requestRender();
	};

	setHidden (id: string) {
		this.hiddenId = id;
		this.requestRender();
	};

	/** Object cards show name and type from the store; call when those details change. */
	invalidateObjects () {
		this.objectVersion++;
		this.requestRender();
	};

	requestRender () {
		if (this.frame || this.destroyed || !this.ready) {
			return;
		};

		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.render();
		});
	};

	destroy () {
		this.destroyed = true;
		cancelAnimationFrame(this.frame);
		this.observer?.disconnect();
		this.observer = null;

		if (this.stage) {
			this.stage.destroy();
		};
		this.stage = null;
		this.ready = false;
		this.views.clear();
		this.attached = [];
	};

	private text (value: string, fontSize: number, width: number, fill: string, extra: Partial<Konva.TextConfig> = {}): Konva.Text {
		return new Konva.Text({
			text: value,
			fontFamily: this.theme.fontFamily,
			fontSize,
			fill,
			width,
			wrap: 'word',
			lineHeight: Math.round(fontSize * LINE_HEIGHT) / fontSize,
			listening: false,
			perfectDrawEnabled: false,
			...extra,
		});
	};

	private measure (text: string, width: number, fontSize: number): number {
		const node = this.text(text || ' ', fontSize, Math.max(10, width), '#000');
		const height = Math.ceil(node.height());

		node.destroy();
		return height;
	};

	// --------------------------------------------------------- //

	private elementKey (el: CanvasElement): string {
		const info = (el.type == ElementType.Object) ? this.getObject(el.targetObjectId) : null;

		return [ el.v, el.nonce, this.objectVersion, info ? `${info.name}|${info.type}` : '', (el.id == this.hiddenId) ? 'h' : '' ].join(':');
	};

	private stroke (el: CanvasElement): string {
		return this.theme.stroke[el.color || 'default'] || this.theme.text;
	};

	private fillColor (el: CanvasElement): string | undefined {
		if (!el.fill) {
			return undefined;
		};
		return this.theme.fill[el.fill] || this.theme.fill.yellow;
	};

	private build (el: CanvasElement): View {
		const node = new Konva.Group({ listening: false });
		const texts: Konva.Text[] = [];
		const sw = el.strokeWidth || 2;
		const stroke = this.stroke(el);
		const fill = this.fillColor(el);
		const hidden = el.id == this.hiddenId;
		const base = { listening: false, perfectDrawEnabled: false, shadowForStrokeEnabled: false };

		switch (el.type) {
			case ElementType.Rect:
			case ElementType.Sticky: {
				node.add(new Konva.Rect({ ...base, width: el.w, height: el.h, fill, stroke: (el.type == ElementType.Rect) ? stroke : undefined, strokeWidth: sw }));
				break;
			};

			case ElementType.Ellipse: {
				node.add(new Konva.Ellipse({ ...base, x: el.w / 2, y: el.h / 2, radiusX: el.w / 2, radiusY: el.h / 2, fill, stroke, strokeWidth: sw }));
				break;
			};

			case ElementType.Frame: {
				node.add(new Konva.Rect({ ...base, width: el.w, height: el.h, fill: rgba(this.theme.fill.grey || this.theme.bg, 0.12), stroke: this.theme.muted, strokeWidth: 1 }));
				break;
			};

			case ElementType.Line:
			case ElementType.Arrow:
			case ElementType.Freehand: {
				const pts = el.points || [];

				if (pts.length > 1) {
					node.add(new Konva.Line({ ...base, points: pts.reduce((acc, p) => acc.concat(p), [] as number[]), stroke, strokeWidth: sw, lineCap: 'round', lineJoin: 'round' }));
				};

				if ((el.type == ElementType.Arrow) && (pts.length > 1)) {
					const a = pts[pts.length - 2];
					const b = pts[pts.length - 1];
					const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
					const len = ARROW_HEAD + sw;

					node.add(new Konva.Line({
						...base,
						points: [
							b[0] - (Math.cos(angle - 0.45) * len), b[1] - (Math.sin(angle - 0.45) * len),
							b[0], b[1],
							b[0] - (Math.cos(angle + 0.45) * len), b[1] - (Math.sin(angle + 0.45) * len),
						],
						stroke,
						strokeWidth: sw,
						lineCap: 'round',
						lineJoin: 'round',
					}));
				};
				break;
			};

			case ElementType.Object: {
				const info = this.getObject(el.targetObjectId);

				node.add(new Konva.Rect({ ...base, width: el.w, height: el.h, cornerRadius: 8, fill: this.theme.card, stroke: this.theme.cardBorder, strokeWidth: 1 }));

				const name = this.text((info?.name || '').slice(0, 120), 15, el.w - 24, this.theme.text, { x: 12, y: 12, fontStyle: '600', wrap: 'word' });

				node.add(name);
				texts.push(name);

				if (info?.type) {
					const type = this.text(info.type, 12, undefined, this.theme.muted, { wrap: 'none' });

					type.position({ x: 12, y: el.h - 12 - type.height() });
					node.add(type);
					texts.push(type);
				};
				break;
			};
		};

		// Text content for text, sticky, frame title and shape labels
		if (el.text && !hidden && (el.type != ElementType.Object) && !isLinear(el)) {
			let label: Konva.Text = null;

			if (el.type == ElementType.Frame) {
				label = this.text(el.text, FRAME_TITLE, undefined, this.theme.muted, { wrap: 'none' });
				label.position({ x: 0, y: -label.height() - 4 });
			} else {
				const fontSize = el.fontSize || 16;
				const fillText = el.fill ? this.theme.onFill : (this.theme.textColor[el.color || 'default'] || this.theme.text);
				const pad = (el.type != ElementType.Text) ? 12 : 0;

				if ((el.type == ElementType.Rect) || (el.type == ElementType.Ellipse)) {
					label = this.text(el.text, fontSize, Math.max(10, el.w - (pad * 2)), fillText, { x: pad, y: pad, height: Math.max(10, el.h - (pad * 2)), align: 'center', verticalAlign: 'middle', wrap: 'word' });
				} else {
					label = this.text(el.text, fontSize, Math.max(10, el.w - (pad * 2)), fillText, { x: pad, y: pad, wrap: 'word' });
				};
			};

			node.add(label);
			texts.push(label);
		};

		node.offset({ x: el.w / 2, y: el.h / 2 });
		node.position({ x: el.x + (el.w / 2), y: el.y + (el.h / 2) });
		node.rotation(((el.angle || 0) * 180) / Math.PI);

		return { node, texts, key: '' };
	};

	// --------------------------------------------------------- //

	private render () {
		if (!this.stage || this.destroyed) {
			return;
		};

		const { viewport, scene } = this.controller;
		const width = this.stage.width();
		const height = this.stage.height();

		this.controller.width = width;
		this.controller.height = height;

		this.world.position({ x: viewport.x, y: viewport.y });
		this.world.scale({ x: viewport.zoom, y: viewport.zoom });

		// Only elements near the screen get a node. The query is already sorted by z order.
		const area = expandRect(visibleRect(viewport, width, height), 64 / viewport.zoom);
		const visible = scene.query(area);
		const ids = new Set<string>();
		const nodes: Konva.Group[] = [];
		const showText = viewport.zoom >= 0.2;

		visible.forEach(el => {
			ids.add(el.id);

			const key = this.elementKey(el);
			let view = this.views.get(el.id);

			if (!view || (view.key != key)) {
				view?.node.destroy();
				view = this.build(el);
				view.key = key;
				this.views.set(el.id, view);
			};

			view.texts.forEach(t => t.visible(showText));
			nodes.push(view.node);
		});

		this.views.forEach((view, id) => {
			const el = scene.get(id);

			if (!el || el.deleted || ((this.views.size > KEEP_VIEWS) && !ids.has(id))) {
				view.node.destroy();
				this.views.delete(id);
			};
		});

		this.syncNodes(nodes);
		this.syncDraft();

		const bgKey = [ width, height, viewport.x, viewport.y, viewport.zoom, this.theme.bg, this.theme.grid ].join(':');

		if (bgKey != this.bgKey) {
			this.bgKey = bgKey;
			this.bgLayer.draw();
		};

		this.worldLayer.draw();
		this.overlayLayer.draw();
	};

	/** Attach exactly the visible nodes in z order, touching the group only when something changed. */
	private syncNodes (nodes: Konva.Group[]) {
		const same = (nodes.length == this.attached.length) && nodes.every((n, i) => n === this.attached[i]);

		if (same) {
			return;
		};

		this.elementsGroup.removeChildren();
		nodes.forEach(n => this.elementsGroup.add(n));
		this.attached = nodes;
	};

	private syncDraft () {
		const { draft } = this.controller;

		if (this.draftNode) {
			this.draftNode.destroy();
			this.draftNode = null;
		};

		if (!draft) {
			return;
		};

		this.draftNode = this.build(draft).node;
		this.draftGroup.add(this.draftNode);
	};

	private paintBackground (c: CanvasRenderingContext2D) {
		const { viewport } = this.controller;
		const width = this.stage.width();
		const height = this.stage.height();
		let step = 24 * viewport.zoom;

		c.fillStyle = this.theme.bg;
		c.fillRect(0, 0, width, height);

		while (step < 12) {
			step *= 2;
		};

		if (step > 400) {
			return;
		};

		const ox = ((viewport.x % step) + step) % step;
		const oy = ((viewport.y % step) + step) % step;
		const size = Math.max(0.75, Math.min(1.5, viewport.zoom));

		c.fillStyle = this.theme.grid;

		for (let x = ox; x < width; x += step) {
			for (let y = oy; y < height; y += step) {
				c.fillRect(x - (size / 2), y - (size / 2), size, size);
			};
		};
	};

	private paintOverlay (c: CanvasRenderingContext2D) {
		const { controller } = this;
		const { viewport, scene } = controller;
		const selected = this.theme.selected;
		const sx = (v: number) => (v * viewport.zoom) + viewport.x;
		const sy = (v: number) => (v * viewport.zoom) + viewport.y;

		const line = (x1: number, y1: number, x2: number, y2: number, width: number, style: string, alpha = 1) => {
			c.globalAlpha = alpha;
			c.lineWidth = width;
			c.strokeStyle = style;
			c.beginPath();
			c.moveTo(x1, y1);
			c.lineTo(x2, y2);
			c.stroke();
			c.globalAlpha = 1;
		};

		const box = (x: number, y: number, w: number, h: number, width: number, style: string, alpha = 1) => {
			c.globalAlpha = alpha;
			c.lineWidth = width;
			c.strokeStyle = style;
			c.strokeRect(x, y, w, h);
			c.globalAlpha = 1;
		};

		const outline = (el: CanvasElement, width: number, alpha = 1) => {
			if (!el.angle || isLinear(el)) {
				const b = elementBounds(el);

				box(sx(b.x), sy(b.y), b.w * viewport.zoom, b.h * viewport.zoom, width, selected, alpha);
			} else {
				const o = center(el);
				const cos = Math.cos(el.angle);
				const sin = Math.sin(el.angle);
				const corners = [ [ el.x, el.y ], [ el.x + el.w, el.y ], [ el.x + el.w, el.y + el.h ], [ el.x, el.y + el.h ] ].map(([ x, y ]) => [
					o.x + ((x - o.x) * cos) - ((y - o.y) * sin),
					o.y + ((x - o.x) * sin) + ((y - o.y) * cos),
				]);

				c.globalAlpha = alpha;
				c.lineWidth = width;
				c.strokeStyle = selected;
				c.beginPath();
				corners.forEach((p, i) => i ? c.lineTo(sx(p[0]), sy(p[1])) : c.moveTo(sx(p[0]), sy(p[1])));
				c.closePath();
				c.stroke();
				c.globalAlpha = 1;
			};
		};

		if (controller.hoverId && !scene.selection.has(controller.hoverId)) {
			const el = scene.get(controller.hoverId);

			if (el && !el.deleted) {
				outline(el, 1, 0.6);
			};
		};

		const sel = scene.selected();

		sel.forEach(el => outline(el, 1.5));

		if (scene.selection.size > 1) {
			const b = controller.selectionBounds();

			if (b) {
				box(sx(b.x), sy(b.y), b.w * viewport.zoom, b.h * viewport.zoom, 1, selected, 0.5);
			};
		};

		const handles = controller.handles();

		if (sel.length == 1) {
			const top = handles.find(h => h.id == 'n');
			const rot = handles.find(h => h.id == 'rotate');

			if (top && rot) {
				line(sx(top.point.x), sy(top.point.y), sx(rot.point.x), sy(rot.point.y), 1, selected);
			};
		};

		handles.forEach(h => {
			c.fillStyle = this.theme.bg;
			c.strokeStyle = selected;
			c.lineWidth = 1.5;
			c.beginPath();

			if (h.id == 'rotate') {
				c.arc(sx(h.point.x), sy(h.point.y), 5, 0, Math.PI * 2);
			} else {
				c.rect(sx(h.point.x) - 4, sy(h.point.y) - 4, 8, 8);
			};

			c.fill();
			c.stroke();
		});

		if (controller.marquee) {
			const m = controller.marquee;

			c.globalAlpha = 0.08;
			c.fillStyle = selected;
			c.fillRect(sx(m.x), sy(m.y), m.w * viewport.zoom, m.h * viewport.zoom);
			box(sx(m.x), sy(m.y), m.w * viewport.zoom, m.h * viewport.zoom, 1, selected, 0.8);
		};

		controller.guides.forEach(guide => {
			if (guide.axis == 'x') {
				line(sx(guide.value), sy(guide.from), sx(guide.value), sy(guide.to), 1, this.theme.highlight);
			} else {
				line(sx(guide.from), sy(guide.value), sx(guide.to), sy(guide.value), 1, this.theme.highlight);
			};
		});

		// Keep line endpoints visible when a single line is selected
		if ((sel.length == 1) && [ ElementType.Line, ElementType.Arrow ].includes(sel[0].type)) {
			c.fillStyle = selected;
			worldPoints(sel[0]).forEach(p => {
				c.beginPath();
				c.arc(sx(p.x), sy(p.y), 3.5, 0, Math.PI * 2);
				c.fill();
			});
		};
	};

};
