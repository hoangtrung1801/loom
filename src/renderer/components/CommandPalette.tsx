import { useMemo } from 'react';
import { newBoard, newCard, newTask, openApp, openJournal, openNewTab } from '../actions.js';
import { useSync } from '../store/sync.js';
import { useTabs, activeTab } from '../store/tabs.js';
import { useUi, type PanelId } from '../store/ui.js';
import { PANELS, panelsFor } from './panels/registry.js';
import { Icon, type IconName } from './Icon.js';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

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
  const all = useMemo(commands, []);
  const run = (c: Command): void => {
    close();
    c.run();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent aria-label="Command palette" showCloseButton={false} className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Run any action by name.</DialogDescription>
        <Command>
          <CommandInput placeholder="Type a command…" aria-label="Command" />
          <CommandList className="max-h-[50vh] p-1.5">
            <CommandEmpty className="results none py-6 text-muted-foreground">No commands</CommandEmpty>
            {all.map((c) => (
              <CommandItem key={c.id} value={c.label} className="result justify-between" onSelect={() => run(c)}>
                <span className="flex min-w-0 items-center gap-2 font-medium"><Icon name={c.icon} size={14} />{c.label}</span>
                {c.hint && <kbd>{c.hint}</kbd>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
