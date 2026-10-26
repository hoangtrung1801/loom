import { useState } from 'react';
import type { WhiteboardSummary } from '../../../core/store.js';
import { newBoard, openBoard, trashBoard } from '../../actions.js';
import { useData } from '../../store/data.js';
import { Icon } from '../Icon.js';
import { menuFor } from '../ui/ContextMenu.js';
import { Empty, timeAgo } from '../ui/bits.js';

/** All whiteboards as a tree: sub-whiteboards nest under the board that holds their shortcut. */
export function WhiteboardsApp() {
  const boards = useData((s) => s.boards);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const children = (parent: string): WhiteboardSummary[] => boards.filter((b) => b.parentId === parent);
  const roots = boards.filter((b) => !b.parentId || !boards.some((p) => p.id === b.parentId));

  const row = (b: WhiteboardSummary, depth: number): React.ReactNode => {
    const kids = children(b.id);
    const expanded = open.has(b.id);
    return (
      <li key={b.id}>
        <div className="tree-row" style={{ paddingLeft: 8 + depth * 18 }} onContextMenu={menuFor(() => [
          { label: 'Open', onClick: () => openBoard(b.id) },
          { label: 'Open in new tab', onClick: () => openBoard(b.id, undefined, true) },
          { label: 'New sub-whiteboard', onClick: () => void newBoard('Untitled whiteboard', b.id) },
          { separator: true },
          { label: 'Move to trash', danger: true, onClick: () => void trashBoard(b.id) },
        ])}>
          <button className="icon-btn" aria-label={expanded ? 'Collapse' : 'Expand'} style={{ visibility: kids.length ? 'visible' : 'hidden' }} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })}>
            <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />
          </button>
          <button className="tree-main" onClick={() => openBoard(b.id)}>
            <Icon name="board" size={14} />
            <span className="ellipsis">{b.name || 'Untitled whiteboard'}</span>
            {b.color && <i className={`dot c-${b.color}`} />}
          </button>
          <em>{b.cardCount} cards · {timeAgo(b.updatedAt)}</em>
        </div>
        {expanded && kids.length > 0 && <ul>{kids.map((k) => row(k, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2 className="grow">Whiteboards</h2>
        <button className="btn primary" onClick={() => void newBoard()}><Icon name="plus" size={14} /> New whiteboard</button>
      </div>
      {roots.length === 0 ? <Empty title="No whiteboards yet">Create one to start laying cards out spatially.</Empty> : <ul className="tree" aria-label="Whiteboards">{roots.map((b) => row(b, 0))}</ul>}
    </div>
  );
}
