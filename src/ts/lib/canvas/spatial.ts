import { Rect } from './types';

const CELL = 512;

/**
 * Uniform grid spatial index. Cheap to update while dragging and good enough for
 * culling, marquee selection and hit candidates with thousands of elements.
 */
export class SpatialIndex {

	private cells = new Map<string, Set<string>>();
	private rects = new Map<string, Rect>();

	private keysOf (r: Rect): string[] {
		const x0 = Math.floor(r.x / CELL);
		const x1 = Math.floor((r.x + r.w) / CELL);
		const y0 = Math.floor(r.y / CELL);
		const y1 = Math.floor((r.y + r.h) / CELL);
		const keys: string[] = [];

		for (let x = x0; x <= x1; x++) {
			for (let y = y0; y <= y1; y++) {
				keys.push(`${x}:${y}`);
			};
		};
		return keys;
	};

	set (id: string, rect: Rect) {
		this.delete(id);
		this.rects.set(id, rect);

		this.keysOf(rect).forEach(key => {
			let cell = this.cells.get(key);
			if (!cell) {
				cell = new Set();
				this.cells.set(key, cell);
			};
			cell.add(id);
		});
	};

	delete (id: string) {
		const rect = this.rects.get(id);
		if (!rect) {
			return;
		};

		this.keysOf(rect).forEach(key => {
			const cell = this.cells.get(key);
			if (cell) {
				cell.delete(id);
				if (!cell.size) {
					this.cells.delete(key);
				};
			};
		});
		this.rects.delete(id);
	};

	clear () {
		this.cells.clear();
		this.rects.clear();
	};

	query (area: Rect): string[] {
		const found = new Set<string>();

		this.keysOf(area).forEach(key => {
			this.cells.get(key)?.forEach(id => {
				const r = this.rects.get(id);
				if (r && (r.x <= (area.x + area.w)) && ((r.x + r.w) >= area.x) && (r.y <= (area.y + area.h)) && ((r.y + r.h) >= area.y)) {
					found.add(id);
				};
			});
		});
		return Array.from(found);
	};

	get size (): number {
		return this.rects.size;
	};

};
