import { create } from 'zustand';
import type { ContextRef } from '../../core/chats.js';

export type PanelId = 'chat' | 'library' | 'suggestions' | 'journal' | 'highlights' | 'toc' | 'info' | 'location' | 'insight' | 'tasks';

export interface MenuItem {
  label?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  checked?: boolean;
}

interface UiState {
  panel: PanelId | null;
  searchOpen: boolean;
  paletteOpen: boolean;
  /** Context to attach the next time the chat panel opens ("ask AI about this"). */
  chatSeed: ContextRef[] | null;
  /** Chat the panel should show; null means "start a new one". */
  chatId: string | null;
  /** A message the chat panel sends by itself when it opens (Research a topic). */
  chatAuto: string | null;
  menu: { x: number; y: number; items: MenuItem[] } | null;
  researchOpen: boolean;
  clipOpen: boolean;
  /** 'link' saves a bookmark with a preview; 'page' clips the readable text into a card. */
  clipMode: 'link' | 'page';

  setPanel(panel: PanelId | null): void;
  togglePanel(panel: PanelId): void;
  setSearch(open: boolean): void;
  setPalette(open: boolean): void;
  setResearch(open: boolean): void;
  setClip(open: boolean, mode?: 'link' | 'page'): void;
  openChat(seed?: ContextRef[] | null, chatId?: string | null, auto?: string | null): void;
  clearChatAuto(): void;
  showMenu(x: number, y: number, items: MenuItem[]): void;
  hideMenu(): void;
}

const KEY = 'loom.panel';
const PANELS: PanelId[] = ['chat', 'library', 'suggestions', 'journal', 'highlights', 'toc', 'info', 'location', 'insight', 'tasks'];

function loadPanel(): PanelId | null {
  try {
    const v = localStorage.getItem(KEY) as PanelId | null;
    return v && PANELS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export const useUi = create<UiState>((set, get) => ({
  panel: loadPanel(),
  searchOpen: false,
  paletteOpen: false,
  chatSeed: null,
  chatId: null,
  chatAuto: null,
  menu: null,
  researchOpen: false,
  clipOpen: false,
  clipMode: 'link',

  setPanel(panel) {
    set({ panel });
    try {
      if (panel) localStorage.setItem(KEY, panel);
      else localStorage.removeItem(KEY);
    } catch {
      /* the panel just won't be remembered */
    }
  },
  togglePanel: (panel) => get().setPanel(get().panel === panel ? null : panel),
  setSearch: (searchOpen) => set({ searchOpen, paletteOpen: false }),
  setPalette: (paletteOpen) => set({ paletteOpen, searchOpen: false }),
  setResearch: (researchOpen) => set({ researchOpen }),
  setClip: (clipOpen, mode) => set((s) => ({ clipOpen, clipMode: mode ?? s.clipMode })),
  openChat(seed = null, chatId = null, auto = null) {
    set({ chatSeed: seed, chatId, chatAuto: auto });
    get().setPanel('chat');
  },
  clearChatAuto: () => set({ chatAuto: null }),
  showMenu: (x, y, items) => set({ menu: { x, y, items } }),
  hideMenu: () => set({ menu: null }),
}));
