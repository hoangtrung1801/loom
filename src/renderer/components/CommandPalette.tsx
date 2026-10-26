import { useEffect, useMemo, useRef, useState } from 'react';
import { newBoard, newCard, newTask, openApp, openJournal, openNewTab } from '../actions.js';
import { useSync } from '../store/sync.js';
import { useTabs, activeTab } from '../store/tabs.js';
import { useUi, type PanelId } from '../store/ui.js';
import { PANELS, panelsFor } from './panels/registry.js';
import { Icon, type IconName } from './Icon.js';

interface Command {
  id: string;
  label: string;
  icon: IconName;
  hint?: string;
  run(): void;
}

function commands(): Command[] {
  const ui = useUi.getState();
  const tabs = useTabs.getState();
  const tab = activeTab(tabs);
  const list: Command[] = [
    { id: 'new-card', label: 'New card', icon: 'card', hint: '⌘N', run: () => void newCard() },
    { id: 'new-board', label: 'New whiteboard', icon: 'board', run: () => void newBoard() },
    { id: 'new-tab', label: 'New tab', icon: 'plus', hint: '⌘T', run: openNewTab },
    { id: 'close-tab', label: 'Close tab', icon: 'close', hint: '⌘W', run: () => tabs.close(tab.id) },
    { id: 'journal', label: "Open today's journal", icon: 'journal', run: () => void openJournal() },
    { id: 'search', label: 'Search everything', icon: 'search', hint: '⌘O', run: () => ui.setSearch(true) },
    { id: 'research', label: 'Research a topic', icon: 'sparkle', run: () => ui.setResearch(true) },
    { id: 'new-task', label: 'New task', icon: 'task', run: () => void newTask() },
    { id: 'new-memo', label: 'New memo', icon: 'memo', run: () => openApp('memos') },
    { id: 'save-link', label: 'Save a link', icon: 'link', run: () => ui.setClip(true, 'link') },
    { id: 'clip', label: 'Clip a web page', icon: 'globe', run: () => ui.setClip(true, 'page') },
    { id: 'sync', label: 'Sync now', icon: 'sync', run: () => void useSync.getState().sync() },
    { id: 'pin', label: tab.pinned ? 'Unpin tab' : 'Pin tab', icon: 'pin', run: () => tabs.pin(tab.id, !tab.pinned) },
    { id: 'settings', label: 'Open settings', icon: 'settings', run: () => openApp('settings') },
    { id: 'trash', label: 'Open trash', icon: 'trash', run: () => openApp('trash') },
    ...(['inbox', 'journal', 'whiteboards', 'library', 'tags', 'highlights', 'tasks', 'links', 'memos', 'chats'] as const).map((a) => ({
      id: `app-${a}`, label: `Go to ${a === 'tags' ? 'Tag Database' : a === 'library' ? 'Card Library' : a[0]!.toUpperCase() + a.slice(1)}`, icon: 'list' as IconName, run: () => openApp(a),
    })),
    ...panelsFor(tab).map((p: PanelId) => ({ id: `panel-${p}`, label: `Toggle ${PANELS[p].label} panel`, icon: PANELS[p].icon, run: () => ui.togglePanel(p) })),
  ];
  return list;
}

/** Cmd+K: every action by name. */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  if (!open) return null;
  return <Palette close={() => setOpen(false)} />;
}

function Palette({ close }: { close(): void }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const all = useMemo(commands, []);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((c) => words.every((w) => c.label.toLowerCase().includes(w)));
  }, [all, query]);
  useEffect(() => setCursor(0), [query]);

  const run = (c: Command | undefined): void => {
    if (!c) return;
    close();
    c.run();
  };
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(shown.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(shown[cursor]); }
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog palette" role="dialog" aria-label="Command palette" onKeyDown={onKey}>
        <div className="search-input"><Icon name="command" /><input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a command…" aria-label="Command" /></div>
        <ul className="results" role="listbox">
          {shown.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === cursor}>
              <button className={`result${i === cursor ? ' selected' : ''}`} onMouseMove={() => setCursor(i)} onClick={() => run(c)}>
                <span className="title"><Icon name={c.icon} size={14} />{c.label}</span>
                {c.hint && <kbd>{c.hint}</kbd>}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="none">No commands</li>}
        </ul>
      </div>
    </div>
  );
}
