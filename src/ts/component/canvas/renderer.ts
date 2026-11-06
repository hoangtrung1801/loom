import Konva from 'konva';
import { RoughGenerator } from 'roughjs/bin/generator';
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
	texts: Konva.Node[];
	key: string;
};

const generator = new RoughGenerator();
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SHAPE_TYPES = [ ElementType.Rect, ElementType.Diamond, ElementType.Ellipse ];

/** A stable number from the element id, for elements saved without a seed. */
const hashSeed = (id: string): number => {
	let h = 7;

	for (let i = 0; i < id.length; i++) {
		h = ((h * 31) + id.charCodeAt(i)) % 2147483647;
	};
	return h || 1;
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
		this.controller.measureText = (text, width, fontSize, fontFamily) => this.measure(text, width, fontSize, fontFamily);
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

	private family (name?: string): string {
		switch (name) {
			case 'hand': return `Caveat, ${this.theme.fontFamily}`;
			case 'code': return MONO;
		};
		return this.theme.fontFamily;
	};

	private text (value: string, fontSize: number, width: number, fill: string, extra: Partial<Konva.TextConfig> = {}, family?: string): Konva.Text {
		return new Konva.Text({
			text: value,
			fontFamily: this.family(family),
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

	private measure (text: string, width: number, fontSize: number, fontFamily?: string): number {
		const node = this.text(text || ' ', fontSize, Math.max(10, width), '#000', {}, fontFamily);
		const height = Math.ceil(node.height());

		node.destroy();
		return height;
	};

	// --------------------------------------------------------- //

	private elementKey (el: CanvasElement): string {
		const info = (el.type == ElementType.Object) ? this.getObject(el.targetObjectId) : null;

		return [ el.v, el.nonce, this.objectVersion, info ? `${info.name}|${info.type}` : '', (el.id == this.hiddenId) ? 'h' : '', this.controller.erasing.has(el.id) ? 'x' : '' ].join(':');
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
		const texts: Konva.Node[] = [];
		const hidden = el.id == this.hiddenId;
		const isRough = (el.roughness !== undefined) && (SHAPE_TYPES.includes(el.type) || [ ElementType.Line, ElementType.Arrow ].includes(el.type));

		if (isRough) {
			this.buildRough(el, node);
		} else {
			this.buildFlat(el, node, texts);
		};

		// Text content for text, sticky, frame title, shape labels and arrow labels
		if (el.text && !hidden && (el.type != ElementType.Object)) {
			const label = this.buildLabel(el);

			if (label) {
				node.add(label);
				texts.push(label);
			};
		};

		if ((el.opacity !== undefined) && (el.opacity < 100)) {
			node.opacity(Math.max(0.1, el.opacity / 100));
		};

		if (this.controller.erasing.has(el.id)) {
			node.opacity(0.25);
		};

		node.offset({ x: el.w / 2, y: el.h / 2 });
		node.position({ x: el.x + (el.w / 2), y: el.y + (el.h / 2) });
		node.rotation(((el.angle || 0) * 180) / Math.PI);

		return { node, texts, key: '' };
	};

	// --------------------------------------------------------- //
	// Hand-drawn elements (rough.js generates the wobbly paths, Konva draws them)

	private roughOptions (el: CanvasElement): any {
		const sw = el.strokeWidth || 2;
		const roughness = el.roughness || 0;
		const stroke = this.stroke(el);
		const opts: any = {
			seed: el.seed || hashSeed(el.id),
			roughness,
			bowing: 1,
			stroke,
			strokeWidth: sw,
			disableMultiStroke: !roughness,
			preserveVertices: false,
		};

		if (el.strokeStyle == 'dashed') {
			opts.strokeLineDash = [ 8, 8 + sw ];
		} else
		if (el.strokeStyle == 'dotted') {
			opts.strokeLineDash = [ 1.5, 6 + sw ];
		};

		const fillName = el.fill;

		if (fillName && SHAPE_TYPES.includes(el.type)) {
			const style = el.fillStyle || 'solid';
			const soft = this.theme.fill[fillName] || this.theme.fill.yellow;
			const vivid = this.theme.stroke[fillName] || soft;

			opts.fill = (style == 'solid') ? soft : vivid;
			opts.fillStyle = (style == 'cross') ? 'cross-hatch' : style;
			opts.fillWeight = Math.max(1, sw / 2);
			opts.hachureGap = Math.max(5, sw * 4);
			opts.hachureAngle = -41;
			opts.disableMultiStrokeFill = true;
		};

		return opts;
	};

	private addDrawable (node: Konva.Group, drawable: any, el: CanvasElement, opts: any) {
		drawable.sets.forEach((set: any) => {
			const d = generator.opsToPath(set);

			if (set.type == 'path') {
				node.add(new Konva.Path({
					data: d, stroke: opts.stroke, strokeWidth: opts.strokeWidth, lineCap: 'round', lineJoin: 'round', dash: opts.strokeLineDash,
					listening: false, perfectDrawEnabled: false, shadowForStrokeEnabled: false,
				}));
			} else
			if (set.type == 'fillPath') {
				node.add(new Konva.Path({ data: d, fill: opts.fill, listening: false, perfectDrawEnabled: false }));
			} else
			if (set.type == 'fillSketch') {
				node.add(new Konva.Path({
					data: d, stroke: opts.fill, strokeWidth: opts.fillWeight, lineCap: 'round', lineJoin: 'round',
					listening: false, perfectDrawEnabled: false, shadowForStrokeEnabled: false,
				}));
			};
		});
	};

	private roundedPath (w: number, h: number): string {
		const r = Math.min(Math.min(w, h) * 0.25, 32);

		return `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${h - r}Q${w} ${h} ${w - r} ${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`;
	};

	private buildRough (el: CanvasElement, node: Konva.Group) {
		const opts = this.roughOptions(el);
		const { w, h } = el;

		switch (el.type) {
			case ElementType.Rect:
				this.addDrawable(node, el.rounded ? generator.path(this.roundedPath(w, h), opts) : generator.rectangle(0, 0, w, h, opts), el, opts);
				break;

			case ElementType.Diamond:
				this.addDrawable(node, generator.polygon([ [ w / 2, 0 ], [ w, h / 2 ], [ w / 2, h ], [ 0, h / 2 ] ], opts), el, opts);
				break;

			case ElementType.Ellipse:
				this.addDrawable(node, generator.ellipse(w / 2, h / 2, w, h, opts), el, opts);
				break;

			case ElementType.Line:
			case ElementType.Arrow: {
				const pts = (el.points || []) as [ number, number ][];

				if (pts.length < 2) {
					break;
				};

				const curved = (el.arrowType == 'curve') && (pts.length > 2);

				this.addDrawable(node, curved ? generator.curve(pts, opts) : generator.linearPath(pts, opts), el, opts);

				if (el.type == ElementType.Arrow) {
					const headOpts = { ...opts, strokeLineDash: undefined, fill: opts.stroke, fillStyle: 'solid' };

					[ 'start', 'end' ].forEach(side => {
						this.headSpecs(el, side as 'start' | 'end').forEach(spec => {
							let drawable: any = null;

							switch (spec.kind) {
								case 'line': drawable = generator.linearPath(spec.points as [ number, number ][], headOpts); break;
								case 'poly': drawable = generator.polygon(spec.points as [ number, number ][], headOpts); break;
								case 'circle': drawable = generator.circle(spec.points[0][0], spec.points[0][1], spec.radius * 2, headOpts); break;
							};

							if (drawable) {
								this.addDrawable(node, drawable, el, headOpts);
							};
						});
					});
				};
				break;
			};
		};
	};

	/** Arrowhead geometry in element space. */
	private headSpecs (el: CanvasElement, side: 'start' | 'end'): { kind: 'line' | 'poly' | 'circle', points: number[][], radius?: number }[] {
		const head = (side == 'start') ? (el.startHead || 'none') : (el.endHead || ((el.type == ElementType.Arrow) ? 'arrow' : 'none'));
		const pts = el.points || [];

		if ((head == 'none') || (pts.length < 2)) {
			return [];
		};

		const sw = el.strokeWidth || 2;
		const tip = (side == 'start') ? pts[0] : pts[pts.length - 1];
		const from = (side == 'start') ? pts[1] : pts[pts.length - 2];
		const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
		const len = ARROW_HEAD + sw;
		const wing = (da: number) => [ tip[0] - (Math.cos(angle + da) * len), tip[1] - (Math.sin(angle + da) * len) ];

		switch (head) {
			case 'arrow':
				return [ { kind: 'line', points: [ wing(-0.45), tip, wing(0.45) ] } ];

			case 'triangle':
				return [ { kind: 'poly', points: [ tip, wing(-0.45), wing(0.45) ] } ];

			case 'bar': {
				const half = len * 0.5;
				const nx = -Math.sin(angle) * half;
				const ny = Math.cos(angle) * half;

				return [ { kind: 'line', points: [ [ tip[0] + nx, tip[1] + ny ], [ tip[0] - nx, tip[1] - ny ] ] } ];
			};

			case 'dot': {
				const r = (sw * 2) + 3;

				return [ { kind: 'circle', points: [ [ tip[0] - (Math.cos(angle) * r), tip[1] - (Math.sin(angle) * r) ] ], radius: r } ];
			};
		};

		return [];
	};

	// --------------------------------------------------------- //
	// Flat elements: stickies, frames, object cards and everything saved before the hand-drawn style existed

	private buildFlat (el: CanvasElement, node: Konva.Group, texts: Konva.Node[]) {
		const sw = el.strokeWidth || 2;
		const stroke = this.stroke(el);
		const fill = this.fillColor(el);
		const base = { listening: false, perfectDrawEnabled: false, shadowForStrokeEnabled: false };

		switch (el.type) {
			case ElementType.Rect:
			case ElementType.Sticky: {
				node.add(new Konva.Rect({ ...base, width: el.w, height: el.h, fill, stroke: (el.type == ElementType.Rect) ? stroke : undefined, strokeWidth: sw }));
				break;
			};

			case ElementType.Diamond: {
				node.add(new Konva.Line({ ...base, points: [ el.w / 2, 0, el.w, el.h / 2, el.w / 2, el.h, 0, el.h / 2 ], closed: true, fill, stroke, strokeWidth: sw }));
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

				if (el.type == ElementType.Arrow) {
					[ 'start', 'end' ].forEach(side => {
						this.headSpecs(el, side as 'start' | 'end').forEach(spec => {
							if (spec.kind == 'circle') {
								node.add(new Konva.Circle({ ...base, x: spec.points[0][0], y: spec.points[0][1], radius: spec.radius, fill: stroke }));
							} else {
								node.add(new Konva.Line({
									...base, points: spec.points.reduce((acc, p) => acc.concat(p), [] as number[]), closed: spec.kind == 'poly', fill: (spec.kind == 'poly') ? stroke : undefined,
									stroke, strokeWidth: sw, lineCap: 'round', lineJoin: 'round',
								}));
							};
						});
					});
				};
				break;
			};

			case ElementType.Object: {
				const info = this.getObject(el.targetObjectId);

				node.add(new Konva.Rect({ ...base, width: el.w, height: el.h, cornerRadius: 8, fill: this.theme.card, stroke: this.theme.cardBorder, strokeWidth: 1 }));

				const name = this.text((info?.name || '').slice(0, 120), 15, el.w - 24, this.theme.text, { x: 12, y: 12, fontStyle: '600', wrap: 'char' });

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
	};

	private buildLabel (el: CanvasElement): Konva.Group | Konva.Text | null {
		const fontSize = el.fontSize || 16;
		const family = el.fontFamily;
		const fillText = el.fill ? this.theme.onFill : (this.theme.textColor[el.color || 'default'] || this.theme.text);

		if (el.type == ElementType.Frame) {
			const label = this.text(el.text, FRAME_TITLE, undefined, this.theme.muted, { wrap: 'none' });

			label.position({ x: 0, y: -label.height() - 4 });
			return label;
		};

		if (isLinear(el)) {
			if (el.type == ElementType.Freehand) {
				return null;
			};

			// Arrow and line labels sit on the middle of the line over a patch of background
			const pts = el.points || [];
			const mid = pts[Math.floor(pts.length / 2)] || [ 0, 0 ];
			const prev = (pts.length % 2) ? mid : [ (pts[(pts.length / 2) - 1][0] + mid[0]) / 2, (pts[(pts.length / 2) - 1][1] + mid[1]) / 2 ];
			const at = (pts.length % 2) ? mid : prev;
			const label = this.text(el.text, fontSize, undefined, fillText, { wrap: 'none', padding: 3 }, family);

			label.position({ x: at[0] - (label.width() / 2), y: at[1] - (label.height() / 2) });
			label.fill(fillText);

			const patch = new Konva.Rect({ x: label.x(), y: label.y(), width: label.width(), height: label.height(), fill: this.theme.bg, listening: false });
			const group = new Konva.Group({ listening: false });

			group.add(patch, label);
			return group;
		};

		const isShape = SHAPE_TYPES.includes(el.type);
		const diamond = el.type == ElementType.Diamond;
		const pad = (el.type == ElementType.Text) ? 0 : 12;
		const x = diamond ? el.w / 4 : pad;
		const y = diamond ? el.h / 4 : pad;
		const width = Math.max(10, diamond ? el.w / 2 : el.w - (pad * 2));
		const height = Math.max(10, diamond ? el.h / 2 : el.h - (pad * 2));
		const align = el.textAlign || (isShape ? 'center' : 'left');
		const vertical = el.verticalAlign || (isShape ? 'middle' : 'top');
		const extra: Partial<Konva.TextConfig> = { x, y, align, wrap: 'word' };

		if (el.type != ElementType.Text) {
			extra.height = height;
			extra.verticalAlign = vertical;
		};

		return this.text(el.text, fontSize, width, fillText, extra, family);
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
