import { create } from 'zustand';
import type { BoardData, EdgePatch, EdgeView, ObjectInput, PlacementPatch, PlacementView } from '../../../core/store.js';
import { api, errorMessage } from '../../api.js';
import { refresh, toast } from '../../store/data.js';

export type Tool = 'select' | 'text' | 'section' | 'connect' | 'mindmap';

interface Command {
  label: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

interface BoardState {
  id: string | null;
  data: BoardData | null;
  missing: boolean;
  selection: string[];
  edge: string | null;
  tool: Tool;
  /** Object being edited in place (its text, title or card body). */
  editing: string | null;
  /** Live geometry while dragging; committed on release. */
  draft: Record<string, Partial<Pick<PlacementView, 'x' | 'y' | 'w' | 'h'>>>;
  undoStack: Command[];
  redoStack: Command[];

  load(id: string): Promise<void>;
  reload(): Promise<void>;
  select(ids: string[], additive?: boolean): void;
  selectEdge(id: string | null): void;
  setTool(tool: Tool): void;
  setEditing(id: string | null): void;
  setDraft(draft: BoardState['draft']): void;

  patch(patches: PlacementPatch[], label: string): Promise<void>;
  addCard(cardId: string, x: number, y: number): Promise<string | undefined>;
  createCard(x: number, y: number): Promise<{ cardId: string; placementId: string } | undefined>;
  addObject(input: ObjectInput): Promise<string | undefined>;
  remove(ids: string[]): Promise<void>;
  connect(from: string, to: string): Promise<void>;
  editEdge(id: string, patch: EdgePatch): Promise<void>;
  deleteEdge(id: string): Promise<void>;
  moveToBoard(ids: string[], targetId: string): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

const HISTORY = 100;

/** Every placement that moves, goes or is recoloured together with `ids`: section members and mind-map descendants. */
export function withDependents(data: BoardData, ids: string[], options: { members?: boolean } = { members: true }): string[] {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of data.placements) {
      if (out.has(p.id)) continue;
      if ((p.parentId && out.has(p.parentId)) || (options.members && p.sectionId && out.has(p.sectionId))) {
        out.add(p.id);
        grew = true;
      }
    }
  }
  return [...out];
}

export const useBoard = create<BoardState>((set, get) => {
  const guard = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (err) {
      toast(errorMessage(err));
      await get().reload();
      return undefined;
    }
  };
  const record = (cmd: Command): void => set((s) => ({ undoStack: [...s.undoStack, cmd].slice(-HISTORY), redoStack: [] }));
  const changed = async (): Promise<void> => {
    await get().reload();
    void refresh();
  };
  const find = (id: string): PlacementView | undefined => get().data?.placements.find((p) => p.id === id);

  return {
    id: null,
    data: null,
    missing: false,
    selection: [],
    edge: null,
    tool: 'select',
    editing: null,
    draft: {},
    undoStack: [],
    redoStack: [],

    async load(id) {
      if (get().id !== id) set({ id, data: null, missing: false, selection: [], edge: null, tool: 'select', editing: null, draft: {}, undoStack: [], redoStack: [] });
      await get().reload();
    },
    async reload() {
      const id = get().id;
      if (!id) return;
      const data = await api.getWhiteboard(id);
      if (get().id !== id) return;
      set((s) => ({
        data,
        missing: !data,
        // Drop selections that no longer exist (removed on another device or undone).
        selection: data ? s.selection.filter((x) => data.placements.some((p) => p.id === x)) : [],
        edge: data && s.edge && data.edges.some((e) => e.id === s.edge) ? s.edge : null,
      }));
    },
    select: (ids, additive) =>
      set((s) => ({ selection: additive ? [...new Set([...s.selection, ...ids])] : ids, edge: null, editing: ids.length === 1 && ids[0] === s.editing ? s.editing : null })),
    selectEdge: (edge) => set({ edge, selection: [], editing: null }),
    setTool: (tool) => set({ tool }),
    setEditing: (editing) => set({ editing }),
    setDraft: (draft) => set({ draft }),

    async patch(patches, label) {
      const before: PlacementPatch[] = patches.map((p) => {
        const cur = find(p.id);
        const prior: PlacementPatch = { id: p.id };
        if (cur) for (const key of Object.keys(p) as (keyof PlacementPatch)[]) if (key !== 'id') (prior as unknown as Record<string, unknown>)[key] = cur[key as keyof PlacementView];
        return prior;
      });
      await guard(async () => {
        await api.updatePlacements(patches);
        record({ label, undo: async () => { await api.updatePlacements(before); await changed(); }, redo: async () => { await api.updatePlacements(patches); await changed(); } });
      });
      set({ draft: {} });
      await changed();
    },

    async addCard(cardId, x, y) {
      const boardId = get().id;
      if (!boardId) return;
      const id = await guard(async () => {
        const pid = await api.addCardToWhiteboard(boardId, cardId, x, y);
        record({ label: 'Add card', undo: async () => { await api.removePlacements([pid]); await changed(); }, redo: async () => { await api.restorePlacements([pid]); await changed(); } });
        return pid;
      });
      await changed();
      return id;
    },

    async createCard(x, y) {
      const boardId = get().id;
      if (!boardId) return;
      const r = await guard(async () => {
        const made = await api.createCardOnWhiteboard(boardId, x, y, {});
        record({ label: 'New card', undo: async () => { await api.removePlacements([made.placementId]); await changed(); }, redo: async () => { await api.restorePlacements([made.placementId]); await changed(); } });
        return made;
      });
      await changed();
      return r;
    },

    async addObject(input) {
      const boardId = get().id;
      if (!boardId) return;
      const id = await guard(async () => {
        const pid = await api.addObject(boardId, input);
        record({ label: 'Add object', undo: async () => { await api.removePlacements([pid]); await changed(); }, redo: async () => { await api.restorePlacements([pid]); await changed(); } });
        return pid;
      });
      await changed();
      return id;
    },

    async remove(ids) {
      const data = get().data;
      if (!data || !ids.length) return;
      // Sections release their members rather than deleting them; remember that so undo can re-attach.
      const all = withDependents(data, ids, { members: false });
      const released: PlacementPatch[] = data.placements.filter((p) => p.sectionId && all.includes(p.sectionId) && !all.includes(p.id)).map((p) => ({ id: p.id, sectionId: p.sectionId }));
      await guard(async () => {
        await api.removePlacements(ids);
        record({
          label: 'Remove',
          undo: async () => {
            await api.restorePlacements(all);
            if (released.length) await api.updatePlacements(released);
            await changed();
          },
          redo: async () => { await api.removePlacements(ids); await changed(); },
        });
      });
      set({ selection: [], editing: null });
      await changed();
    },

    async connect(from, to) {
      const boardId = get().id;
      if (!boardId || from === to) return;
      await guard(async () => {
        let edgeId = await api.createEdge(boardId, from, to);
        record({
          label: 'Connect',
          undo: async () => { await api.deleteEdge(edgeId); await changed(); },
          redo: async () => { edgeId = await api.createEdge(boardId, from, to); await changed(); },
        });
        set({ edge: edgeId, selection: [] });
      });
      await changed();
    },

    async editEdge(id, patch) {
      const cur = get().data?.edges.find((e) => e.id === id);
      if (!cur) return;
      const prior: EdgePatch = {};
      for (const key of Object.keys(patch) as (keyof EdgePatch)[]) prior[key] = cur[key as keyof EdgeView] as string;
      await guard(async () => {
        await api.updateEdge(id, patch);
        record({ label: 'Edit connection', undo: async () => { await api.updateEdge(id, prior); await changed(); }, redo: async () => { await api.updateEdge(id, patch); await changed(); } });
      });
      await changed();
    },

    async deleteEdge(id) {
      const board = get().id;
      const cur = get().data?.edges.find((e) => e.id === id);
      if (!board || !cur) return;
      await guard(async () => {
        await api.deleteEdge(id);
        let edgeId = id;
        record({
          label: 'Delete connection',
          undo: async () => {
            edgeId = await api.createEdge(board, cur.from, cur.to, { label: cur.label, color: cur.color, style: cur.style, arrow: cur.arrow });
            await changed();
          },
          redo: async () => { await api.deleteEdge(edgeId); await changed(); },
        });
      });
      set({ edge: null });
      await changed();
    },

    async moveToBoard(ids, targetId) {
      const data = get().data;
      if (!data) return;
      await guard(async () => api.moveToWhiteboard(withDependents(data, ids), targetId));
      // Moving between boards is not undoable from here: the history belongs to this board.
      set({ selection: [], undoStack: [], redoStack: [] });
      await changed();
    },

    async undo() {
      const cmd = get().undoStack.at(-1);
      if (!cmd) return;
      set((s) => ({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, cmd] }));
      await guard(cmd.undo);
    },
    async redo() {
      const cmd = get().redoStack.at(-1);
      if (!cmd) return;
      set((s) => ({ redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, cmd] }));
      await guard(cmd.redo);
    },
  };
});
