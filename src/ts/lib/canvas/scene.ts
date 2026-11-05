import { CanvasElement, Rect, SceneChange } from './types';
import { elementBounds, expandRect } from './geometry';
import { SpatialIndex } from './spatial';
import { between, compareZ } from './order';

type Listener = (change: SceneChange) => void;

/**
 * Remote wins when its version is higher; equal versions are decided by the lower nonce,
 * so every client converges on the same element regardless of delivery order.
 */
export const shouldApplyRemote = (local: CanvasElement | undefined, remote: CanvasElement): boolean => {
	if (!local) {
		return true;
	};
	if (remote.v != local.v) {
		return remote.v > local.v;
	};
	return remote.nonce < local.nonce;
};

export const newNonce = (): number => Math.floor(Math.random() * 0x7fffffff);

export class Scene {

	elements = new Map<string, CanvasElement>();
	index = new SpatialIndex();
	selection = new Set<string>();
	private listeners = new Set<Listener>();
	private sortedCache: CanvasElement[] | null = null;

	subscribe (fn: Listener): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	};

	private emit (ids: string[], reason: SceneChange['reason']) {
		this.sortedCache = null;
		this.listeners.forEach(fn => fn({ ids, reason }));
	};

	private reindex (el: CanvasElement) {
		if (el.deleted) {
			this.index.delete(el.id);
		} else {
			this.index.set(el.id, expandRect(elementBounds(el), (el.strokeWidth || 2) + 4));
		};
	};

	get (id: string): CanvasElement | undefined {
		return this.elements.get(id);
	};

	/** Live (not deleted) elements ordered by z-index. */
	list (): CanvasElement[] {
		if (!this.sortedCache) {
			this.sortedCache = Array.from(this.elements.values()).filter(el => !el.deleted).sort(compareZ);
		};
		return this.sortedCache;
	};

	count (): number {
		return this.list().length;
	};

	load (elements: CanvasElement[]) {
		this.elements.clear();
		this.index.clear();
		elements.forEach(el => {
			this.elements.set(el.id, el);
			this.reindex(el);
		});
		Array.from(this.selection).forEach(id => !this.elements.get(id) && this.selection.delete(id));
		this.emit(elements.map(el => el.id), 'load');
	};

	/** Local change: bumps the version so it wins over what other clients have. */
	upsert (list: CanvasElement[]): CanvasElement[] {
		const result = list.map(el => {
			const prev = this.elements.get(el.id);
			const next = { ...el, v: (prev ? prev.v : 0) + 1, nonce: newNonce() };

			this.elements.set(next.id, next);
			this.reindex(next);
			return next;
		});

		this.emit(result.map(el => el.id), 'local');
		return result;
	};

	/** Tombstone instead of removal, so a late remote edit cannot silently resurrect it. */
	remove (ids: string[]): CanvasElement[] {
		const list = ids.map(id => this.elements.get(id)).filter(el => el && !el.deleted).map(el => ({ ...el, deleted: true }));

		ids.forEach(id => this.selection.delete(id));
		return this.upsert(list);
	};

	/** Remote change. Returns ids that were actually applied. */
	applyRemote (list: CanvasElement[]): string[] {
		const applied: string[] = [];

		list.forEach(el => {
			if (!shouldApplyRemote(this.elements.get(el.id), el)) {
				return;
			};

			this.elements.set(el.id, el);
			this.reindex(el);
			if (el.deleted) {
				this.selection.delete(el.id);
			};
			applied.push(el.id);
		});

		if (applied.length) {
			this.emit(applied, 'remote');
		};
		return applied;
	};

	/** Drops tombstones that were already persisted, to keep the scene small. */
	compact (ids: string[]) {
		ids.forEach(id => {
			if (this.elements.get(id)?.deleted) {
				this.elements.delete(id);
				this.index.delete(id);
			};
		});
	};

	query (area: Rect): CanvasElement[] {
		return this.index.query(area).map(id => this.elements.get(id)).filter(el => el && !el.deleted).sort(compareZ);
	};

	topZ (): string | null {
		const list = this.list();
		return list.length ? list[list.length - 1].z : null;
	};

	bottomZ (): string | null {
		const list = this.list();
		return list.length ? list[0].z : null;
	};

	nextZ (): string {
		return between(this.topZ(), null);
	};

	/** New z-index that places an element right above (or below) the given neighbour. */
	zAround (id: string, above: boolean): string | null {
		const list = this.list();
		const i = list.findIndex(el => el.id == id);

		if (i < 0) {
			return null;
		};

		if (above) {
			return (i >= (list.length - 1)) ? null : between(list[i + 1].z, list[i + 2]?.z || null);
		};
		return (i <= 0) ? null : between(list[i - 2]?.z || null, list[i - 1].z);
	};

	setSelection (ids: string[]) {
		this.selection = new Set(ids.filter(id => this.elements.get(id) && !this.elements.get(id).deleted));
		this.emit([], 'local');
	};

	selected (): CanvasElement[] {
		return Array.from(this.selection).map(id => this.elements.get(id)).filter(el => el && !el.deleted);
	};

};
