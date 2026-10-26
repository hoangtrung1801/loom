import { useEffect, useRef, useState } from 'react';
import { newBoard, newCard, openApp, openNewTab } from '../actions.js';
import { useData } from '../store/data.js';
import { activeGroup, activeTab, useTabs, type AppId, type Tab } from '../store/tabs.js';
import { useUi } from '../store/ui.js';
import { SyncBadge } from './SyncBadge.js';
import { Icon, KIND_ICON, type IconName } from './Icon.js';
import { menuFor } from './ui/ContextMenu.js';

const APPS: { id: AppId; label: string; icon: IconName }[] = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'journal', label: 'Journal', icon: 'journal' },
  { id: 'whiteboards', label: 'Whiteboards', icon: 'board' },
  { id: 'library', label: 'Card Library', icon: 'library' },
  { id: 'tags', label: 'Tag Database', icon: 'tag' },
  { id: 'tasks', label: 'Tasks', icon: 'task' },
  { id: 'links', label: 'Links', icon: 'link' },
  { id: 'memos', label: 'Memos', icon: 'memo' },
  { id: 'highlights', label: 'Highlights', icon: 'highlight' },
  { id: 'chats', label: 'Chat', icon: 'chat' },
];

export const APP_LABEL: Record<AppId, string> = {
  inbox: 'Inbox', journal: 'Journal', whiteboards: 'Whiteboards', library: 'Card Library', tags: 'Tag Database', highlights: 'Highlights',
  tasks: 'Tasks', links: 'Links', memos: 'Memos', chats: 'Chat', trash: 'Trash', settings: 'Settings',
};
const APP_ICON: Record<AppId, IconName> = {
  inbox: 'inbox', journal: 'journal', whiteboards: 'board', library: 'library', tags: 'tag', highlights: 'highlight', tasks: 'task', links: 'link', memos: 'memo', chats: 'chat', trash: 'trash', settings: 'settings',
};

/** Label and icon for a tab, resolved from live data so renames show immediately. */
export function useTabMeta(): (tab: Tab) => { title: string; icon: IconName } {
  const index = useData((s) => s.index);
  const boards = useData((s) => s.boards);
  const chats = useData((s) => s.chats);
  return (tab) => {
    switch (tab.type) {
      case 'newtab': return { title: 'New tab', icon: 'plus' };
      case 'app': return { title: APP_LABEL[tab.ref as AppId] ?? tab.ref, icon: APP_ICON[tab.ref as AppId] ?? 'card' };
      case 'whiteboard': return { title: boards.find((b) => b.id === tab.ref)?.name || 'Untitled whiteboard', icon: 'board' };
      case 'card': {
        const c = index.find((x) => x.id === tab.ref);
        return { title: c ? c.title || (c.kind === 'journal' ? c.journalDate : c.kind === 'memo' ? 'Memo' : 'Untitled') : 'Card', icon: KIND_ICON[c?.kind ?? 'note'] ?? 'card' };
      }
      case 'tag': return { title: `#${tab.ref}`, icon: 'tag' };
      case 'chat': return { title: chats.find((c) => c.id === tab.ref)?.title || 'Chat', icon: 'chat' };
    }
  };
}

export function LeftSidebar() {
  const inboxCount = useData((s) => s.index.filter((c) => c.inbox).length);
  const hasHighlights = useData((s) => s.index.some((c) => c.kind === 'highlight'));
  const current = useTabs((s) => activeTab(s));
  const setSearch = useUi((s) => s.setSearch);
  const setPalette = useUi((s) => s.setPalette);
  const setResearch = useUi((s) => s.setResearch);
  const mod = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';

  return (
    <aside className="sidebar" aria-label="Sidebar">
      <header className="brand">
        <span className="logo" aria-hidden>◈</span> Loom
      </header>

      <div className="side-actions">
        <button className="research" onClick={() => setResearch(true)}>
          <Icon name="sparkle" /> Research a topic
        </button>
        <div className="side-row">
          <button onClick={() => setSearch(true)} title={`Search everything (${mod} O)`}><Icon name="search" /> Search</button>
          <button onClick={() => setPalette(true)} title={`Commands (${mod} K)`} aria-label="Commands"><Icon name="command" /></button>
          <button onClick={() => void newCard()} title={`New card (${mod} N)`} aria-label="New card"><Icon name="plus" /></button>
        </div>
      </div>

      <nav className="apps" aria-label="Apps">
        {APPS.filter((a) => a.id !== 'highlights' || hasHighlights).map((a) => (
          <button
            key={a.id}
            className={`app-link${current.type === 'app' && current.ref === a.id ? ' active' : ''}`}
            onClick={(e) => openApp(a.id, e.metaKey || e.ctrlKey)}
            onContextMenu={menuFor(() => [{ label: 'Open in new tab', onClick: () => openApp(a.id, true) }])}
          >
            <Icon name={a.icon} />
            <span className="grow">{a.label}</span>
            {a.id === 'inbox' && inboxCount > 0 && <span className="badge" aria-label={`${inboxCount} in inbox`}>{inboxCount}</span>}
          </button>
        ))}
      </nav>

      <TabList />

      <footer className="side-foot">
        <SyncBadge />
        <button className="icon-btn" title="Trash" aria-label="Trash" onClick={() => openApp('trash')}><Icon name="trash" /></button>
        <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => openApp('settings')}><Icon name="settings" /></button>
      </footer>
    </aside>
  );
}

function TabList() {
  const state = useTabs();
  const group = activeGroup(state);
  const meta = useTabMeta();
  const boards = useData((s) => s.boards);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const pinned = group.tabs.filter((t) => t.pinned);
  const loose = pinned.filter((t) => !t.folderId);
  const normal = group.tabs.filter((t) => !t.pinned);

  const tabRow = (tab: Tab) => {
    const m = meta(tab);
    return (
      <li
        key={tab.id}
        className={`tab${tab.id === group.activeTab ? ' active' : ''}${over === tab.id ? ' drop-target' : ''}`}
        draggable
        onDragStart={(e) => {
          setDragging(tab.id);
          e.dataTransfer.setData('application/x-loom-tab', tab.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => (setDragging(null), setOver(null))}
        onDragOver={(e) => {
          if (dragging && dragging !== tab.id) {
            e.preventDefault();
            setOver(tab.id);
          }
        }}
        onDragLeave={() => setOver((o) => (o === tab.id ? null : o))}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData('application/x-loom-tab');
          if (id) state.reorder(id, tab.id);
          setDragging(null);
          setOver(null);
        }}
        onContextMenu={menuFor(() => [
          { label: tab.pinned ? 'Unpin tab' : 'Pin tab', onClick: () => state.pin(tab.id, !tab.pinned) },
          ...(state.groups.length > 1 ? [{ separator: true }, ...state.groups.filter((g) => g.id !== group.id).map((g) => ({ label: `Move to group “${g.name}”`, onClick: () => state.moveTabToGroup(tab.id, g.id) }))] : []),
          ...(tab.pinned && group.folders.length ? [{ separator: true }, ...group.folders.map((f) => ({ label: `Move to folder “${f.name}”`, checked: tab.folderId === f.id, onClick: () => state.moveToFolder(tab.id, f.id) })), ...(tab.folderId ? [{ label: 'Remove from folder', onClick: () => state.moveToFolder(tab.id, null) }] : [])] : []),
          { separator: true },
          { label: 'Close tab', onClick: () => state.close(tab.id) },
          { label: 'Close other tabs', onClick: () => state.closeOthers(tab.id) },
        ])}
        onAuxClick={(e) => e.button === 1 && state.close(tab.id)}
      >
        <button className="tab-main" onClick={() => state.activate(tab.id)} title={m.title}>
          <Icon name={m.icon} />
          <span className="ellipsis">{m.title}</span>
        </button>
        <button className="icon-btn tab-close" aria-label={`Close ${m.title}`} onClick={() => state.close(tab.id)}><Icon name="close" size={13} /></button>
      </li>
    );
  };
  return (
    <section className="tabs-section" aria-label="Tabs">
      <div className="groups" role="tablist" aria-label="Tab groups">
        {state.groups.map((g) =>
          renaming === g.id ? (
            <input key={g.id} className="rename" autoFocus defaultValue={g.name} aria-label="Group name" onBlur={(e) => (state.renameGroup(g.id, e.target.value), setRenaming(null))} onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.target as HTMLInputElement).blur()} />
          ) : (
            <button
              key={g.id}
              role="tab"
              aria-selected={g.id === group.id}
              className={`group${g.id === group.id ? ' active' : ''}`}
              onClick={() => state.switchGroup(g.id)}
              onDoubleClick={() => setRenaming(g.id)}
              onContextMenu={menuFor(() => [
                { label: 'Rename group', onClick: () => setRenaming(g.id) },
                { label: 'Delete group', danger: true, disabled: state.groups.length <= 1, onClick: () => state.deleteGroup(g.id) },
              ])}
            >
              {g.name}
            </button>
          ),
        )}
        <button className="icon-btn" title="New tab group" aria-label="New tab group" onClick={() => state.createGroup()}><Icon name="plus" size={14} /></button>
      </div>

      <ul className="tab-list" aria-label="Open tabs">
        {loose.map(tabRow)}
        {group.folders.map((f) => {
          const inside = pinned.filter((t) => t.folderId === f.id);
          return (
            <li key={f.id} className="folder">
              <div
                className="folder-head"
                onContextMenu={menuFor(() => [
                  { label: 'Rename folder', onClick: () => setRenaming(f.id) },
                  { label: 'Delete folder', danger: true, onClick: () => state.deleteFolder(f.id) },
                ])}
                onDragOver={(e) => dragging && e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData('application/x-loom-tab');
                  if (id) state.moveToFolder(id, f.id);
                  setDragging(null);
                }}
              >
                <button className="tab-main" onClick={() => state.toggleFolder(f.id)} aria-expanded={f.open}>
                  <Icon name={f.open ? 'chevronDown' : 'chevronRight'} size={13} />
                  <Icon name="folder" />
                  {renaming === f.id ? (
                    <input className="rename" autoFocus defaultValue={f.name} aria-label="Folder name" onClick={(e) => e.stopPropagation()} onBlur={(e) => (state.renameFolder(f.id, e.target.value), setRenaming(null))} onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.target as HTMLInputElement).blur()} />
                  ) : (
                    <span className="ellipsis">{f.name}</span>
                  )}
                </button>
              </div>
              {f.open && <ul className="tab-list nested">{inside.map(tabRow)}</ul>}
            </li>
          );
        })}
        {pinned.length > 0 && normal.length > 0 && <li className="tab-sep" aria-hidden />}
        {normal.map(tabRow)}
      </ul>

      <div className="tab-actions">
        <button onClick={openNewTab}><Icon name="plus" size={14} /> New tab</button>
        <button className="icon-btn" title="New folder for pinned tabs" aria-label="New folder" onClick={() => { const id = state.createFolder(); setRenaming(id); }}><Icon name="folder" size={14} /></button>
        <button className="icon-btn" title="New whiteboard" aria-label="New whiteboard" onClick={() => void newBoard()}><Icon name="board" size={14} /></button>
      </div>
    </section>
  );
}


