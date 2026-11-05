import { I, C, S } from 'Lib';
import { CanvasController, CanvasElement, ELEMENT_PROCESSOR, decodeElement, encodeElement } from 'Lib/canvas';

const FLUSH_DELAY = 120;
const TOMBSTONE_TTL = 60 * 1000;

/**
 * Bridges the scene and loom-heart: every element lives in its own embed block
 * (processor CanvasElement), so edits to different elements sync and merge independently.
 */
export class CanvasAdapter {

	private blockIds = new Map<string, string>();
	private dirty = new Map<string, CanvasElement>();
	private creating = new Set<string>();
	private timer = 0;
	private tombstones = new Map<string, number>();
	private destroyed = false;

	constructor (private rootId: string, private controller: CanvasController) {};

	private isElementBlock (block: I.Block): boolean {
		return !!block && (block.type == I.BlockType.Embed) && ((block.content as any).processor == ELEMENT_PROCESSOR);
	};

	/** Reads every element block of the object. Also learns which block holds which element. */
	read (): CanvasElement[] {
		const list: CanvasElement[] = [];

		S.Block.getChildren(this.rootId, this.rootId, it => this.isElementBlock(it)).forEach(block => {
			const el = decodeElement((block.content as any).text);

			if (el) {
				this.blockIds.set(el.id, block.id);
				list.push(el);
			};
		});
		return list;
	};

	/** Signature of everything that can change remotely, used to cheaply detect store updates. */
	signature (): string {
		return S.Block.getChildren(this.rootId, this.rootId, it => this.isElementBlock(it)).map(it => `${it.id}${(it.content as any).text}`).join('\n');
	};

	/** Merge what the store has now into the scene (remote changes and our own echoes). */
	pull () {
		const remote = this.read();
		const known = new Set(remote.map(el => el.id));

		this.controller.scene.applyRemote(remote);

		// Blocks deleted remotely (compaction on another client) disappear from the scene too
		this.controller.scene.elements.forEach((el, id) => {
			if (!known.has(id) && !this.dirty.has(id) && !this.creating.has(id) && this.blockIds.has(id)) {
				this.blockIds.delete(id);
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
		this.dirty.clear();

		list.forEach(el => {
			const blockId = this.blockIds.get(el.id);
			const text = encodeElement(el);

			if (blockId) {
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

			this.creating.add(el.id);
			C.BlockCreate(this.rootId, this.rootId, I.BlockPosition.Inner, {
				type: I.BlockType.Embed,
				content: { text, processor: ELEMENT_PROCESSOR },
			}, (message: any) => {
				this.creating.delete(el.id);

				if (this.destroyed) {
					return;
				};

				if (!message.error.code && message.blockId) {
					this.blockIds.set(el.id, message.blockId);
				};

				if (this.dirty.has(el.id)) {
					window.clearTimeout(this.timer);
					this.timer = window.setTimeout(() => this.flush(), FLUSH_DELAY);
				};
			});
		});
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
