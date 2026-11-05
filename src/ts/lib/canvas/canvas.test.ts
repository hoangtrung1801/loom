import { describe, it, expect } from 'vitest';
import {
	Scene, CanvasController, ElementType, Tool, CanvasElement, between, compareZ, screenToWorld, worldToScreen, zoomAt,
	hitTest, simplify, SpatialIndex, decodeElement, encodeElement, defaultElement, shouldApplyRemote, anchorPoint, fitRect,
} from './index';

const rect = (id: string, x: number, y: number, w = 100, h = 60, param: Partial<CanvasElement> = {}) => {
	return defaultElement(ElementType.Rect, id, 'i', { x, y, w, h, v: 1, ...param });
};

describe('fractional order', () => {
	it('always yields a value strictly between neighbours', () => {
		let a: string | null = null;
		const list: string[] = [];

		for (let i = 0; i < 40; i++) {
			a = between(a, null);
			list.push(a);
		};
		expect([ ...list ].sort()).toEqual(list);

		const m = between(list[3], list[4]);
		expect(m > list[3]).toBe(true);
		expect(m < list[4]).toBe(true);
	});

	it('inserts before the first element', () => {
		const first = between(null, 'i');
		expect(first < 'i').toBe(true);
	});

	it('breaks ties by id', () => {
		expect(compareZ({ z: 'a', id: '1' }, { z: 'a', id: '2' })).toBe(-1);
	});
});

describe('viewport', () => {
	it('round trips screen and world', () => {
		const vp = { x: 40, y: -20, zoom: 2 };
		const p = worldToScreen(vp, screenToWorld(vp, { x: 123, y: 45 }));
		expect(p.x).toBeCloseTo(123);
		expect(p.y).toBeCloseTo(45);
	});

	it('zooms around the pointer', () => {
		const vp = { x: 0, y: 0, zoom: 1 };
		const before = screenToWorld(vp, { x: 200, y: 100 });
		const next = zoomAt(vp, { x: 200, y: 100 }, 2);
		const after = screenToWorld(next, { x: 200, y: 100 });
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
		expect(next.zoom).toBe(2);
	});

	it('clamps zoom', () => {
		expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 1000).zoom).toBe(8);
	});

	it('fits a rect', () => {
		const vp = fitRect({ x: 0, y: 0, w: 1000, h: 500 }, 500, 500, 0);
		expect(vp.zoom).toBeCloseTo(0.5);
	});
});

describe('geometry', () => {
	it('hits filled shapes inside and unfilled only on the outline', () => {
		const filled = rect('a', 0, 0, 100, 100, { fill: 'blue' });
		const hollow = rect('b', 0, 0, 100, 100);

		expect(hitTest(filled, { x: 50, y: 50 }, 2)).toBe(true);
		expect(hitTest(hollow, { x: 50, y: 50 }, 2)).toBe(false);
		expect(hitTest(hollow, { x: 1, y: 50 }, 2)).toBe(true);
		expect(hitTest(filled, { x: 200, y: 50 }, 2)).toBe(false);
	});

	it('respects rotation', () => {
		const el = rect('a', 0, 0, 200, 20, { fill: 'red', angle: Math.PI / 2 });
		// rotated 90 degrees around (100, 10): now tall and thin
		expect(hitTest(el, { x: 100, y: 100 }, 1)).toBe(true);
		expect(hitTest(el, { x: 190, y: 10 }, 1)).toBe(false);
	});

	it('hits lines by distance to the segment', () => {
		const line = defaultElement(ElementType.Line, 'l', 'i', { x: 0, y: 0, w: 100, h: 0, points: [ [ 0, 0 ], [ 100, 0 ] ], strokeWidth: 2 });
		expect(hitTest(line, { x: 50, y: 3 }, 4)).toBe(true);
		expect(hitTest(line, { x: 50, y: 30 }, 4)).toBe(false);
	});

	it('simplifies a straight stroke to its end points', () => {
		const pts = Array.from({ length: 50 }, (_, i) => [ i, i * 2 ]);
		expect(simplify(pts, 0.5)).toEqual([ pts[0], pts[49] ]);
	});

	it('anchors arrows on the border of a shape', () => {
		const el = rect('a', 0, 0, 100, 100);
		const p = anchorPoint(el, { x: 500, y: 50 });
		expect(p.x).toBeCloseTo(100);
		expect(p.y).toBeCloseTo(50);
	});
});

describe('spatial index', () => {
	it('finds rects across cells and forgets deleted ones', () => {
		const index = new SpatialIndex();
		index.set('a', { x: 0, y: 0, w: 10, h: 10 });
		index.set('b', { x: 5000, y: 5000, w: 600, h: 600 });

		expect(index.query({ x: -5, y: -5, w: 20, h: 20 })).toEqual([ 'a' ]);
		expect(index.query({ x: 5400, y: 5400, w: 10, h: 10 })).toEqual([ 'b' ]);
		index.delete('b');
		expect(index.query({ x: 5400, y: 5400, w: 10, h: 10 })).toEqual([]);
		expect(index.size).toBe(1);
	});
});

describe('codec', () => {
	it('round trips an element and drops empty fields', () => {
		const el = rect('a', 1, 2, 3, 4, { color: 'red', text: '' });
		const text = encodeElement(el);

		expect(text.includes('"text"')).toBe(false);
		expect(decodeElement(text)).toMatchObject({ id: 'a', type: 'rect', x: 1, y: 2, w: 3, h: 4, color: 'red' });
	});

	it('rejects garbage', () => {
		expect(decodeElement('')).toBeNull();
		expect(decodeElement('{nope')).toBeNull();
		expect(decodeElement('{"id":"a","type":"bogus"}')).toBeNull();
	});
});

describe('scene conflicts', () => {
	it('higher version wins, equal versions converge by nonce', () => {
		const a = rect('a', 0, 0, 10, 10, { v: 2, nonce: 5 });
		expect(shouldApplyRemote(a, { ...a, v: 3 })).toBe(true);
		expect(shouldApplyRemote(a, { ...a, v: 1 })).toBe(false);
		expect(shouldApplyRemote(a, { ...a, nonce: 4 })).toBe(true);
		expect(shouldApplyRemote(a, { ...a, nonce: 6 })).toBe(false);
		expect(shouldApplyRemote(a, a)).toBe(false);
	});

	it('local edits bump the version and tombstones beat stale edits', () => {
		const scene = new Scene();
		scene.load([ rect('a', 0, 0) ]);

		const [ moved ] = scene.upsert([ { ...scene.get('a'), x: 50 } ]);
		expect(moved.v).toBe(2);

		scene.remove([ 'a' ]);
		expect(scene.get('a').deleted).toBe(true);
		expect(scene.count()).toBe(0);

		const applied = scene.applyRemote([ { ...moved, x: 80 } ]);
		expect(applied).toEqual([]);
		expect(scene.get('a').deleted).toBe(true);
	});

	it('applies remote changes to different elements independently', () => {
		const scene = new Scene();
		scene.load([ rect('a', 0, 0), rect('b', 200, 0) ]);

		scene.upsert([ { ...scene.get('a'), x: 10 } ]);
		scene.applyRemote([ { ...scene.get('b'), x: 300, v: 5 } ]);

		expect(scene.get('a').x).toBe(10);
		expect(scene.get('b').x).toBe(300);
	});
});

const setup = () => {
	const scene = new Scene();
	const commits: CanvasElement[][] = [];
	const controller = new CanvasController(scene, { onCommit: c => commits.push(c) });

	controller.setSize(800, 600);
	return { scene, controller, commits };
};

describe('controller', () => {
	it('draws a rectangle with the rect tool and returns to select', () => {
		const { scene, controller, commits } = setup();

		controller.setTool(Tool.Rect);
		controller.pointerDown({ x: 10, y: 10 });
		controller.pointerMove({ x: 110, y: 60 });
		controller.pointerUp({ x: 110, y: 60 });

		const [ el ] = scene.list();
		expect(el).toMatchObject({ type: 'rect', x: 10, y: 10, w: 100, h: 50 });
		expect(controller.tool).toBe(Tool.Select);
		expect(scene.selection.has(el.id)).toBe(true);
		expect(commits.length).toBe(1);
	});

	it('moves a selected element and undoes it', () => {
		const { scene, controller } = setup();
		scene.load([ rect('a', 100, 100, 100, 100, { fill: 'blue' }) ]);

		controller.pointerDown({ x: 150, y: 150 });
		controller.pointerMove({ x: 250, y: 190 }, { alt: true });
		controller.pointerUp({ x: 250, y: 190 });
		expect(scene.get('a')).toMatchObject({ x: 200, y: 140 });

		controller.undo();
		expect(scene.get('a')).toMatchObject({ x: 100, y: 100 });

		controller.redo();
		expect(scene.get('a')).toMatchObject({ x: 200, y: 140 });
	});

	it('snaps a dragged element to a neighbour edge', () => {
		const { scene, controller } = setup();
		scene.load([ rect('a', 0, 0, 100, 100, { fill: 'blue' }), rect('b', 300, 0, 100, 100, { fill: 'blue' }) ]);

		controller.pointerDown({ x: 350, y: 50 });
		// move b so its left edge lands 3px from a's right edge (100)
		controller.pointerMove({ x: 350 - 197, y: 50 });
		controller.pointerUp({ x: 350 - 197, y: 50 });
		expect(scene.get('b').x).toBe(100);
	});

	it('selects with a marquee', () => {
		const { scene, controller } = setup();
		scene.load([ rect('a', 0, 0), rect('b', 50, 50), rect('c', 600, 400) ]);

		controller.pointerDown({ x: -20, y: -20 });
		controller.pointerMove({ x: 200, y: 200 });
		controller.pointerUp({ x: 200, y: 200 });

		expect(Array.from(scene.selection).sort()).toEqual([ 'a', 'b' ]);
	});

	it('resizes through a handle', () => {
		const { scene, controller } = setup();
		scene.load([ rect('a', 100, 100, 100, 100, { fill: 'blue' }) ]);
		scene.setSelection([ 'a' ]);

		controller.pointerDown({ x: 200, y: 200 });
		controller.pointerMove({ x: 260, y: 240 });
		controller.pointerUp({ x: 260, y: 240 });

		expect(scene.get('a')).toMatchObject({ x: 100, y: 100, w: 160, h: 140 });
	});

	it('deletes with a tombstone, unbinds arrows and restores on undo', () => {
		const { scene, controller } = setup();
		const arrow = defaultElement(ElementType.Arrow, 'ar', 'j', { x: 100, y: 50, w: 100, h: 0, points: [ [ 0, 0 ], [ 100, 0 ] ], startId: 'a', endId: 'b', v: 1 });
		scene.load([ rect('a', 0, 0), rect('b', 200, 0), arrow ]);
		scene.setSelection([ 'b' ]);

		controller.deleteSelection();
		expect(scene.get('b').deleted).toBe(true);
		expect(scene.get('ar').endId).toBe('');
		expect(scene.get('ar').startId).toBe('a');

		controller.undo();
		expect(scene.get('b').deleted).toBe(false);
		expect(scene.get('ar').endId).toBe('b');
	});

	it('keeps arrows attached when a bound element moves', () => {
		const { scene, controller } = setup();
		const arrow = defaultElement(ElementType.Arrow, 'ar', 'j', { x: 100, y: 30, w: 100, h: 0, points: [ [ 0, 0 ], [ 100, 0 ] ], startId: 'a', endId: 'b', v: 1 });
		scene.load([ rect('a', 0, 0, 100, 60, { fill: 'red' }), rect('b', 200, 0, 100, 60, { fill: 'red' }), arrow ]);

		scene.setSelection([ 'b' ]);
		controller.nudge(0, 100);

		const next = scene.get('ar');
		const last = next.points[next.points.length - 1];
		expect(next.y + last[1]).toBeGreaterThan(60);
	});

	it('pastes copies with fresh ids', () => {
		const { scene, controller } = setup();
		scene.load([ rect('a', 0, 0) ]);
		scene.setSelection([ 'a' ]);

		controller.copy();
		controller.paste();

		expect(scene.count()).toBe(2);
		const copy = scene.list().find(el => el.id != 'a');
		expect(copy.x).toBe(24);
		expect(Array.from(scene.selection)).toEqual([ copy.id ]);
	});

	it('pans with the hand tool and zooms with the wheel', () => {
		const { controller } = setup();

		controller.setTool(Tool.Hand);
		controller.pointerDown({ x: 0, y: 0 });
		controller.pointerMove({ x: 30, y: 20 });
		controller.pointerUp({ x: 30, y: 20 });
		expect(controller.viewport).toMatchObject({ x: 30, y: 20 });

		controller.wheel({ x: 0, y: 0 }, 0, -100, true);
		expect(controller.viewport.zoom).toBeGreaterThan(1);
	});

	it('does not edit when read only', () => {
		const { scene, controller } = setup();
		scene.load([ rect('a', 0, 0, 100, 100, { fill: 'blue' }) ]);
		controller.readonly = true;

		controller.pointerDown({ x: 50, y: 50 });
		controller.pointerMove({ x: 150, y: 150 });
		controller.pointerUp({ x: 150, y: 150 });
		expect(scene.get('a').x).toBe(0);

		controller.setTool(Tool.Rect);
		expect(controller.tool).toBe(Tool.Select);
	});

	it('handles keyboard shortcuts', () => {
		const { scene, controller } = setup();
		scene.load([ rect('a', 0, 0) ]);

		expect(controller.keyDown({ key: 'r' })).toBe(true);
		expect(controller.tool).toBe(Tool.Rect);

		controller.keyDown({ key: 'a', meta: true });
		expect(scene.selection.size).toBe(1);

		controller.keyDown({ key: 'Delete' });
		expect(scene.count()).toBe(0);

		controller.keyDown({ key: 'z', meta: true });
		expect(scene.count()).toBe(1);
	});
});
