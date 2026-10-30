import { Suspense, lazy } from 'react';
import { activeTab, useTabs, type Tab } from '../store/tabs.js';
import { useTabMeta } from './LeftSidebar.js';
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
import { BlurFade } from '@/components/ui/blur-fade';

const BoardPage = lazy(() => import('./board/BoardPage.js'));

/** Full-height tools (canvas, chat, calendar) fill the tab body directly; document-like pages fade in. */
const fills = (tab: Tab): boolean => tab.type === 'whiteboard' || tab.type === 'chat' || (tab.type === 'app' && (tab.ref === 'journal' || tab.ref === 'chats'));

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

  return (
    <section className="tabview" aria-label={meta.title}>
      <div className="tabbody" key={tab.id}>
        {fills(tab) ? <Page tab={tab} /> : <BlurFade className="flex min-h-full flex-col *:flex-1" duration={0.22} offset={4} blur="4px"><Page tab={tab} /></BlurFade>}
      </div>
    </section>
  );
}
