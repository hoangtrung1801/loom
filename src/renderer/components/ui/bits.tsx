import { useEffect, useState } from 'react';
import { DRAG_MIME, openCard } from '../../actions.js';
import type { CardSummary, SearchHit } from '../../../core/store.js';
import { KIND_ICON, Icon } from '../Icon.js';
import { menuFor } from './ContextMenu.js';

export function useDebounced<T>(value: T, ms = 150): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Renders a string with U+0001/U+0002 match markers as <mark>. */
export function Highlight({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\u0001[^\u0002]*\u0002)/).map((part, i) => (part.startsWith('\u0001') ? <mark key={i}>{part.slice(1, -1)}</mark> : part))}
    </>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}

export function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

type Row = Pick<CardSummary, 'id' | 'title' | 'kind'> & Partial<Pick<CardSummary, 'preview' | 'tags' | 'updatedAt' | 'journalDate'>>;

/** One card in any list: draggable onto whiteboards, opens on click. */
export function CardRow({ card, hit, onOpen, extra, selected }: { card: Row; hit?: SearchHit; onOpen?(newTab: boolean): void; extra?: React.ReactNode; selected?: boolean }) {
  const title = card.title || (card.kind === 'journal' ? card.journalDate : '') || 'Untitled';
  return (
    <li>
      <button
        className={`card-row${selected ? ' selected' : ''}`}
        draggable
        onDragStart={(e) => e.dataTransfer.setData(DRAG_MIME, card.id)}
        onClick={(e) => (onOpen ? onOpen(e.metaKey || e.ctrlKey) : openCard(card.id, e.metaKey || e.ctrlKey))}
        onContextMenu={menuFor(() => [{ label: 'Open', onClick: () => openCard(card.id) }, { label: 'Open in new tab', onClick: () => openCard(card.id, true) }])}
      >
        <span className="title ellipsis">
          <Icon name={KIND_ICON[card.kind] ?? 'card'} size={14} />
          {hit ? <Highlight text={hit.titleMarked || title} /> : title}
        </span>
        {hit ? (
          hit.snippet && <span className="snippet"><Highlight text={hit.snippet} /></span>
        ) : (
          card.preview && <span className="snippet ellipsis">{card.preview}</span>
        )}
        {(card.tags?.length || extra) && (
          <span className="meta">
            {card.tags?.map((t) => <em key={t}>#{t}</em>)}
            {extra}
          </span>
        )}
      </button>
    </li>
  );
}
