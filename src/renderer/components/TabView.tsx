import { Suspense, lazy } from 'react';
import { activeTab, useTabs, type Tab } from '../store/tabs.js';
import { useUi } from '../store/ui.js';
import { Icon } from './Icon.js';
import { useTabMeta } from './LeftSidebar.js';
import { PANELS, panelsFor } from './panels/registry.js';
import { CardLibrary } from './pages/CardLibrary.js';
import { CardPage } from './pages/CardPage.js';
import { ChatsApp } from './pages/ChatsApp.js';
import { HighlightsApp } from './pages/HighlightsApp.js';
import { Inbox } from './pages/Inbox.js';
import { JournalApp } from './pages/JournalApp.js';
import { LinksApp } from './pages/LinksApp.js';
import { MemosApp } from './pages/MemosApp.js';
import { NewTab } from './pages/NewTab.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { TasksApp } from './pages/TasksApp.js';
import { TagDatabase } from './pages/TagDatabase.js';
import { TagPage } from './pages/TagPage.js';
import { TrashPage } from './pages/TrashPage.js';
import { WhiteboardsApp } from './pages/WhiteboardsApp.js';

const BoardPage = lazy(() => import('./board/BoardPage.js'));

function Page({ tab }: { tab: Tab }) {
  switch (tab.type) {
    case 'newtab': return <NewTab />;
    case 'card': return <CardPage id={tab.ref} />;
    case 'whiteboard': return <Suspense fallback={<div className="loading">Loading…</div>}><BoardPage id={tab.ref} tabId={tab.id} /></Suspense>;
    case 'tag': return <TagPage tag={tab.ref} />;
    case 'chat': return <ChatsApp openId={tab.ref} />;
    case 'app':
      switch (tab.ref) {
        case 'inbox': return <Inbox />;
        case 'journal': return <JournalApp />;
        case 'whiteboards': return <WhiteboardsApp />;
        case 'library': return <CardLibrary />;
        case 'tags': return <TagDatabase />;
        case 'highlights': return <HighlightsApp />;
        case 'tasks': return <TasksApp />;
        case 'links': return <LinksApp />;
        case 'memos': return <MemosApp />;
        case 'chats': return <ChatsApp />;
        case 'trash': return <TrashPage />;
        case 'settings': return <SettingsPage />;
      }
  }
  return <div className="loading">Nothing here.</div>;
}

export function TabView() {
  const tab = useTabs((s) => activeTab(s));
  const meta = useTabMeta()(tab);
  const panel = useUi((s) => s.panel);
  const toggle = useUi((s) => s.togglePanel);
  const available = panelsFor(tab);

  return (
    <section className="tabview" aria-label={meta.title}>
      <header className="tabhead">
        <Icon name={meta.icon} />
        <h1 className="ellipsis grow">{meta.title}</h1>
        <div className="panel-buttons" role="toolbar" aria-label="Side panels">
          {available.map((id) => (
            <button
              key={id}
              className={`icon-btn${panel === id ? ' on' : ''}`}
              aria-pressed={panel === id}
              title={PANELS[id].label}
              aria-label={PANELS[id].label}
              onClick={() => toggle(id)}
            >
              <Icon name={PANELS[id].icon} />
            </button>
          ))}
        </div>
      </header>
      <div className="tabbody" key={tab.id}>
        <Page tab={tab} />
      </div>
    </section>
  );
}
