import { Point, Rect, Viewport, MIN_ZOOM, MAX_ZOOM } from './types';

export const clampZoom = (zoom: number): number => {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
};

export const screenToWorld = (vp: Viewport, p: Point): Point => {
	return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
};

export const worldToScreen = (vp: Viewport, p: Point): Point => {
	return { x: (p.x * vp.zoom) + vp.x, y: (p.y * vp.zoom) + vp.y };
};

/** Zoom keeping the world point under the screen point fixed. */
export const zoomAt = (vp: Viewport, screen: Point, factor: number): Viewport => {
	const zoom = clampZoom(vp.zoom * factor);
	const world = screenToWorld(vp, screen);

	return { zoom, x: screen.x - (world.x * zoom), y: screen.y - (world.y * zoom) };
};

export const pan = (vp: Viewport, dx: number, dy: number): Viewport => {
	return { ...vp, x: vp.x + dx, y: vp.y + dy };
};

/** World rectangle currently visible in a screen of the given size. */
export const visibleRect = (vp: Viewport, width: number, height: number): Rect => {
	const tl = screenToWorld(vp, { x: 0, y: 0 });

	return { x: tl.x, y: tl.y, w: width / vp.zoom, h: height / vp.zoom };
};

/** Viewport that fits the world rectangle into the screen with padding. */
export const fitRect = (rect: Rect, width: number, height: number, padding = 48): Viewport => {
	if (!rect.w || !rect.h || !width || !height) {
		return { x: width / 2, y: height / 2, zoom: 1 };
	};

	const zoom = clampZoom(Math.min((width - (padding * 2)) / rect.w, (height - (padding * 2)) / rect.h, 1));

	return {
		zoom,
		x: ((width - (rect.w * zoom)) / 2) - (rect.x * zoom),
		y: ((height - (rect.h * zoom)) / 2) - (rect.y * zoom),
	};
};
