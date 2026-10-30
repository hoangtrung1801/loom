import { useState } from 'react';
import { create } from 'zustand';
import { openNewTab } from '../actions.js';
import { activeGroup, activeTab, useTabs, type Tab } from '../store/tabs.js';
import { useUi } from '../store/ui.js';
import { Icon } from './Icon.js';
import { useTabMeta } from './LeftSidebar.js';
import { PANELS, panelsFor } from './panels/registry.js';
import { menuFor } from './ui/ContextMenu.js';
import { Button } from '@/components/ui/button';

const TAB_MIME = 'application/x-loom-tab';

type Drag = {
  dragging: string | null;
  over: string | null;
  setDragging(id: string | null): void;
  setOver(next: string | null | ((cur: string | null) => string | null)): void;
};
/** Drag state shared by the tab strip and the pinned list, so a tab can be dragged from one to the other. */
const useTabDrag = create<Drag>((set) => ({
  dragging: null,
  over: null,
  setDragging: (dragging) => set({ dragging }),
  setOver: (next) => set((s) => ({ over: typeof next === 'function' ? next(s.over) : next })),
}));

function TabItem({ tab, drag }: { tab: Tab; drag: Drag }) {
  const state = useTabs();
  const group = activeGroup(state);
  const m = useTabMeta()(tab);
  const { dragging, setDragging, over, setOver } = drag;
  return (
    <li
      className={`tab${tab.id === group.activeTab ? ' active' : ''}${over === tab.id ? ' drop-target' : ''}`}
      draggable
      onDragStart={(e) => {
        setDragging(tab.id);
        e.dataTransfer.setData(TAB_MIME, tab.id);
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
        const id = e.dataTransfer.getData(TAB_MIME);
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
        <Icon name={m.icon} size={15} />
        <span className="ellipsis">{m.title}</span>
      </button>
      <Button variant="ghost" size="icon" className="tab-close size-[22px]" aria-label={`Close ${m.title}`} onClick={() => state.close(tab.id)}><Icon name="close" size={12} /></Button>
    </li>
  );
}

/** The strip above the page: tab groups, open (unpinned) tabs, and the side-panel buttons. */
export function TabStrip() {
  const state = useTabs();
  const group = activeGroup(state);
  const tab = useTabs((s) => activeTab(s));
  const panel = useUi((s) => s.panel);
  const toggle = useUi((s) => s.togglePanel);
  const drag = useTabDrag();
  const [renaming, setRenaming] = useState<string | null>(null);
  const normal = group.tabs.filter((t) => !t.pinned);

  return (
    <header className="tabstrip">
      {state.groups.length > 1 && (
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
        </div>
      )}
      <ul className="tab-list" aria-label="Open tabs">
        {normal.map((t) => <TabItem key={t.id} tab={t} drag={drag} />)}
        <li className="tab-add">
          <Button variant="ghost" size="icon" title="New tab" aria-label="New tab" onClick={openNewTab}><Icon name="plus" /></Button>
        </li>
      </ul>
      <Button variant="ghost" size="icon" title="New tab group" aria-label="New tab group" onClick={() => state.createGroup()}><Icon name="layers" /></Button>
      <div className="panel-buttons" role="toolbar" aria-label="Side panels">
        {panelsFor(tab).map((id) => (
          <Button
            key={id}
            variant="ghost"
            size="icon"
            className={panel === id ? 'bg-brand-soft text-brand-text hover:bg-brand-soft hover:text-brand-text' : ''}
            aria-pressed={panel === id}
            title={PANELS[id].label}
            aria-label={PANELS[id].label}
            onClick={() => toggle(id)}
          >
            <Icon name={PANELS[id].icon} />
          </Button>
        ))}
      </div>
    </header>
  );
}

/** Pinned tabs and their folders live in the sidebar, like bookmarks that stay open. */
export function PinnedTabs() {
  const state = useTabs();
  const group = activeGroup(state);
  const drag = useTabDrag();
  const [renaming, setRenaming] = useState<string | null>(null);
  const pinned = group.tabs.filter((t) => t.pinned);
  const loose = pinned.filter((t) => !t.folderId);

  return (
    <section className="pinned" aria-label="Pinned tabs">
      <div className="side-h">
        <span className="grow">Pinned</span>
        <Button variant="ghost" size="icon" title="New folder for pinned tabs" aria-label="New folder" onClick={() => { const id = state.createFolder(); setRenaming(id); }}><Icon name="folder" size={14} /></Button>
      </div>
      <ul className="tab-list" aria-label="Pinned tabs">
        {loose.map((t) => <TabItem key={t.id} tab={t} drag={drag} />)}
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
                onDragOver={(e) => drag.dragging && e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData(TAB_MIME);
                  if (id) state.moveToFolder(id, f.id);
                  drag.setDragging(null);
                }}
              >
                <button className="tab-main" onClick={() => state.toggleFolder(f.id)} aria-expanded={f.open}>
                  <Icon name={f.open ? 'chevronDown' : 'chevronRight'} size={13} />
                  <Icon name="folder" size={15} />
                  {renaming === f.id ? (
                    <input className="rename" autoFocus defaultValue={f.name} aria-label="Folder name" onClick={(e) => e.stopPropagation()} onBlur={(e) => (state.renameFolder(f.id, e.target.value), setRenaming(null))} onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.target as HTMLInputElement).blur()} />
                  ) : (
                    <span className="ellipsis">{f.name}</span>
                  )}
                </button>
              </div>
              {f.open && <ul className="tab-list nested">{inside.map((t) => <TabItem key={t.id} tab={t} drag={drag} />)}</ul>}
            </li>
          );
        })}
        {pinned.length === 0 && group.folders.length === 0 && <li className="pinned-empty">Right-click a tab to pin it here.</li>}
      </ul>
    </section>
  );
}
