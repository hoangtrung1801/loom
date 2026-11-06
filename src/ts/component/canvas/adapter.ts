import { I, C, S } from 'Lib';
import { CanvasController, CanvasElement, ELEMENT_PROCESSOR, decodeElement, encodeElement } from 'Lib/canvas';

const FLUSH_DELAY = 120;
const TOMBSTONE_TTL = 60 * 1000;
const BATCH_MIN = 8;
const BATCH_SIZE = 400;
const RESOLVE_ATTEMPTS = 40;
const RESOLVE_DELAY = 100;

/**
 * Bridges the scene and loom-heart: every element lives in its own embed block
 * (processor CanvasElement), so edits to different elements sync and merge independently.
 */
export class CanvasAdapter {

	private blockIds = new Map<string, string>();
	/** Elements whose block has been seen in the store at least once; only those can be removed remotely. */
	private seen = new Set<string>();
	private dirty = new Map<string, CanvasElement>();
	private creating = new Set<string>();
	private timer = 0;
	private tombstones = new Map<string, number>();
	private destroyed = false;

	constructor (private rootId: string, private controller: CanvasController) {};

	private isElementBlock (block: I.Block): boolean {
		return !!block && (block.type == I.BlockType.Embed) && ((block.content as any).processor == ELEMENT_PROCESSOR);
	};

	/**
	 * Every element block of the object. The middleware may nest new blocks below other blocks
	 * (e.g. when many are created in a row), so the whole block map is scanned, not only the root's children.
	 */
	private getBlocks (): I.Block[] {
		return S.Block.getBlocks(this.rootId, it => this.isElementBlock(it));
	};

	/** Reads every element block of the object. Also learns which block holds which element. */
	read (): CanvasElement[] {
		const list: CanvasElement[] = [];

		this.getBlocks().forEach(block => {
			const el = decodeElement((block.content as any).text);

			if (el) {
				this.blockIds.set(el.id, block.id);
				this.seen.add(el.id);
				list.push(el);
			};
		});
		return list;
	};

	/** Signature of everything that can change remotely, used to cheaply detect store updates. */
	signature (): string {
		return this.getBlocks().map(it => `${it.id}${(it.content as any).text}`).join('\n');
	};

	/** Merge what the store has now into the scene (remote changes and our own echoes). */
	pull () {
		const remote = this.read();
		const known = new Set(remote.map(el => el.id));

		this.controller.scene.applyRemote(remote);

		// Blocks deleted remotely (compaction on another client) disappear from the scene too
		this.controller.scene.elements.forEach((el, id) => {
			if (!known.has(id) && !this.dirty.has(id) && !this.creating.has(id) && this.seen.has(id)) {
				this.blockIds.delete(id);
				this.seen.delete(id);
				this.controller.scene.compact([ id ]);
				this.controller.scene.elements.delete(id);
				this.controller.scene.index.delete(id);
			};
		});
	};

	push (elements: CanvasElement[]) {
		elements.forEach(el => this.dirty.set(el.id, el));

		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => this.flush(), FLUSH_DELAY);
	};

	flush () {
		window.clearTimeout(this.timer);

		const list = Array.from(this.dirty.values());
		const created: CanvasElement[] = [];

		this.dirty.clear();

		list.forEach(el => {
			const blockId = this.blockIds.get(el.id);

			if (blockId) {
				const text = encodeElement(el);

				// The middleware does not echo this change back to us, so keep the local store in step
				C.BlockLatexSetText(this.rootId, blockId, text);
				S.Block.updateContent(this.rootId, blockId, { text });
				this.trackTombstone(el);
				return;
			};

			if (this.creating.has(el.id)) {
				// Create is in flight, send the latest state once it returns
				this.dirty.set(el.id, el);
				return;
			};

			if (el.deleted) {
				return;
			};

			created.push(el);
		});

		if (created.length >= BATCH_MIN) {
			for (let i = 0; i < created.length; i += BATCH_SIZE) {
				this.createBatch(created.slice(i, i + BATCH_SIZE));
			};
		} else {
			created.forEach(el => this.createOne(el));
		};
	};

	private scheduleFlush () {
		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => this.flush(), FLUSH_DELAY);
	};

	private createOne (el: CanvasElement) {
		this.creating.add(el.id);
		C.BlockCreate(this.rootId, this.rootId, I.BlockPosition.Inner, {
			type: I.BlockType.Embed,
			content: { text: encodeElement(el), processor: ELEMENT_PROCESSOR },
		}, (message: any) => {
			this.creating.delete(el.id);

			if (this.destroyed) {
				return;
			};

			if (!message.error.code && message.blockId) {
				this.blockIds.set(el.id, message.blockId);
			};

			if (this.dirty.has(el.id)) {
				this.scheduleFlush();
			};
		});
	};

	/**
	 * Many new elements (paste, import, duplicate) are created by a single paste call: one change instead of
	 * one per element, which is orders of magnitude faster in the middleware.
	 */
	private createBatch (list: CanvasElement[]) {
		list.forEach(el => this.creating.add(el.id));

		const blocks = list.map((el, i) => ({
			id: `canvas${i}`,
			type: I.BlockType.Embed,
			childrenIds: [],
			fields: {},
			content: { text: encodeElement(el), processor: ELEMENT_PROCESSOR },
		}));

		C.BlockPaste(this.rootId, '', { from: 0, to: 0 }, [], false, { loom: blocks, text: '', html: '' }, '', (message: any) => {
			if (this.destroyed) {
				return;
			};

			if (message.error.code) {
				// Fall back to one by one
				list.forEach(el => {
					this.creating.delete(el.id);
					this.createOne(el);
				});
				return;
			};

			this.resolveCreated(list, 0);
		});
	};

	/** The pasted blocks get new ids, so learn them from the store (by element id) before allowing edits. */
	private resolveCreated (list: CanvasElement[], attempt: number) {
		this.read();

		const pending = list.filter(el => !this.blockIds.has(el.id));

		list.forEach(el => {
			if (this.blockIds.has(el.id) || (attempt >= RESOLVE_ATTEMPTS)) {
				this.creating.delete(el.id);
			};
		});

		if (pending.length && (attempt < RESOLVE_ATTEMPTS)) {
			window.setTimeout(() => !this.destroyed && this.resolveCreated(pending, attempt + 1), RESOLVE_DELAY);
			return;
		};

		if (list.some(el => this.dirty.has(el.id))) {
			this.scheduleFlush();
		};
	};

	/**
	 * A deleted element is first written as a tombstone so that stale edits from other clients lose.
	 * After a while the block itself is removed to keep the object small.
	 */
	private trackTombstone (el: CanvasElement) {
		if (!el.deleted) {
			this.tombstones.delete(el.id);
			return;
		};

		this.tombstones.set(el.id, Date.now());
		window.setTimeout(() => this.collect(), TOMBSTONE_TTL + 500);
	};

	private collect () {
		if (this.destroyed) {
			return;
		};

		const now = Date.now();
		const ids: string[] = [];
		const blocks: string[] = [];

		this.tombstones.forEach((time, id) => {
			const el = this.controller.scene.get(id);

			if (!el || !el.deleted) {
				this.tombstones.delete(id);
				return;
			};

			if ((now - time) >= TOMBSTONE_TTL) {
				const blockId = this.blockIds.get(id);

				if (blockId) {
					blocks.push(blockId);
				};
				ids.push(id);
				this.tombstones.delete(id);
				this.blockIds.delete(id);
				this.seen.delete(id);
			};
		});

		if (blocks.length) {
			C.BlockListDelete(this.rootId, blocks);
		};
		this.controller.scene.compact(ids);
	};

	destroy () {
		this.flush();
		this.destroyed = true;
		window.clearTimeout(this.timer);
	};

};
