import { describe, it, expect } from 'vitest';
import {
	Scene, CanvasController, ElementType, Tool, CanvasElement, between, compareZ, screenToWorld, worldToScreen, zoomAt,
	hitTest, simplify, SpatialIndex, decodeElement, encodeElement, defaultElement, shouldApplyRemote, anchorPoint, fitRect, elementBounds, routePoints, applyRoute, curveSamples, toLibraryElements, borderFocus, focusPoint, decodeClipboardElements, isCustomColor,
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

	it('tells custom hex colors from palette names', () => {
		expect(isCustomColor('#fff')).toBe(true);
		expect(isCustomColor('#f8f8f8')).toBe(true);
		expect(isCustomColor('#00000000')).toBe(true);
		expect(isCustomColor('red')).toBe(false);
		expect(isCustomColor('#ggg')).toBe(false);
		expect(isCustomColor(undefined)).toBe(false);
	});

	it('reads pasted canvas data', () => {
		const a = rect('a', 0, 0);
		const b = rect('b', 10, 10, 100, 60, { deleted: true });

		expect(decodeClipboardElements(JSON.stringify({ type: 'loom/canvas', elements: [ a, b, { id: 'x', type: 'bogus' } ] })).map(el => el.id)).toEqual([ 'a' ]);
		expect(decodeClipboardElements(JSON.stringify([ a ])).length).toBe(1);
		expect(decodeClipboardElements(JSON.stringify({ elements: [ a ] }))).toEqual([]);
		expect(decodeClipboardElements('https://example.com')).toEqual([]);
		expect(decodeClipboardElements('{broken')).toEqual([]);
		expect(decodeClipboardElements(JSON.stringify([ { id: 'p', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'data:image/webp;base64,AA', radius: 4 } ]))[0]).toMatchObject({ type: 'image', src: 'data:image/webp;base64,AA', radius: 4 });
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

	it('keeps an arrow attached at the same relative border point when the element moves and resizes', () => {
		const { scene, controller } = setup();
		const arrow = defaultElement(ElementType.Arrow, 'ar', 'j', { x: 0, y: 0, w: 0, h: 0, points: [ [ 0, 0 ], [ 10, 10 ] ], endId: 'b', endFocus: [ 0.25, 0 ], v: 1 });
		scene.load([ rect('b', 200, 100, 100, 60), arrow ]);

		scene.setSelection([ 'b' ]);
		controller.nudge(0, 50);

		let next = scene.get('ar');
		let last = next.points[next.points.length - 1];
		expect(next.x + last[0]).toBeCloseTo(225);
		expect(next.y + last[1]).toBeCloseTo(150);

		scene.upsert([ { ...scene.get('b'), w: 200 } ]);
		controller.updateBindings([ 'b' ]);
		next = scene.get('ar');
		last = next.points[next.points.length - 1];
		expect(next.x + last[0]).toBeCloseTo(250);
	});

	it('snaps attachment points to the border', () => {
		const el = rect('a', 0, 0, 100, 60);

		expect(borderFocus(el, { x: 30, y: -20 })).toEqual([ 0.3, 0 ]);
		expect(borderFocus(el, { x: 90, y: 30 })).toEqual([ 1, 0.5 ]);
		expect(focusPoint(el, [ 1, 0.5 ])).toEqual({ x: 100, y: 30 });
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

describe('hand-drawn style and tools', () => {
	it('gives new elements the style of the last pick and a seed', () => {
		const { scene, controller } = setup();

		controller.setStyle({ color: 'red', roughness: 2, fillStyle: 'cross', strokeStyle: 'dashed' });
		controller.setTool(Tool.Diamond);
		controller.pointerDown({ x: 0, y: 0 });
		controller.pointerMove({ x: 80, y: 60 });
		controller.pointerUp({ x: 80, y: 60 });

		const [ el ] = scene.list();
		expect(el).toMatchObject({ type: 'diamond', color: 'red', roughness: 2, fillStyle: 'cross', strokeStyle: 'dashed' });
		expect(typeof el.seed).toBe('number');
	});

	it('keeps the tool when locked and drops it when not', () => {
		const { controller } = setup();

		controller.keyDown({ key: 'q' });
		expect(controller.locked).toBe(true);
		controller.setTool(Tool.Rect);
		controller.pointerDown({ x: 0, y: 0 });
		controller.pointerMove({ x: 50, y: 50 });
		controller.pointerUp({ x: 50, y: 50 });
		expect(controller.tool).toBe(Tool.Rect);

		controller.keyDown({ key: 'q' });
		controller.pointerDown({ x: 100, y: 100 });
		controller.pointerMove({ x: 150, y: 150 });
		controller.pointerUp({ x: 150, y: 150 });
		expect(controller.tool).toBe(Tool.Select);
	});

	it('erases everything the eraser passes over on release', () => {
		const { scene, controller } = setup();
		scene.load([ rect('a', 0, 0, 100, 100, { fill: 'blue' }), rect('b', 300, 0, 100, 100, { fill: 'blue' }) ]);

		controller.keyDown({ key: 'e' });
		controller.pointerDown({ x: 50, y: 50 });
		controller.pointerMove({ x: 350, y: 50 });
		expect(controller.erasing.size).toBe(2);
		expect(scene.count()).toBe(2);

		controller.pointerUp({ x: 350, y: 50 });
		expect(scene.count()).toBe(0);
		controller.undo();
		expect(scene.count()).toBe(2);
	});

	it('builds elbow and curved routes between two points', () => {
		expect(routePoints([ 0, 0 ], [ 100, 40 ], 'sharp')).toEqual([ [ 0, 0 ], [ 100, 40 ] ]);
		expect(routePoints([ 0, 0 ], [ 100, 40 ], 'elbow')).toEqual([ [ 0, 0 ], [ 50, 0 ], [ 50, 40 ], [ 100, 40 ] ]);
		expect(routePoints([ 0, 0 ], [ 40, 100 ], 'elbow')).toEqual([ [ 0, 0 ], [ 0, 50 ], [ 40, 50 ], [ 40, 100 ] ]);
		expect(routePoints([ 0, 0 ], [ 100, 0 ], 'elbow')).toEqual([ [ 0, 0 ], [ 100, 0 ] ]);
		expect(routePoints([ 0, 0 ], [ 100, 0 ], 'curve').length).toBe(3);
	});

	it('hit tests a curved arrow on the curve, not the chord', () => {
		const arrow = applyRoute(defaultElement(ElementType.Arrow, 'c', 'i', { x: 0, y: 0, points: [ [ 0, 0 ], [ 200, 0 ] ], arrowType: 'curve', v: 1 }));
		const samples = curveSamples(arrow.points.map(p => ({ x: arrow.x + p[0], y: arrow.y + p[1] })));
		const mid = samples[Math.floor(samples.length / 2)];

		expect(hitTest(arrow, mid, 4)).toBe(true);
		expect(hitTest(arrow, { x: 100, y: mid.y + 40 }, 4)).toBe(false);
	});

	it('re-routes the arrow when the routing style changes', () => {
		const { scene, controller } = setup();
		scene.load([ defaultElement(ElementType.Arrow, 'r', 'i', { x: 0, y: 0, points: [ [ 0, 0 ], [ 100, 40 ] ], w: 100, h: 40, v: 1 }) ]);
		scene.setSelection([ 'r' ]);

		controller.setStyle({ arrowType: 'elbow' });
		expect(scene.get('r').points.length).toBe(4);

		controller.setStyle({ arrowType: 'sharp' });
		expect(scene.get('r').points).toEqual([ [ 0, 0 ], [ 100, 40 ] ]);
	});
});

describe('library and insert', () => {
	it('stores a group relative to its corner and cuts links to outside elements', () => {
		const a = rect('a', 500, 300);
		const b = rect('b', 700, 300);
		const arrow = defaultElement(ElementType.Arrow, 'r', 'i', { x: 600, y: 330, w: 100, h: 0, points: [ [ 0, 0 ], [ 100, 0 ] ], startId: 'a', endId: 'outside', v: 1 });
		const items = toLibraryElements([ a, b, arrow ]);

		expect(items.find(el => el.id == 'a')).toMatchObject({ x: 0, y: 0 });
		expect(items.find(el => el.id == 'b')).toMatchObject({ x: 200, y: 0 });
		expect(items.find(el => el.id == 'r')).toMatchObject({ startId: 'a', endId: '' });
	});

	it('inserts copies with new ids around a point and keeps arrow bindings between them', () => {
		const { scene, controller } = setup();
		const items = toLibraryElements([ rect('a', 0, 0, 100, 60), rect('b', 200, 0, 100, 60), defaultElement(ElementType.Arrow, 'r', 'i', { x: 100, y: 30, w: 100, h: 0, points: [ [ 0, 0 ], [ 100, 0 ] ], startId: 'a', endId: 'b', v: 1 }) ]);

		controller.insertElements(items, { x: 1000, y: 500 });

		const list = scene.list();
		expect(list.length).toBe(3);
		expect(list.some(el => el.id == 'a')).toBe(false);

		const arrow = list.find(el => el.type == 'arrow');
		const ids = list.filter(el => el.type == 'rect').map(el => el.id);
		expect([ arrow.startId, arrow.endId ].every(id => ids.includes(id))).toBe(true);

		const bounds = elementBounds(list.find(el => el.type == 'rect'));
		expect(bounds.x).toBeGreaterThan(800);
		controller.undo();
		expect(scene.count()).toBe(0);
	});

	it('copies the style of one element onto another', () => {
		const { scene, controller } = setup();
		scene.load([ rect('a', 0, 0, 100, 60, { color: 'red', roughness: 2, fillStyle: 'cross' }), rect('b', 300, 0) ]);

		scene.setSelection([ 'a' ]);
		controller.copyStyle();
		scene.setSelection([ 'b' ]);
		controller.pasteStyle();

		expect(scene.get('b')).toMatchObject({ color: 'red', roughness: 2, fillStyle: 'cross' });
	});

	it('edits the label of an unfilled shape on double click inside it', () => {
		const edited: string[] = [];
		const { scene, controller } = setup();

		controller.setCallbacks({ onEditText: el => edited.push(el.id) });
		scene.load([ rect('a', 0, 0, 200, 120) ]);
		controller.doubleClick({ x: 100, y: 60 });

		expect(edited).toEqual([ 'a' ]);
		expect(scene.count()).toBe(1);
	});

	it('keeps an elbow arrow anchored at the start point while it is drawn', () => {
		const { scene, controller } = setup();

		controller.setStyle({ arrowType: 'elbow' });
		controller.setTool(Tool.Arrow);
		controller.pointerDown({ x: 400, y: 100 });
		controller.pointerMove({ x: 350, y: 140 });
		controller.pointerMove({ x: 200, y: 260 });
		controller.pointerUp({ x: 200, y: 260 });

		const [ arrow ] = scene.list();
		const pts = arrow.points.map(p => [ Math.round(arrow.x + p[0]), Math.round(arrow.y + p[1]) ]);

		expect(pts[0]).toEqual([ 400, 100 ]);
		expect(pts[pts.length - 1]).toEqual([ 200, 260 ]);
	});
});
