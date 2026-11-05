import { CanvasElement, ElementType, Point, Rect } from './types';

const LINEAR = [ ElementType.Line, ElementType.Arrow, ElementType.Freehand ];

export const isLinear = (el: CanvasElement): boolean => LINEAR.includes(el.type);

export const normalizeRect = (r: Rect): Rect => {
	return {
		x: r.w < 0 ? r.x + r.w : r.x,
		y: r.h < 0 ? r.y + r.h : r.y,
		w: Math.abs(r.w),
		h: Math.abs(r.h),
	};
};

export const rectsIntersect = (a: Rect, b: Rect): boolean => {
	return (a.x <= (b.x + b.w)) && ((a.x + a.w) >= b.x) && (a.y <= (b.y + b.h)) && ((a.y + a.h) >= b.y);
};

export const rectContains = (outer: Rect, inner: Rect): boolean => {
	return (inner.x >= outer.x) && (inner.y >= outer.y) && ((inner.x + inner.w) <= (outer.x + outer.w)) && ((inner.y + inner.h) <= (outer.y + outer.h));
};

export const pointInRect = (p: Point, r: Rect): boolean => {
	return (p.x >= r.x) && (p.x <= (r.x + r.w)) && (p.y >= r.y) && (p.y <= (r.y + r.h));
};

export const expandRect = (r: Rect, d: number): Rect => {
	return { x: r.x - d, y: r.y - d, w: r.w + (d * 2), h: r.h + (d * 2) };
};

export const center = (el: Rect): Point => {
	return { x: el.x + (el.w / 2), y: el.y + (el.h / 2) };
};

export const rotatePoint = (p: Point, origin: Point, angle: number): Point => {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const dx = p.x - origin.x;
	const dy = p.y - origin.y;

	return { x: origin.x + (dx * cos) - (dy * sin), y: origin.y + (dx * sin) + (dy * cos) };
};

/** Axis aligned bounds of an element in world space, including rotation. */
export const elementBounds = (el: CanvasElement): Rect => {
	if (!el.angle) {
		return { x: el.x, y: el.y, w: el.w, h: el.h };
	};

	const c = center(el);
	const corners = [
		{ x: el.x, y: el.y },
		{ x: el.x + el.w, y: el.y },
		{ x: el.x + el.w, y: el.y + el.h },
		{ x: el.x, y: el.y + el.h },
	].map(p => rotatePoint(p, c, el.angle));

	return pointsBounds(corners);
};

export const pointsBounds = (points: Point[]): Rect => {
	if (!points.length) {
		return { x: 0, y: 0, w: 0, h: 0 };
	};

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	points.forEach(p => {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	});

	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

export const unionBounds = (elements: CanvasElement[]): Rect | null => {
	if (!elements.length) {
		return null;
	};

	const rects = elements.map(elementBounds);
	const minX = Math.min(...rects.map(r => r.x));
	const minY = Math.min(...rects.map(r => r.y));
	const maxX = Math.max(...rects.map(r => r.x + r.w));
	const maxY = Math.max(...rects.map(r => r.y + r.h));

	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

export const distToSegment = (p: Point, a: Point, b: Point): number => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = (dx * dx) + (dy * dy);

	if (!len2) {
		return Math.hypot(p.x - a.x, p.y - a.y);
	};

	const t = Math.max(0, Math.min(1, (((p.x - a.x) * dx) + ((p.y - a.y) * dy)) / len2));

	return Math.hypot(p.x - (a.x + (t * dx)), p.y - (a.y + (t * dy)));
};

/** World space points of a linear element (line, arrow, freehand). */
export const worldPoints = (el: CanvasElement): Point[] => {
	return (el.points || []).map(p => ({ x: el.x + p[0], y: el.y + p[1] }));
};

/** Hit test in world space. tolerance is in world units (screen tolerance / zoom). */
export const hitTest = (el: CanvasElement, world: Point, tolerance: number): boolean => {
	if (el.deleted) {
		return false;
	};

	let p = world;
	if (el.angle) {
		p = rotatePoint(world, center(el), -el.angle);
	};

	if (isLinear(el)) {
		const pts = worldPoints(el);
		const t = tolerance + ((el.strokeWidth || 2) / 2);

		for (let i = 0; i < (pts.length - 1); i++) {
			if (distToSegment(p, pts[i], pts[i + 1]) <= t) {
				return true;
			};
		};
		return (pts.length == 1) && (Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= t);
	};

	if (el.type == ElementType.Ellipse) {
		const c = center(el);
		const rx = (el.w / 2) + tolerance;
		const ry = (el.h / 2) + tolerance;

		if (!rx || !ry) {
			return false;
		};

		const nx = (p.x - c.x) / rx;
		const ny = (p.y - c.y) / ry;
		const inside = ((nx * nx) + (ny * ny)) <= 1;

		if (el.fill) {
			return inside;
		};

		// Unfilled shapes are only hit near the outline
		const irx = Math.max(0, (el.w / 2) - tolerance);
		const iry = Math.max(0, (el.h / 2) - tolerance);
		if (!irx || !iry) {
			return inside;
		};

		const ix = (p.x - c.x) / irx;
		const iy = (p.y - c.y) / iry;
		return inside && (((ix * ix) + (iy * iy)) >= 1);
	};

	const r = expandRect(el, tolerance);
	if (!pointInRect(p, r)) {
		return false;
	};

	// Unfilled rectangles and frames are only hit on the outline (and frames on their title)
	if ((el.type == ElementType.Rect) && !el.fill) {
		const inner = expandRect(el, -tolerance);
		return !pointInRect(p, inner);
	};

	if (el.type == ElementType.Frame) {
		const inner = expandRect(el, -tolerance);
		return !pointInRect(p, inner) || (p.y < (el.y + 28));
	};

	return true;
};

/** Ramer-Douglas-Peucker simplification, used to keep freehand strokes small. */
export const simplify = (points: number[][], epsilon: number): number[][] => {
	if (points.length < 3) {
		return points;
	};

	const sqEps = epsilon * epsilon;
	const keep = new Array(points.length).fill(false);
	keep[0] = keep[points.length - 1] = true;

	const stack: number[][] = [ [ 0, points.length - 1 ] ];
	while (stack.length) {
		const [ first, last ] = stack.pop();
		let maxD = 0;
		let index = -1;

		for (let i = first + 1; i < last; i++) {
			const d = distToSegment(
				{ x: points[i][0], y: points[i][1] },
				{ x: points[first][0], y: points[first][1] },
				{ x: points[last][0], y: points[last][1] },
			);
			if ((d * d) > maxD) {
				maxD = d * d;
				index = i;
			};
		};

		if ((maxD > sqEps) && (index > 0)) {
			keep[index] = true;
			stack.push([ first, index ], [ index, last ]);
		};
	};

	return points.filter((_, i) => keep[i]);
};

/** Point on the border of the element's bounds in the direction of `toward`. */
export const anchorPoint = (el: CanvasElement, toward: Point): Point => {
	const c = center(el);
	const dx = toward.x - c.x;
	const dy = toward.y - c.y;

	if (!dx && !dy) {
		return c;
	};

	const hw = Math.max(1, el.w / 2);
	const hh = Math.max(1, el.h / 2);

	if (el.type == ElementType.Ellipse) {
		const k = 1 / Math.sqrt(((dx * dx) / (hw * hw)) + ((dy * dy) / (hh * hh)));
		return { x: c.x + (dx * k), y: c.y + (dy * k) };
	};

	const k = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);

	return { x: c.x + (dx * k), y: c.y + (dy * k) };
};

/** Rough text height used before the renderer measures the real text. */
export const estimateTextHeight = (text: string, width: number, fontSize: number): number => {
	const charWidth = fontSize * 0.55;
	const perLine = Math.max(1, Math.floor(width / charWidth));
	let lines = 0;

	String(text || '').split('\n').forEach(line => {
		lines += Math.max(1, Math.ceil(line.length / perLine));
	});

	return Math.ceil(lines * fontSize * 1.3);
};

/** Shift points so the bounding box starts at x, y and keep w, h in sync. */
export const normalizeLinear = (el: CanvasElement): CanvasElement => {
	const pts = el.points || [];
	if (!pts.length) {
		return el;
	};

	const b = pointsBounds(pts.map(p => ({ x: p[0], y: p[1] })));

	return {
		...el,
		x: el.x + b.x,
		y: el.y + b.y,
		w: b.w,
		h: b.h,
		points: pts.map(p => [ p[0] - b.x, p[1] - b.y ]),
	};
};
