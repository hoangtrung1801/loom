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
	openLabel?: string;
};

export type ObjectKind = 'page' | 'set' | 'bookmark' | 'image';

/** One block of a page, reduced to what the preview draws. style is the TextStyle number (see I.TextStyle). */
export interface PreviewBlock {
	kind: 'text' | 'div';
	style: number;
	text: string;
	checked: boolean;
	depth: number;
	number: number;
};

export interface ObjectInfo {
	name: string;
	type: string;
	kind: ObjectKind;
	/** First lines of the page, or its description. */
	text: string;
	source: string;
	imageUrl: string;
	blocks: PreviewBlock[];
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
	private highlightObjectId = '';
	private images = new Map<string, HTMLImageElement | null>();
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

	/** Draws elements into a standalone canvas for PNG export and library thumbnails. */
	exportImage (elements: CanvasElement[], opts: { scale: number, background: boolean, padding?: number, maxSize?: number }): HTMLCanvasElement | null {
		const list = elements.filter(el => !el.deleted);
		if (!list.length || !this.ready) {
			return null;
		};

		const pad = opts.padding ?? 16;
		const boxes = list.map(el => elementBounds(el));
		const minX = Math.min(...boxes.map(b => b.x));
		const minY = Math.min(...boxes.map(b => b.y));
		const maxX = Math.max(...boxes.map(b => b.x + b.w));
		const maxY = Math.max(...boxes.map(b => b.y + b.h));
		const w = Math.max(1, maxX - minX + (pad * 2));
		const h = Math.max(1, maxY - minY + (pad * 2));
		let scale = opts.scale;

		if (opts.maxSize) {
			scale = Math.min(scale, opts.maxSize / Math.max(w, h));
		};

		const host = document.createElement('div');
		const stage = new Konva.Stage({ container: host, width: w, height: h, listening: false });
		const layer = new Konva.Layer({ listening: false });
		const group = new Konva.Group({ x: pad - minX, y: pad - minY, listening: false });
		const sorted = list.slice().sort((a, b) => (a.z < b.z ? -1 : (a.z > b.z ? 1 : 0)));

		if (opts.background) {
			layer.add(new Konva.Rect({ width: w, height: h, fill: this.theme.bg, listening: false }));
		};

		sorted.forEach(el => group.add(this.build(el).node));
		layer.add(group);
		stage.add(layer);

		const canvas = stage.toCanvas({ pixelRatio: scale }) as HTMLCanvasElement;

		stage.destroy();
		return canvas;
	};

	/** The object that is open in the side panel gets an outline on the board. */
	setHighlightObject (id: string) {
		if (id == this.highlightObjectId) {
			return;
		};
		this.highlightObjectId = id;
		this.requestRender();
	};

	private getImage (url: string): HTMLImageElement | null {
		if (!url) {
			return null;
		};
		if (this.images.has(url)) {
			return this.images.get(url);
		};

		const img = new Image();

		this.images.set(url, null);
		img.onload = () => {
			this.images.set(url, img);
			this.invalidateObjects();
		};
		img.src = url;
		return null;
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

		return [ el.v, el.nonce, this.objectVersion, info ? `${info.name}|${info.type}|${info.text}|${info.imageUrl}|${this.images.get(info.imageUrl) ? 1 : 0}|${info.blocks.map(b => `${b.style}${b.checked ? 'x' : ''}${b.text}`).join('\n')}` : '', (el.targetObjectId && (el.targetObjectId == this.highlightObjectId)) ? 'o' : '', (el.id == this.hiddenId) ? 'h' : '', this.controller.erasing.has(el.id) ? 'x' : '' ].join(':');
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
				this.buildObject(el, node, texts);
				break;
			};
		};
	};

	/** Read-only preview of a Loom object. Everything comes from details already in the store. */
	private buildObject (el: CanvasElement, node: Konva.Group, texts: Konva.Node[]) {
		const info = this.getObject(el.targetObjectId);
		const base = { listening: false, perfectDrawEnabled: false, shadowForStrokeEnabled: false };
		const opened = !!el.targetObjectId && (el.targetObjectId == this.highlightObjectId);
		const { w, h } = el;
		const pad = 12;
		const add = (t: Konva.Text) => {
			node.add(t);
			texts.push(t);
			return t;
		};

		node.add(new Konva.Rect({
			...base, width: w, height: h, cornerRadius: 8, fill: this.theme.card,
			stroke: opened ? this.theme.selected : this.theme.cardBorder, strokeWidth: opened ? 2 : 1,
		}));

		// Clip the content to the rounded card
		const body = new Konva.Group({ listening: false, clipFunc: (ctx: any) => {
			ctx.beginPath();
			(ctx as any).roundRect ? (ctx as any).roundRect(0, 0, w, h, 8) : ctx.rect(0, 0, w, h);
			ctx.closePath();
		} });

		node.add(body);

		const put = (shape: Konva.Shape | Konva.Group) => body.add(shape as any);
		const label = (value: string, size: number, width: number, fill: string, extra: Partial<Konva.TextConfig> = {}): Konva.Text => {
			const t = this.text(value, size, width, fill, extra);

			put(t);
			texts.push(t);
			return t;
		};

		if (info.kind == 'image') {
			const img = this.getImage(info.imageUrl);
			const imgH = h - 36;

			put(new Konva.Rect({ ...base, width: w, height: imgH, fill: this.theme.grid, opacity: 0.35 }));

			if (img) {
				const ratio = Math.max(w / img.width, imgH / img.height);
				const cw = w / ratio;
				const ch = imgH / ratio;

				put(new Konva.Image({ ...base, image: img, width: w, height: imgH, crop: { x: (img.width - cw) / 2, y: (img.height - ch) / 2, width: cw, height: ch } }));
			};

			label(info.name, 13, w - (pad * 2) - 40, this.theme.text, { x: pad, y: imgH + 10, fontStyle: '600', wrap: 'none', ellipsis: true });
			label(info.type, 11, 40, this.theme.muted, { x: w - pad - 40, y: imgH + 12, align: 'right', wrap: 'none' });
			return;
		};

		if (info.kind == 'bookmark') {
			const side = Math.min(88, h);

			put(new Konva.Rect({ ...base, width: side, height: h, fill: this.theme.grid, opacity: 0.35 }));
			put(new Konva.Circle({ ...base, x: side / 2, y: h / 2, radius: 14, stroke: this.theme.muted, strokeWidth: 1.5 }));
			put(new Konva.Ellipse({ ...base, x: side / 2, y: h / 2, radiusX: 6, radiusY: 14, stroke: this.theme.muted, strokeWidth: 1.5 }));
			put(new Konva.Line({ ...base, points: [ (side / 2) - 14, h / 2, (side / 2) + 14, h / 2 ], stroke: this.theme.muted, strokeWidth: 1.5 }));

			const tw = w - side - (pad * 2);

			label(info.name, 13, tw, this.theme.text, { x: side + pad, y: pad, fontStyle: '600', wrap: 'none', ellipsis: true });
			label(info.text, 11, tw, this.theme.muted, { x: side + pad, y: pad + 20, height: Math.max(14, h - 68), wrap: 'word', ellipsis: true });
			label(info.source, 11, tw, this.theme.muted, { x: side + pad, y: h - pad - 13, wrap: 'none', ellipsis: true });
			return;
		};

		if ((info.kind == 'page') && info.blocks.length) {
			this.buildPagePreview(el, info, label, put);
		} else {
			// Set and pages whose blocks are not loaded yet: a header with the name and type, then the snippet
			const head = 40;

			put(new Konva.Rect({ ...base, x: pad, y: 12, width: 16, height: 16, cornerRadius: 4, stroke: this.theme.muted, strokeWidth: 1.2 }));
			label(info.name, 14, w - (pad * 3) - 76, this.theme.text, { x: pad + 24, y: 12, fontStyle: '600', wrap: 'none', ellipsis: true });
			label(info.type, 11, 64, this.theme.muted, { x: w - pad - 64, y: 14, align: 'right', wrap: 'none', ellipsis: true });
			put(new Konva.Line({ ...base, points: [ 0, head, w, head ], stroke: this.theme.cardBorder, strokeWidth: 1 }));

			if (info.text) {
				label(info.text, 12, w - (pad * 2), this.theme.text, { x: pad, y: head + 10, height: Math.max(16, h - head - 20), wrap: 'word', ellipsis: true, lineHeight: 1.5 });
			};
		};

		if (opened) {
			const tip = add(this.text(this.theme.openLabel || '', 11, undefined, this.theme.selected, { wrap: 'none' }));

			tip.position({ x: w - pad - tip.width(), y: h - pad - tip.height() });
		};
	};

	/** Draws the blocks of a page the way the editor formats them: headings, checklists, lists, quotes, callouts, code and dividers. */
	private buildPagePreview (el: CanvasElement, info: ObjectInfo, label: (value: string, size: number, width: number, fill: string, extra?: Partial<Konva.TextConfig>) => Konva.Text, put: (shape: Konva.Shape | Konva.Group) => void) {
		const base = { listening: false, perfectDrawEnabled: false, shadowForStrokeEnabled: false };
		const { w, h } = el;
		const pad = 16;
		const inner = w - (pad * 2);
		let y = pad;

		const typeLine = label(info.type, 11, inner, this.theme.muted, { x: pad, y, wrap: 'none' });

		y += typeLine.height() + 4;

		const title = label(info.name, 20, inner, this.theme.text, { x: pad, y, fontStyle: '700', lineHeight: 1.2, wrap: 'word' });

		y += title.height() + 12;

		for (const block of info.blocks) {
			if (y > h) {
				break;
			};

			const x = pad + (block.depth * 18);
			const width = inner - (block.depth * 18);

			if (block.kind == 'div') {
				put(new Konva.Line({ ...base, points: [ pad, y + 6, w - pad, y + 6 ], stroke: this.theme.cardBorder, strokeWidth: 1 }));
				y += 14;
				continue;
			};

			let size = 12.5;
			let weight = '400';
			let fill = this.theme.text;
			let gap = 5;
			let indent = 0;
			let family: string | undefined;
			let before = 0;

			switch (block.style) {
				case 1: size = 17; weight = '700'; gap = 6; before = 8; break;
				case 2: size = 15; weight = '700'; gap = 5; before = 6; break;
				case 3: size = 13.5; weight = '700'; before = 4; break;
				case 4: size = 12.5; weight = '700'; before = 2; break;
				case 5: indent = 12; break;
				case 6: size = 11; family = 'code'; break;
				case 8: case 9: case 10: case 11: indent = 20; break;
				case 13: indent = 0; break;
				case 14: size = 17; weight = '700'; indent = 20; before = 8; break;
				case 15: size = 15; weight = '700'; indent = 20; before = 6; break;
				case 16: size = 13.5; weight = '700'; indent = 20; before = 4; break;
			};

			if (block.style == 8 && block.checked) {
				fill = this.theme.muted;
			};

			y += before;

			const pre = (block.style == 6) || (block.style == 13) ? 8 : 0;
			const tw = width - indent - (pre * 2);
			const node = label(block.text || ' ', size, tw, fill, {
				x: x + indent + pre, y: y + pre, fontStyle: weight, wrap: 'word', lineHeight: 1.45,
				textDecoration: ((block.style == 8) && block.checked) ? 'line-through' : '',
			});

			if (family) {
				node.fontFamily(this.family(family));
			};

			const textH = node.height();

			switch (block.style) {
				case 5:
					put(new Konva.Rect({ ...base, x, y, width: 2.5, height: textH, fill: this.theme.muted }));
					break;

				case 6:
					put(new Konva.Rect({ ...base, x, y, width: width, height: textH + 16, cornerRadius: 4, fill: this.theme.grid, opacity: 0.35 }));
					node.moveToTop();
					break;

				case 13:
					put(new Konva.Rect({ ...base, x, y, width: width, height: textH + 16, cornerRadius: 6, fill: this.theme.grid, opacity: 0.3 }));
					node.moveToTop();
					break;

				case 8: {
					const top = y + 1;

					put(new Konva.Rect({
						...base, x, y: top, width: 13, height: 13, cornerRadius: 3.5,
						stroke: block.checked ? this.theme.selected : this.theme.muted, strokeWidth: 1.4, fill: block.checked ? this.theme.selected : undefined,
					}));

					if (block.checked) {
						put(new Konva.Line({ ...base, points: [ x + 3, top + 7, x + 5.8, top + 9.8, x + 10.2, top + 3.8 ], stroke: this.theme.card, strokeWidth: 1.6, lineCap: 'round', lineJoin: 'round' }));
					};
					break;
				};

				case 9:
					put(new Konva.Circle({ ...base, x: x + 6, y: y + (size * 0.72), radius: 2.4, fill: this.theme.text }));
					break;

				case 10:
					put(this.text(`${block.number}.`, size, 18, this.theme.text, { x, y, wrap: 'none', listening: false }));
					break;

				case 11:
				case 14:
				case 15:
				case 16:
					put(new Konva.Line({ ...base, points: [ x + 4, y + (size * 0.35), x + 9, y + (size * 0.72), x + 4, y + (size * 1.1) ], stroke: this.theme.muted, strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round' }));
					break;
			};

			y += textH + gap + (pre * 2);
		};

		// Fade the bottom so cut-off content does not end on a hard edge
		const fade = 44;
		const to = rgba(this.theme.card, 1);
		const from = rgba(this.theme.card, 0);

		if (y > h - 8) {
			put(new Konva.Rect({
				...base, x: 1, y: h - fade, width: w - 2, height: fade - 1,
				fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: 0, y: fade },
				fillLinearGradientColorStops: [ 0, from, 1, to ],
			}));
		};
	};

	private buildLabel (el: CanvasElement): Konva.Group | Konva.Text | null {
		const fontSize = el.fontSize || 16;
		const family = el.fontFamily;
		// Text on a solid fill keeps the dark on-fill color, but hachure and cross-hatch leave the background visible
		const solid = !!el.fill && ((el.fillStyle || 'solid') == 'solid');
		const fillText = solid ? this.theme.onFill : (this.theme.textColor[el.color || 'default'] || this.theme.text);

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

		const bgKey = [ width, height, viewport.x, viewport.y, viewport.zoom, this.theme.bg, this.theme.grid, this.controller.showGrid ].join(':');

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

		if (!this.controller.showGrid) {
			return;
		};

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
