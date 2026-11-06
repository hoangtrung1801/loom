import { CanvasElement } from './types';

export type Snapshot = Map<string, CanvasElement | null>;

export interface HistoryEntry {
	before: Snapshot;
	after: Snapshot;
};

const LIMIT = 200;

/** Local undo and redo. Other users' changes are never part of this stack. */
export class History {

	private undoStack: HistoryEntry[] = [];
	private redoStack: HistoryEntry[] = [];

	record (before: Snapshot, after: Snapshot) {
		if (!before.size && !after.size) {
			return;
		};

		this.undoStack.push({ before, after });
		this.redoStack = [];

		if (this.undoStack.length > LIMIT) {
			this.undoStack.shift();
		};
	};

	undo (): Snapshot | null {
		const entry = this.undoStack.pop();
		if (!entry) {
			return null;
		};

		this.redoStack.push(entry);
		return entry.before;
	};

	redo (): Snapshot | null {
		const entry = this.redoStack.pop();
		if (!entry) {
			return null;
		};

		this.undoStack.push(entry);
		return entry.after;
	};

	canUndo (): boolean {
		return !!this.undoStack.length;
	};

	canRedo (): boolean {
		return !!this.redoStack.length;
	};

	clear () {
		this.undoStack = [];
		this.redoStack = [];
	};

};
