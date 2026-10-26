import { create } from 'zustand';

export type TabType = 'newtab' | 'app' | 'whiteboard' | 'card' | 'tag' | 'chat';
export type AppId = 'inbox' | 'journal' | 'whiteboards' | 'library' | 'tags' | 'highlights' | 'chats' | 'trash' | 'settings';
export const APP_IDS: readonly AppId[] = ['inbox', 'journal', 'whiteboards', 'library', 'tags', 'highlights', 'chats', 'trash', 'settings'];

export interface Tab {
  id: string;
  type: TabType;
  /** App id, card id, whiteboard id, tag name or chat id. */
  ref: string;
  pinned?: boolean;
  /** Pinned tabs can live inside a folder. */
  folderId?: string;
}
export interface Folder {
  id: string;
  name: string;
  open: boolean;
}
export interface TabGroup {
  id: string;
  name: string;
  tabs: Tab[];
  folders: Folder[];
  activeTab: string;
}

interface TabsState {
  groups: TabGroup[];
  activeGroup: string;
  /** Pending request for the rendered view to focus something inside a tab (e.g. a card on a whiteboard). */
  focus: { tabId: string; target: string } | null;

  open(type: TabType, ref: string, options?: { newTab?: boolean; focus?: string }): void;
  activate(tabId: string): void;
  close(tabId: string): void;
  closeOthers(tabId: string): void;
  pin(tabId: string, pinned: boolean): void;
  moveToFolder(tabId: string, folderId: string | null): void;
  createFolder(name?: string): string;
  renameFolder(folderId: string, name: string): void;
  deleteFolder(folderId: string): void;
  toggleFolder(folderId: string): void;
  createGroup(name?: string): void;
  renameGroup(groupId: string, name: string): void;
  deleteGroup(groupId: string): void;
  switchGroup(groupId: string): void;
  moveTabToGroup(tabId: string, groupId: string): void;
  reorder(tabId: string, beforeTabId: string | null): void;
  clearFocus(): void;
  /** Drops tabs whose card or whiteboard no longer exists. */
  prune(exists: (type: TabType, ref: string) => boolean): void;
}

const KEY = 'loom.tabs.v2';
let counter = 0;
const uid = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const newGroup = (name: string): TabGroup => {
  const tab: Tab = { id: uid('t'), type: 'app', ref: 'library' };
  return { id: uid('g'), name, tabs: [tab], folders: [], activeTab: tab.id };
};

function valid(raw: unknown): { groups: TabGroup[]; activeGroup: string } | null {
  const o = raw as { groups?: TabGroup[]; activeGroup?: string } | null;
  if (!o || !Array.isArray(o.groups) || !o.groups.length) return null;
  const types = ['newtab', 'app', 'whiteboard', 'card', 'tag', 'chat'];
  const groups: TabGroup[] = [];
  for (const g of o.groups) {
    if (!g || typeof g.id !== 'string' || !Array.isArray(g.tabs)) return null;
    const tabs = g.tabs.filter((t) => t && typeof t.id === 'string' && types.includes(t.type) && typeof t.ref === 'string' && (t.type !== 'app' || APP_IDS.includes(t.ref as AppId)));
    const folders = (Array.isArray(g.folders) ? g.folders : []).filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string');
    const fixed = tabs.map((t) => (t.folderId && !folders.some((f) => f.id === t.folderId) ? { ...t, folderId: undefined } : t));
    if (!fixed.length) fixed.push({ id: uid('t'), type: 'newtab', ref: '' });
    groups.push({ id: g.id, name: String(g.name ?? 'Group').slice(0, 40), tabs: fixed, folders, activeTab: fixed.some((t) => t.id === g.activeTab) ? g.activeTab : fixed[0]!.id });
  }
  return { groups, activeGroup: groups.some((g) => g.id === o.activeGroup) ? o.activeGroup! : groups[0]!.id };
}

function load(): { groups: TabGroup[]; activeGroup: string } {
  try {
    const saved = valid(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
    if (saved) return saved;
  } catch {
    /* fall through to a fresh layout */
  }
  const g = newGroup('Main');
  return { groups: [g], activeGroup: g.id };
}

export const useTabs = create<TabsState>((set, get) => {
  const initial = load();

  /** Applies `fn` to the active group. */
  const update = (fn: (g: TabGroup) => TabGroup): void => {
    set((s) => ({ groups: s.groups.map((g) => (g.id === s.activeGroup ? fn(g) : g)) }));
  };

  return {
    ...initial,
    focus: null,

    open(type, ref, options = {}) {
      const g = get().groups.find((x) => x.id === get().activeGroup)!;
      const existing = g.tabs.find((t) => t.type === type && t.ref === ref);
      if (existing) {
        update((grp) => ({ ...grp, activeTab: existing.id }));
        set({ focus: options.focus ? { tabId: existing.id, target: options.focus } : null });
        return;
      }
      const tab: Tab = { id: uid('t'), type, ref };
      const active = g.tabs.find((t) => t.id === g.activeTab);
      update((grp) => {
        // A blank "new tab" is replaced rather than left behind.
        if (!options.newTab && active && !active.pinned && active.type === 'newtab') {
          return { ...grp, tabs: grp.tabs.map((t) => (t.id === active.id ? tab : t)), activeTab: tab.id };
        }
        const at = active ? grp.tabs.findIndex((t) => t.id === active.id) + 1 : grp.tabs.length;
        const tabs = [...grp.tabs];
        tabs.splice(at, 0, tab);
        return { ...grp, tabs, activeTab: tab.id };
      });
      set({ focus: options.focus ? { tabId: tab.id, target: options.focus } : null });
    },

    activate: (tabId) => update((g) => (g.tabs.some((t) => t.id === tabId) ? { ...g, activeTab: tabId } : g)),

    close(tabId) {
      update((g) => {
        const i = g.tabs.findIndex((t) => t.id === tabId);
        if (i < 0) return g;
        const tabs = g.tabs.filter((t) => t.id !== tabId);
        if (!tabs.length) {
          const blank: Tab = { id: uid('t'), type: 'newtab', ref: '' };
          return { ...g, tabs: [blank], activeTab: blank.id };
        }
        const activeTab = g.activeTab === tabId ? (tabs[Math.min(i, tabs.length - 1)]!.id) : g.activeTab;
        return { ...g, tabs, activeTab };
      });
    },

    closeOthers: (tabId) =>
      update((g) => {
        const keep = g.tabs.filter((t) => t.id === tabId || t.pinned);
        return { ...g, tabs: keep, activeTab: tabId };
      }),

    pin: (tabId, pinned) => update((g) => ({ ...g, tabs: g.tabs.map((t) => (t.id === tabId ? { ...t, pinned, folderId: pinned ? t.folderId : undefined } : t)) })),

    moveToFolder: (tabId, folderId) =>
      update((g) => ({ ...g, tabs: g.tabs.map((t) => (t.id === tabId ? { ...t, pinned: folderId ? true : t.pinned, folderId: folderId ?? undefined } : t)) })),

    createFolder(name = 'New folder') {
      const id = uid('f');
      update((g) => ({ ...g, folders: [...g.folders, { id, name, open: true }] }));
      return id;
    },
    renameFolder: (folderId, name) => update((g) => ({ ...g, folders: g.folders.map((f) => (f.id === folderId ? { ...f, name: name.trim().slice(0, 40) || 'Folder' } : f)) })),
    deleteFolder: (folderId) =>
      update((g) => ({ ...g, folders: g.folders.filter((f) => f.id !== folderId), tabs: g.tabs.map((t) => (t.folderId === folderId ? { ...t, folderId: undefined } : t)) })),
    toggleFolder: (folderId) => update((g) => ({ ...g, folders: g.folders.map((f) => (f.id === folderId ? { ...f, open: !f.open } : f)) })),

    createGroup(name = 'New group') {
      const g = newGroup(name);
      g.tabs = [{ id: g.tabs[0]!.id, type: 'newtab', ref: '' }];
      set((s) => ({ groups: [...s.groups, g], activeGroup: g.id }));
    },
    renameGroup: (groupId, name) => set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? { ...g, name: name.trim().slice(0, 40) || 'Group' } : g)) })),
    deleteGroup(groupId) {
      set((s) => {
        if (s.groups.length <= 1) return s;
        const groups = s.groups.filter((g) => g.id !== groupId);
        return { groups, activeGroup: s.activeGroup === groupId ? groups[0]!.id : s.activeGroup };
      });
    },
    switchGroup: (groupId) => set((s) => (s.groups.some((g) => g.id === groupId) ? { activeGroup: groupId } : s)),

    moveTabToGroup(tabId, groupId) {
      set((s) => {
        const from = s.groups.find((g) => g.tabs.some((t) => t.id === tabId));
        if (!from || from.id === groupId) return s;
        const tab = { ...from.tabs.find((t) => t.id === tabId)!, pinned: false, folderId: undefined };
        return {
          groups: s.groups.map((g) => {
            if (g.id === from.id) {
              const tabs = g.tabs.filter((t) => t.id !== tabId);
              if (!tabs.length) tabs.push({ id: uid('t'), type: 'newtab', ref: '' });
              return { ...g, tabs, activeTab: g.activeTab === tabId ? tabs[0]!.id : g.activeTab };
            }
            return g.id === groupId ? { ...g, tabs: [...g.tabs, tab], activeTab: tab.id } : g;
          }),
        };
      });
    },

    reorder(tabId, beforeTabId) {
      update((g) => {
        const moving = g.tabs.find((t) => t.id === tabId);
        if (!moving || tabId === beforeTabId) return g;
        const rest = g.tabs.filter((t) => t.id !== tabId);
        const before = beforeTabId ? rest.findIndex((t) => t.id === beforeTabId) : -1;
        const target = beforeTabId ? rest.find((t) => t.id === beforeTabId) : undefined;
        // Dropping onto a tab adopts its pin state and folder, so drag-and-drop also pins and files tabs.
        const adopted: Tab = target ? { ...moving, pinned: target.pinned, folderId: target.folderId } : moving;
        rest.splice(before < 0 ? rest.length : before, 0, adopted);
        return { ...g, tabs: rest };
      });
    },

    clearFocus: () => set({ focus: null }),

    prune(exists) {
      set((s) => ({
        groups: s.groups.map((g) => {
          const tabs = g.tabs.filter((t) => exists(t.type, t.ref));
          if (tabs.length === g.tabs.length) return g;
          if (!tabs.length) tabs.push({ id: uid('t'), type: 'newtab', ref: '' });
          return { ...g, tabs, activeTab: tabs.some((t) => t.id === g.activeTab) ? g.activeTab : tabs[0]!.id };
        }),
      }));
    },
  };
});

useTabs.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ groups: s.groups, activeGroup: s.activeGroup }));
  } catch {
    /* layout just won't be remembered */
  }
});

export const activeGroup = (s: Pick<TabsState, 'groups' | 'activeGroup'>): TabGroup => s.groups.find((g) => g.id === s.activeGroup) ?? s.groups[0]!;
export const activeTab = (s: Pick<TabsState, 'groups' | 'activeGroup'>): Tab => {
  const g = activeGroup(s);
  return g.tabs.find((t) => t.id === g.activeTab) ?? g.tabs[0]!;
};
