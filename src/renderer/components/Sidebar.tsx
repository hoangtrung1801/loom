import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from '../../core/store.js';
import { api } from '../api.js';
import { useApp } from '../state.js';
import { DRAG_MIME } from './Whiteboard.js';
import { SyncPanel } from './SyncPanel.js';

function Highlight({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\u0001[^\u0002]*\u0002)/).map((part, i) =>
        part.startsWith('\u0001') ? <mark key={i}>{part.slice(1, -1)}</mark> : part,
      )}
    </>
  );
}

export function Sidebar() {
  const { boards, cards, activeBoardId, board } = useApp();
  const { selectBoard, createBoard, renameBoard, deleteBoard, openCard } = useApp.getState();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const onBoard = new Set(board?.placements.map((p) => p.cardId));

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounced search; a stale response must never overwrite a newer one.
  useEffect(() => {
    if (!query.trim()) return setHits(null);
    let current = true;
    const t = window.setTimeout(() => {
      api.search(query).then((r) => current && setHits(r)).catch(() => current && setHits([]));
    }, 120);
    return () => {
      current = false;
      window.clearTimeout(t);
    };
  }, [query]);

  // Re-run an active search when cards change (e.g. after an edit is saved).
  const version = cards.map((c) => c.updatedAt).join(',');
  useEffect(() => {
    if (query.trim()) api.search(query).then(setHits).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return (
    <aside className="sidebar">
      <header className="brand">
        <span className="logo" aria-hidden>◈</span> Loom
      </header>

      <section>
        <div className="section-head">
          <h2>Whiteboards</h2>
          <button className="icon-btn" onClick={() => void createBoard()} title="New whiteboard" aria-label="New whiteboard">+</button>
        </div>
        <ul className="list" aria-label="Whiteboards">
          {boards.map((b) => (
            <li key={b.id} className={b.id === activeBoardId ? 'active' : ''}>
              {renaming === b.id ? (
                <input
                  className="rename"
                  autoFocus
                  defaultValue={b.name}
                  onBlur={(e) => { void renameBoard(b.id, e.target.value); setRenaming(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
                />
              ) : (
                <button className="row" onClick={() => void selectBoard(b.id)} onDoubleClick={() => setRenaming(b.id)} title="Double-click to rename">
                  <span className="grow ellipsis">{b.name || 'Untitled'}</span>
                  <span className="count">{b.cardCount}</span>
                </button>
              )}
              <button
                className={`icon-btn del${confirmDelete === b.id ? ' confirm' : ''}`}
                aria-label={confirmDelete === b.id ? 'Confirm delete whiteboard' : 'Delete whiteboard'}
                title={confirmDelete === b.id ? 'Click again to delete (cards are kept)' : 'Delete whiteboard'}
                onBlur={() => setConfirmDelete(null)}
                onClick={() => {
                  if (confirmDelete === b.id) { setConfirmDelete(null); void deleteBoard(b.id); }
                  else setConfirmDelete(b.id);
                }}
              >
                {confirmDelete === b.id ? '✓' : '×'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="cards-section">
        <div className="section-head"><h2>Cards</h2><span className="count">{cards.length}</span></div>
        <input
          ref={input}
          className="search"
          type="search"
          placeholder="Search cards  (Ctrl/⌘ K)"
          aria-label="Search cards"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); input.current?.blur(); } }}
        />
        <ul className="list cards" aria-label="Cards">
          {hits
            ? hits.map((h) => (
                <li key={h.id}>
                  <button className="row card-row" draggable onDragStart={(e) => e.dataTransfer.setData(DRAG_MIME, h.id)} onClick={() => void openCard(h.id)}>
                    <span className="title ellipsis">{h.title ? <Highlight text={h.titleMarked} /> : 'Untitled'}</span>
                    {h.snippet && <span className="snippet"><Highlight text={h.snippet} /></span>}
                  </button>
                </li>
              ))
            : cards.map((c) => (
                <li key={c.id}>
                  <button className="row card-row" draggable onDragStart={(e) => e.dataTransfer.setData(DRAG_MIME, c.id)} onClick={() => void openCard(c.id)}>
                    <span className="title ellipsis">
                      {onBoard.has(c.id) && <i className="dot" title="On this whiteboard" />}
                      {c.title || 'Untitled'}
                    </span>
                    {c.preview && <span className="snippet ellipsis">{c.preview}</span>}
                    {c.tags.length > 0 && <span className="tags">{c.tags.map((t) => <em key={t}>#{t}</em>)}</span>}
                  </button>
                </li>
              ))}
          {hits?.length === 0 && <li className="none">No cards match “{query}”.</li>}
          {!hits && cards.length === 0 && <li className="none">No cards yet.</li>}
        </ul>
      </section>

      <SyncPanel />
    </aside>
  );
}
