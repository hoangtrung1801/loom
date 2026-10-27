import { newCard, openApp } from '../actions.js';
import { useData } from '../store/data.js';
import { activeTab, useTabs, type AppId, type Tab } from '../store/tabs.js';
import { useUi } from '../store/ui.js';
import { SyncBadge } from './SyncBadge.js';
import { Icon, KIND_ICON, type IconName } from './Icon.js';
import { menuFor } from './ui/ContextMenu.js';
import { PinnedTabs } from './Tabs.js';
import logoUrl from '../../../assets/brand/loom-mark.svg';

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
        <img className="logo" src={logoUrl} alt="" />
        <span className="grow">Loom</span>
        <button className="icon-btn" onClick={() => setPalette(true)} title={`Commands (${mod} K)`} aria-label="Commands"><Icon name="command" /></button>
      </header>

      <div className="side-actions">
        <button className="search-trigger" onClick={() => setSearch(true)} title={`Search everything (${mod} O)`}>
          <Icon name="search" /> <span className="grow">Search</span> <kbd>{mod} O</kbd>
        </button>
        <div className="side-row">
          <button className="new-card" onClick={() => void newCard()} title={`New card (${mod} N)`} aria-label="New card"><Icon name="plus" /> New card</button>
          <button className="research" onClick={() => setResearch(true)} title="Research a topic" aria-label="Research a topic"><Icon name="sparkle" /></button>
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

      <PinnedTabs />

      <footer className="side-foot">
        <SyncBadge />
        <button className="icon-btn" title="Trash" aria-label="Trash" onClick={() => openApp('trash')}><Icon name="trash" /></button>
        <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => openApp('settings')}><Icon name="settings" /></button>
      </footer>
    </aside>
  );
}
