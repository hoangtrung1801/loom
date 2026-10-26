import { create } from 'zustand';
import type { ChatSummary } from '../../core/chats.js';
import type { CardIndexEntry, WhiteboardSummary } from '../../core/store.js';
import { api, errorMessage } from '../api.js';

export interface TagInfo {
  tag: string;
  count: number;
  color: string;
  collection: string;
  description: string;
}

interface DataState {
  ready: boolean;
  index: CardIndexEntry[];
  boards: WhiteboardSummary[];
  tags: TagInfo[];
  chats: ChatSummary[];
  /** Bumped after every change that other views may need to re-read (they refetch when it moves). */
  version: number;
  error: string | null;
  refresh(): Promise<void>;
  setError(message: string | null): void;
}

let titles = new Map<string, string>();
const titleListeners = new Set<() => void>();

/** Live title of a card, for mentions and tab labels. */
export const titleOf = (id: string): string | undefined => titles.get(id);
export const subscribeTitles = (fn: () => void): (() => void) => {
  titleListeners.add(fn);
  return () => titleListeners.delete(fn);
};

export const useData = create<DataState>((set) => ({
  ready: false,
  index: [],
  boards: [],
  tags: [],
  chats: [],
  version: 0,
  error: null,
  async refresh() {
    try {
      const [index, boards, tags, chats] = await Promise.all([api.cardIndex(), api.listWhiteboards(), api.listTags(), api.listChats()]);
      titles = new Map(index.map((c) => [c.id, c.title]));
      set((s) => ({ index, boards, tags, chats, ready: true, version: s.version + 1 }));
      titleListeners.forEach((fn) => fn());
    } catch (err) {
      set({ error: errorMessage(err), ready: true });
    }
  },
  setError: (error) => set({ error }),
}));

export const refresh = (): Promise<void> => useData.getState().refresh();
export const toast = (message: string): void => useData.getState().setError(message);

/**
 * Runs a mutation and then refreshes shared data. Failures become a toast instead of an unhandled rejection,
 * and the views resync with whatever actually persisted.
 */
export async function mutate<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const result = await fn();
    await refresh();
    return result;
  } catch (err) {
    toast(errorMessage(err));
    await refresh();
    return undefined;
  }
}
