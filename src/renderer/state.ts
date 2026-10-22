import { create } from 'zustand';
import type { BoardData, CardDetail, CardSummary, PlacementPatch, WhiteboardSummary } from '../core/store.js';
import { api, errorMessage } from './api.js';

const SAVE_DELAY_MS = 500;
const BOARD_KEY = 'loom.board';

/** Debounced per-card saves; the UI updates instantly and the write follows. */
const pending = new Map<string, { title?: string; content?: string; timer: number }>();

interface AppState {
  ready: boolean;
  boards: WhiteboardSummary[];
  cards: CardSummary[];
  activeBoardId: string | null;
  board: BoardData | null;
  selection: string[];
  selectedEdge: string | null;
  panel: CardDetail | null;
  error: string | null;

  init(): Promise<void>;
  reload(): Promise<void>;
  setError(message: string | null): void;

  selectBoard(id: string): Promise<void>;
  createBoard(): Promise<void>;
  renameBoard(id: string, name: string): Promise<void>;
  deleteBoard(id: string): Promise<void>;

  createCardAt(x: number, y: number): Promise<void>;
  addExistingCard(cardId: string, x: number, y: number): Promise<void>;
  select(ids: string[], additive?: boolean): void;
  selectEdge(id: string | null): void;
  bringToFront(placementId: string): void;
  moveLocal(patches: PlacementPatch[]): void;
  commitPlacements(ids: string[]): Promise<void>;
  removeSelected(): Promise<void>;

  connect(from: string, to: string): Promise<void>;
  setEdgeLabel(id: string, label: string): Promise<void>;

  editCard(cardId: string, patch: { title?: string; content?: string }): void;
  openCard(id: string): Promise<void>;
  openByTitle(title: string): Promise<void>;
  closePanel(): void;
  trashCard(id: string): Promise<void>;
  addTag(cardId: string, tag: string): Promise<void>;
  removeTag(cardId: string, tag: string): Promise<void>;
}

export const useApp = create<AppState>((set, get) => {
  /** Runs a mutation, surfaces failures as a toast instead of an unhandled rejection. */
  const guard = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      set({ error: errorMessage(err) });
      void get().reload().catch(() => undefined); // resync the view with what actually persisted
    }
  };

  const refreshLists = async (): Promise<void> => {
    const [boards, cards] = await Promise.all([api.listWhiteboards(), api.listCards()]);
    set({ boards, cards });
  };

  const refreshPanel = async (): Promise<void> => {
    const open = get().panel;
    if (!open) return;
    const fresh = await api.getCard(open.id);
    // Keep local title/content while edits are still in flight so typing is never overwritten.
    set({ panel: fresh && pending.has(open.id) ? { ...fresh, title: open.title, content: open.content } : fresh });
  };

  const loadBoard = async (id: string | null): Promise<void> => {
    const board = id ? await api.getWhiteboard(id) : null;
    set({ board, activeBoardId: board ? id : null, selection: [], selectedEdge: null });
  };

  return {
    ready: false,
    boards: [],
    cards: [],
    activeBoardId: null,
    board: null,
    selection: [],
    selectedEdge: null,
    panel: null,
    error: null,

    async init() {
      await guard(async () => {
        await refreshLists();
        const saved = safeGet(BOARD_KEY);
        const boards = get().boards;
        const first = boards.find((b) => b.id === saved) ?? boards[0];
        await loadBoard(first?.id ?? null);
      });
      set({ ready: true });
    },

    async reload() {
      await flushAll();
      await refreshLists();
      const { activeBoardId, boards } = get();
      await loadBoard(boards.some((b) => b.id === activeBoardId) ? activeBoardId : (boards[0]?.id ?? null));
      const open = get().panel;
      if (open) set({ panel: await api.getCard(open.id) });
    },

    setError: (error) => set({ error }),

    async selectBoard(id) {
      await guard(async () => {
        await flushAll();
        await loadBoard(id);
        safeSet(BOARD_KEY, id);
      });
    },
    async createBoard() {
      await guard(async () => {
        const id = await api.createWhiteboard('Untitled whiteboard');
        await refreshLists();
        await get().selectBoard(id);
      });
    },
    async renameBoard(id, name) {
      await guard(async () => {
        await api.renameWhiteboard(id, name.trim() || 'Untitled whiteboard');
        await refreshLists();
        const board = get().board;
        if (board?.whiteboard.id === id) set({ board: { ...board, whiteboard: { ...board.whiteboard, name: name.trim() || 'Untitled whiteboard' } } });
      });
    },
    async deleteBoard(id) {
      await guard(async () => {
        await api.trashWhiteboard(id);
        await refreshLists();
        if (get().activeBoardId === id) await loadBoard(get().boards[0]?.id ?? null);
      });
    },

    async createCardAt(x, y) {
      const boardId = get().activeBoardId;
      if (!boardId) return;
      await guard(async () => {
        const { placementId } = await api.createCardOnWhiteboard(boardId, x, y);
        await loadBoard(boardId);
        set({ selection: [placementId] });
        await refreshLists();
      });
    },
    async addExistingCard(cardId, x, y) {
      const boardId = get().activeBoardId;
      if (!boardId) return;
      await guard(async () => {
        const placementId = await api.addCardToWhiteboard(boardId, cardId, x, y);
        await loadBoard(boardId);
        set({ selection: [placementId] });
        await refreshLists();
        await refreshPanel();
      });
    },

    select(ids, additive = false) {
      const current = get().selection;
      if (!additive) return set({ selection: ids, selectedEdge: null });
      const toggled = ids.every((i) => current.includes(i)) ? current.filter((c) => !ids.includes(c)) : [...new Set([...current, ...ids])];
      set({ selection: toggled, selectedEdge: null });
    },
    selectEdge: (id) => set({ selectedEdge: id, selection: [] }),

    bringToFront(placementId) {
      const board = get().board;
      if (!board) return;
      const top = Math.max(...board.placements.map((p) => p.z));
      const target = board.placements.find((p) => p.id === placementId);
      if (!target || (target.z === top && board.placements.filter((p) => p.z === top).length === 1)) return;
      get().moveLocal([{ id: placementId, z: top + 1 }]);
      void guard(() => api.updatePlacements([{ id: placementId, z: top + 1 }]));
    },

    moveLocal(patches) {
      const board = get().board;
      if (!board) return;
      const byId = new Map(patches.map((p) => [p.id, p]));
      set({ board: { ...board, placements: board.placements.map((p) => (byId.has(p.id) ? { ...p, ...byId.get(p.id) } : p)) } });
    },
    async commitPlacements(ids) {
      const board = get().board;
      if (!board) return;
      const patches = board.placements.filter((p) => ids.includes(p.id)).map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
      await guard(() => api.updatePlacements(patches));
    },
    async removeSelected() {
      const { selection, selectedEdge, activeBoardId } = get();
      if (!activeBoardId) return;
      await guard(async () => {
        if (selectedEdge) await api.deleteEdge(selectedEdge);
        if (selection.length) await api.removePlacements(selection);
        await loadBoard(activeBoardId);
        await refreshLists();
      });
    },

    async connect(from, to) {
      const boardId = get().activeBoardId;
      if (!boardId || from === to) return;
      await guard(async () => {
        await api.createEdge(boardId, from, to);
        await loadBoard(boardId);
      });
    },
    async setEdgeLabel(id, label) {
      const board = get().board;
      if (board) set({ board: { ...board, edges: board.edges.map((e) => (e.id === id ? { ...e, label } : e)) } });
      await guard(() => api.setEdgeLabel(id, label));
    },

    editCard(cardId, patch) {
      const { board, panel } = get();
      if (board) {
        set({ board: { ...board, placements: board.placements.map((p) => (p.cardId === cardId ? { ...p, ...patch } : p)) } });
      }
      if (panel?.id === cardId) set({ panel: { ...panel, ...patch } });
      const entry = pending.get(cardId) ?? { timer: 0 };
      Object.assign(entry, patch);
      window.clearTimeout(entry.timer);
      entry.timer = window.setTimeout(() => {
        void guard(async () => {
          await flushCard(cardId);
          await refreshLists();
          await refreshPanel();
        });
      }, SAVE_DELAY_MS);
      pending.set(cardId, entry);
    },

    async openCard(id) {
      await guard(async () => {
        await flushAll();
        set({ panel: await api.getCard(id) });
      });
    },
    async openByTitle(title) {
      await guard(async () => {
        await flushAll();
        const found = await api.findCardByTitle(title);
        const id = found ?? (await api.createCard({ title }));
        if (!found) await refreshLists();
        set({ panel: await api.getCard(id) });
      });
    },
    closePanel() {
      void flushAll().then(() => set({ panel: null }));
    },
    async trashCard(id) {
      await guard(async () => {
        pending.delete(id);
        await api.trashCard(id);
        if (get().panel?.id === id) set({ panel: null });
        await get().reload();
      });
    },
    async addTag(cardId, tag) {
      await guard(async () => {
        await api.addTag(cardId, tag);
        await Promise.all([refreshPanel(), refreshLists()]);
      });
    },
    async removeTag(cardId, tag) {
      await guard(async () => {
        await api.removeTag(cardId, tag);
        await Promise.all([refreshPanel(), refreshLists()]);
      });
    },
  };
});

async function flushCard(cardId: string): Promise<void> {
  const entry = pending.get(cardId);
  if (!entry) return;
  window.clearTimeout(entry.timer);
  pending.delete(cardId);
  await api.updateCard(cardId, { title: entry.title, content: entry.content });
}

export async function flushAll(): Promise<void> {
  await Promise.all([...pending.keys()].map(flushCard));
}

export function hasPendingSaves(): boolean {
  return pending.size > 0;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable; the app works without remembering the last board */
  }
}
