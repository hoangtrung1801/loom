import { Application, CanvasTextMetrics, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { CanvasController, CanvasElement, ElementType, elementBounds, isLinear, visibleRect, expandRect, worldPoints, center } from 'Lib/canvas';

export interface RendererTheme {
	bg: string;
	grid: string;
	text: string;
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
	node: Container;
	key: string;
};

const color = (hex: string): number => {
	const v = String(hex || '').replace('#', '');
	if (v.length == 3) {
		return parseInt(v.split('').map(c => c + c).join(''), 16);
	};
	return parseInt(v.slice(0, 6) || '000000', 16);
};

const FRAME_TITLE = 12;
const ARROW_HEAD = 14;

/**
 * PixiJS (WebGL) renderer for a canvas scene. It only draws what is visible, keeps one display
 * object per element and rebuilds a view only when the element (or its object info) changed.
 */
export class CanvasRenderer {

	private app: Application | null = null;
	private world = new Container();
	private elementsLayer = new Container();
	private draftLayer = new Container();
	private grid = new Graphics();
	private overlay = new Graphics();
	private views = new Map<string, View>();
	private draftView: View | null = null;
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

	async init (canvas: HTMLCanvasElement, resizeTo: HTMLElement) {
		const app = new Application();

		await app.init({
			canvas,
			resizeTo,
			antialias: true,
			autoDensity: true,
			resolution: window.devicePixelRatio || 1,
			background: color(this.theme.bg),
			preference: 'webgl',
		});

		if (this.destroyed) {
			app.destroy(false, { children: true });
			return;
		};

		this.app = app;
		this.world.addChild(this.elementsLayer, this.draftLayer);
		app.stage.addChild(this.grid, this.world, this.overlay);
		this.ready = true;

		this.controller.measureText = (text, width, fontSize) => this.measure(text, width, fontSize);
		this.requestRender();
	};

	setTheme (theme: RendererTheme) {
		this.theme = theme;
		if (this.app) {
			this.app.renderer.background.color = color(theme.bg);
		};
		this.views.forEach(view => view.node.destroy({ children: true }));
		this.views.clear();
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

		if (this.app && this.ready) {
			this.app.destroy(false, { children: true });
		};
		this.app = null;
		this.ready = false;
		this.views.clear();
	};

	private style (el: CanvasElement, width: number): TextStyle {
		return new TextStyle({
			fontFamily: this.theme.fontFamily,
			fontSize: el.fontSize || 16,
			fill: color(this.theme.textColor[el.color || 'default'] || this.theme.text),
			wordWrap: true,
			wordWrapWidth: Math.max(10, width),
			breakWords: true,
			lineHeight: Math.round((el.fontSize || 16) * 1.3),
		});
	};

	private measure (text: string, width: number, fontSize: number): number {
		const style = new TextStyle({
			fontFamily: this.theme.fontFamily,
			fontSize,
			wordWrap: true,
			wordWrapWidth: Math.max(10, width),
			breakWords: true,
			lineHeight: Math.round(fontSize * 1.3),
		});

		return Math.ceil(CanvasTextMetrics.measureText(text || ' ', style).height);
	};

	// --------------------------------------------------------- //

	private elementKey (el: CanvasElement): string {
		const info = (el.type == ElementType.Object) ? this.getObject(el.targetObjectId) : null;

		return [ el.v, el.nonce, this.objectVersion, info ? `${info.name}|${info.type}` : '', (el.id == this.hiddenId) ? 'h' : '' ].join(':');
	};

	private stroke (el: CanvasElement): number {
		return color(this.theme.stroke[el.color || 'default'] || this.theme.text);
	};

	private fillColor (el: CanvasElement): number | null {
		if (!el.fill) {
			return null;
		};
		return color(this.theme.fill[el.fill] || this.theme.fill.yellow);
	};

	private build (el: CanvasElement): Container {
		const node = new Container();
		const g = new Graphics();
		const sw = el.strokeWidth || 2;
		const stroke = this.stroke(el);
		const fill = this.fillColor(el);
		const hidden = el.id == this.hiddenId;

		node.addChild(g);

		switch (el.type) {
			case ElementType.Rect:
			case ElementType.Sticky: {
				g.rect(0, 0, el.w, el.h);
				if (fill !== null) {
					g.fill({ color: fill });
				};
				if (el.type == ElementType.Rect) {
					g.stroke({ width: sw, color: stroke });
				};
				break;
			};

			case ElementType.Ellipse: {
				g.ellipse(el.w / 2, el.h / 2, el.w / 2, el.h / 2);
				if (fill !== null) {
					g.fill({ color: fill });
				};
				g.stroke({ width: sw, color: stroke });
				break;
			};

			case ElementType.Frame: {
				g.rect(0, 0, el.w, el.h).fill({ color: color(this.theme.fill.grey || this.theme.bg), alpha: 0.12 });
				g.rect(0, 0, el.w, el.h).stroke({ width: 1, color: color(this.theme.muted) });
				break;
			};

			case ElementType.Line:
			case ElementType.Arrow:
			case ElementType.Freehand: {
				const pts = el.points || [];

				if (pts.length) {
					g.moveTo(pts[0][0], pts[0][1]);
					for (let i = 1; i < pts.length; i++) {
						g.lineTo(pts[i][0], pts[i][1]);
					};
					g.stroke({ width: sw, color: stroke, cap: 'round', join: 'round' });
				};

				if ((el.type == ElementType.Arrow) && (pts.length > 1)) {
					const a = pts[pts.length - 2];
					const b = pts[pts.length - 1];
					const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
					const len = ARROW_HEAD + sw;

					g.moveTo(b[0] - (Math.cos(angle - 0.45) * len), b[1] - (Math.sin(angle - 0.45) * len));
					g.lineTo(b[0], b[1]);
					g.lineTo(b[0] - (Math.cos(angle + 0.45) * len), b[1] - (Math.sin(angle + 0.45) * len));
					g.stroke({ width: sw, color: stroke, cap: 'round', join: 'round' });
				};
				break;
			};

			case ElementType.Object: {
				const info = this.getObject(el.targetObjectId);

				g.roundRect(0, 0, el.w, el.h, 8).fill({ color: color(this.theme.card) });
				g.roundRect(0, 0, el.w, el.h, 8).stroke({ width: 1, color: color(this.theme.cardBorder) });

				const name = new Text({
					text: (info?.name || '').slice(0, 120),
					style: new TextStyle({
						fontFamily: this.theme.fontFamily,
						fontSize: 15,
						fontWeight: '600',
						fill: color(this.theme.text),
						wordWrap: true,
						wordWrapWidth: el.w - 24,
						breakWords: true,
					}),
				});
				name.position.set(12, 12);
				name.label = 'text';
				node.addChild(name);

				if (info?.type) {
					const type = new Text({
						text: info.type,
						style: new TextStyle({ fontFamily: this.theme.fontFamily, fontSize: 12, fill: color(this.theme.muted) }),
					});
					type.position.set(12, el.h - 12 - type.height);
					type.label = 'text';
					node.addChild(type);
				};
				break;
			};
		};

		// Text content for text, sticky, frame title and shape labels
		if (el.text && !hidden && (el.type != ElementType.Object) && !isLinear(el)) {
			if (el.type == ElementType.Frame) {
				const title = new Text({
					text: el.text,
					style: new TextStyle({ fontFamily: this.theme.fontFamily, fontSize: FRAME_TITLE, fill: color(this.theme.muted) }),
				});
				title.position.set(0, -title.height - 4);
				title.label = 'text';
				node.addChild(title);
			} else {
				const padded = (el.type != ElementType.Text);
				const pad = padded ? 12 : 0;
				const text = new Text({ text: el.text, style: this.style(el, el.w - (pad * 2)) });

				if ((el.type == ElementType.Rect) || (el.type == ElementType.Ellipse)) {
					text.anchor.set(0.5);
					text.position.set(el.w / 2, el.h / 2);
				} else {
					text.position.set(pad, pad);
				};
				text.label = 'text';
				node.addChild(text);
			};
		};

		node.pivot.set(el.w / 2, el.h / 2);
		node.position.set(el.x + (el.w / 2), el.y + (el.h / 2));
		node.rotation = el.angle || 0;

		return node;
	};

	// --------------------------------------------------------- //

	private render () {
		if (!this.app || this.destroyed) {
			return;
		};

		const { viewport, scene } = this.controller;
		const width = this.app.screen.width;
		const height = this.app.screen.height;

		this.controller.width = width;
		this.controller.height = height;

		this.world.position.set(viewport.x, viewport.y);
		this.world.scale.set(viewport.zoom);

		this.renderGrid(width, height);

		// Only elements near the screen get a display object
		const area = expandRect(visibleRect(viewport, width, height), 64 / viewport.zoom);
		const visible = new Set<string>();

		scene.query(area).forEach(el => {
			visible.add(el.id);

			const key = this.elementKey(el);
			let view = this.views.get(el.id);

			if (!view || (view.key != key)) {
				view?.node.destroy({ children: true });
				view = { node: this.build(el), key };
				this.views.set(el.id, view);
				this.elementsLayer.addChild(view.node);
			};

			view.node.visible = true;
			view.node.children.forEach(child => {
				if (child.label == 'text') {
					child.visible = viewport.zoom >= 0.2;
				};
			});
		});

		this.views.forEach((view, id) => {
			const el = scene.get(id);

			if (!el || el.deleted) {
				view.node.destroy({ children: true });
				this.views.delete(id);
			} else
			if (!visible.has(id)) {
				view.node.visible = false;
			};
		});

		this.orderViews(visible);
		this.renderDraft();
		this.renderOverlay();
		this.app.render();
	};

	private lastOrder = '';

	/** Keep display order equal to z order, but only touch the stage when the order changed. */
	private orderViews (visible: Set<string>) {
		const ids = this.controller.scene.list().filter(el => visible.has(el.id)).map(el => el.id);
		const sig = ids.join(',');

		if (sig == this.lastOrder) {
			return;
		};
		this.lastOrder = sig;

		ids.forEach((id, index) => {
			const view = this.views.get(id);
			if (view) {
				this.elementsLayer.setChildIndex(view.node, Math.min(index, this.elementsLayer.children.length - 1));
			};
		});
	};

	private renderGrid (width: number, height: number) {
		const { viewport } = this.controller;
		const g = this.grid;
		let step = 24 * viewport.zoom;

		g.clear();

		while (step < 12) {
			step *= 2;
		};

		if (step > 400) {
			return;
		};

		const ox = ((viewport.x % step) + step) % step;
		const oy = ((viewport.y % step) + step) % step;
		const size = Math.max(0.75, Math.min(1.5, viewport.zoom));

		for (let x = ox; x < width; x += step) {
			for (let y = oy; y < height; y += step) {
				g.rect(x - (size / 2), y - (size / 2), size, size);
			};
		};
		g.fill({ color: color(this.theme.grid) });
	};

	private renderDraft () {
		const { draft } = this.controller;

		if (this.draftView) {
			this.draftView.node.destroy({ children: true });
			this.draftView = null;
		};

		if (!draft) {
			return;
		};

		this.draftView = { node: this.build(draft), key: '' };
		this.draftLayer.addChild(this.draftView.node);
	};

	private renderOverlay () {
		const { controller } = this;
		const { viewport, scene } = controller;
		const g = this.overlay;
		const selected = color(this.theme.selected);
		const sx = (v: number) => (v * viewport.zoom) + viewport.x;
		const sy = (v: number) => (v * viewport.zoom) + viewport.y;

		g.clear();

		const outline = (el: CanvasElement, width: number, alpha = 1) => {
			if (!el.angle || isLinear(el)) {
				const b = elementBounds(el);
				g.rect(sx(b.x), sy(b.y), b.w * viewport.zoom, b.h * viewport.zoom);
			} else {
				const c = center(el);
				const corners = [ [ el.x, el.y ], [ el.x + el.w, el.y ], [ el.x + el.w, el.y + el.h ], [ el.x, el.y + el.h ] ].map(([ x, y ]) => {
					const cos = Math.cos(el.angle);
					const sin = Math.sin(el.angle);
					return [ c.x + ((x - c.x) * cos) - ((y - c.y) * sin), c.y + ((x - c.x) * sin) + ((y - c.y) * cos) ];
				});

				g.moveTo(sx(corners[0][0]), sy(corners[0][1]));
				corners.slice(1).forEach(p => g.lineTo(sx(p[0]), sy(p[1])));
				g.closePath();
			};
			g.stroke({ width, color: selected, alpha });
		};

		if (controller.hoverId && !scene.selection.has(controller.hoverId)) {
			const el = scene.get(controller.hoverId);
			if (el && !el.deleted) {
				outline(el, 1, 0.6);
			};
		};

		scene.selected().forEach(el => outline(el, 1.5));

		if (scene.selection.size > 1) {
			const b = controller.selectionBounds();
			if (b) {
				g.rect(sx(b.x), sy(b.y), b.w * viewport.zoom, b.h * viewport.zoom).stroke({ width: 1, color: selected, alpha: 0.5 });
			};
		};

		const handles = controller.handles();
		const sel = scene.selected();

		if (sel.length == 1) {
			const top = handles.find(h => h.id == 'n');
			const rot = handles.find(h => h.id == 'rotate');

			if (top && rot) {
				g.moveTo(sx(top.point.x), sy(top.point.y)).lineTo(sx(rot.point.x), sy(rot.point.y)).stroke({ width: 1, color: selected });
			};
		};

		handles.forEach(h => {
			if ((h.id == 'rotate')) {
				g.circle(sx(h.point.x), sy(h.point.y), 5).fill({ color: color(this.theme.bg) }).stroke({ width: 1.5, color: selected });
			} else {
				g.rect(sx(h.point.x) - 4, sy(h.point.y) - 4, 8, 8).fill({ color: color(this.theme.bg) }).stroke({ width: 1.5, color: selected });
			};
		});

		if (controller.marquee) {
			const m = controller.marquee;
			g.rect(sx(m.x), sy(m.y), m.w * viewport.zoom, m.h * viewport.zoom).fill({ color: selected, alpha: 0.08 }).stroke({ width: 1, color: selected, alpha: 0.8 });
		};

		controller.guides.forEach(guide => {
			if (guide.axis == 'x') {
				g.moveTo(sx(guide.value), sy(guide.from)).lineTo(sx(guide.value), sy(guide.to));
			} else {
				g.moveTo(sx(guide.from), sy(guide.value)).lineTo(sx(guide.to), sy(guide.value));
			};
			g.stroke({ width: 1, color: color(this.theme.highlight) });
		});

		// Keep line endpoints visible when a single line is selected
		if ((sel.length == 1) && [ ElementType.Line, ElementType.Arrow ].includes(sel[0].type)) {
			worldPoints(sel[0]).forEach(p => g.circle(sx(p.x), sy(p.y), 3.5).fill({ color: selected }));
		};
	};

};
