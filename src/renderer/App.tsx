import { useEffect } from 'react';
import { newCard, openCard, openNewTab, pruneTabs } from './actions.js';
import { api } from './api.js';
import { CommandPalette } from './components/CommandPalette.js';
import { GlobalSearch } from './components/GlobalSearch.js';
import { LeftSidebar } from './components/LeftSidebar.js';
import { ClipDialog } from './components/ClipDialog.js';
import { ResearchDialog } from './components/ResearchDialog.js';
import { RightSidebar } from './components/RightSidebar.js';
import { TabView } from './components/TabView.js';
import { ContextMenu } from './components/ui/ContextMenu.js';
import { configureEditor } from './editor/env.js';
import { uploadFile } from './api.js';
import { mutate, refresh, subscribeTitles, titleOf, toast, useData } from './store/data.js';
import { flushAll } from './store/edits.js';
import { useSync } from './store/sync.js';
import { activeGroup, useTabs } from './store/tabs.js';
import { useUi } from './store/ui.js';

export function App() {
  const ready = useData((s) => s.ready);
  const error = useData((s) => s.error);
  const dismiss = useData((s) => s.setError);
  const panel = useUi((s) => s.panel);

  useEffect(() => {
    configureEditor({
      titleOf,
      subscribeTitles,
      openCard: (id) => openCard(id),
      searchCards: async (q) => (q.trim() ? (await api.search(q, 8)).map((h) => ({ id: h.id, title: h.title })) : useData.getState().index.slice(0, 8).map((c) => ({ id: c.id, title: c.title }))),
      createCard: async (title) => (await mutate(() => api.createCard({ title }))) ?? '',
      upload: uploadFile,
      toast,
    });
    void refresh().then(pruneTabs);
    const stopSync = useSync.getState().start();
    const flush = (): void => void flushAll();
    window.addEventListener('pagehide', flush);
    window.addEventListener('blur', flush);
    return () => {
      stopSync();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('blur', flush);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();
      const ui = useUi.getState();
      const tabs = useTabs.getState();
      if (key === 'o') (e.preventDefault(), ui.setSearch(!ui.searchOpen));
      else if (key === 'k' && !e.shiftKey) (e.preventDefault(), ui.setPalette(!ui.paletteOpen));
      else if (key === 'n' && !e.shiftKey) (e.preventDefault(), void newCard());
      else if (key === 't') (e.preventDefault(), openNewTab());
      else if (key === 'w') (e.preventDefault(), tabs.close(activeGroup(tabs).activeTab));
      else if (e.key === 'Tab' || key === ']' || key === '[') {
        const g = activeGroup(tabs);
        const i = g.tabs.findIndex((t) => t.id === g.activeTab);
        const step = e.shiftKey || key === '[' ? -1 : 1;
        e.preventDefault();
        tabs.activate(g.tabs[(i + step + g.tabs.length) % g.tabs.length]!.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => dismiss(null), 7000);
    return () => window.clearTimeout(t);
  }, [error, dismiss]);

  return (
    <div className={`app${panel ? ' with-panel' : ''}`}>
      <LeftSidebar />
      <main className="main">{ready ? <TabView /> : <div className="loading">Loading…</div>}</main>
      <RightSidebar />
      <GlobalSearch />
      <CommandPalette />
      <ResearchDialog />
      <ClipDialog />
      <ContextMenu />
      {error && (
        <div className="toast" role="alert">
          {error}
          <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(null)}>×</button>
        </div>
      )}
    </div>
  );
}

