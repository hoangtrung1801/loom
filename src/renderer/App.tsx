import { useEffect } from 'react';
import { newCard, newTask, openApp, openCard, openNewTab, pruneTabs } from './actions.js';
import { api, onEvent } from './api.js';
import { CommandPalette } from './components/CommandPalette.js';
import { GlobalSearch } from './components/GlobalSearch.js';
import { LeftSidebar } from './components/LeftSidebar.js';
import { ClipDialog } from './components/ClipDialog.js';
import { ResearchDialog } from './components/ResearchDialog.js';
import { RightSidebar } from './components/RightSidebar.js';
import { TabView } from './components/TabView.js';
import { TabStrip } from './components/Tabs.js';
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
    const run = (command: string): void => {
      const ui = useUi.getState();
      const tabs = useTabs.getState();
      if (command === 'search') ui.setSearch(!ui.searchOpen);
      else if (command === 'palette') ui.setPalette(!ui.paletteOpen);
      else if (command === 'new-card') void newCard();
      else if (command === 'new-tab') openNewTab();
      else if (command === 'close-tab') tabs.close(activeGroup(tabs).activeTab);
      else if (command === 'clip') ui.setClip(true, 'page');
      else if (command === 'save-link') ui.setClip(true, 'link');
      else if (command === 'new-task') void newTask();
      else if (command === 'sync') void useSync.getState().sync();
      else if (command === 'settings') openApp('settings');
    };
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();
      const command = key === 'o' ? 'search' : key === 'k' && !e.shiftKey ? 'palette' : key === 'n' && !e.shiftKey ? 'new-card' : key === 't' ? 'new-tab' : key === 'w' ? 'close-tab' : '';
      if (command) {
        e.preventDefault();
        return run(command);
      }
      if (e.key === 'Tab' || key === ']' || key === '[') {
        const tabs = useTabs.getState();
        const g = activeGroup(tabs);
        const i = g.tabs.findIndex((t) => t.id === g.activeTab);
        const step = e.shiftKey || key === '[' ? -1 : 1;
        e.preventDefault();
        tabs.activate(g.tabs[(i + step + g.tabs.length) % g.tabs.length]!.id);
      }
    };
    window.addEventListener('keydown', onKey);
    // In Electron the application menu reports the commands it owns (macOS binds these keys itself).
    const stopMenu = onEvent('command', (payload) => typeof payload === 'string' && run(payload));
    return () => {
      window.removeEventListener('keydown', onKey);
      stopMenu();
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => dismiss(null), 7000);
    return () => window.clearTimeout(t);
  }, [error, dismiss]);

  return (
    <div className={`app${panel ? ' with-panel' : ''}`}>
      <LeftSidebar />
      <main className="main"><TabStrip />{ready ? <TabView /> : <div className="loading">Loading…</div>}</main>
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

