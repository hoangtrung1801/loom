import { useEffect, useRef, useState } from 'react';
import type { AnyHit, CardKind } from '../../core/store.js';
import { CARD_KINDS } from '../../core/kinds.js';
import { api } from '../api.js';
import { openBoard, openCard, openChatTab, openTag } from '../actions.js';
import { useUi } from '../store/ui.js';
import { Icon, KIND_ICON, type IconName } from './Icon.js';
import { Highlight, useDebounced } from './ui/bits.js';

type Scope = 'whiteboards' | 'whiteboardText' | 'chats' | 'tags';
const SCOPES: { id: Scope; label: string }[] = [
  { id: 'whiteboards', label: 'Whiteboards' },
  { id: 'whiteboardText', label: 'Board text' },
  { id: 'chats', label: 'Chats' },
  { id: 'tags', label: 'Tags' },
];
const TYPE_ICON: Record<AnyHit['type'], IconName> = { card: 'card', whiteboard: 'board', text: 'text', chat: 'chat', tag: 'tag' };

/** Cmd+O: one box over cards, whiteboards, whiteboard text, chats and tags. */
export function GlobalSearch() {
  const open = useUi((s) => s.searchOpen);
  const setOpen = useUi((s) => s.setSearch);
  if (!open) return null;
  return <SearchBox close={() => setOpen(false)} />;
}

function SearchBox({ close }: { close(): void }) {
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<CardKind[]>([]);
  const [scopes, setScopes] = useState<Scope[]>(['whiteboards', 'whiteboardText', 'chats', 'tags']);
  const [sort, setSort] = useState<'relevance' | 'time'>('relevance');
  const [hits, setHits] = useState<AnyHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const q = useDebounced(query, 120);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    let live = true;
    void api
      .searchAll({
        query: q,
        kinds: kinds.length ? kinds : undefined,
        whiteboards: scopes.includes('whiteboards'),
        whiteboardText: scopes.includes('whiteboardText'),
        chats: scopes.includes('chats'),
        tags: scopes.includes('tags'),
        sort: q.trim() ? sort : 'time',
        limit: 40,
      })
      .then((h) => {
        if (!live) return;
        setHits(h);
        setCursor(0);
      });
    return () => {
      live = false;
    };
  }, [q, kinds, scopes, sort]);

  const go = (h: AnyHit, newTab: boolean): void => {
    close();
    switch (h.type) {
      case 'card': return openCard(h.id, newTab);
      case 'whiteboard': return openBoard(h.id, undefined, newTab);
      case 'text': return openBoard(h.boardId, h.id, newTab);
      case 'chat': return openChatTab(h.id);
      case 'tag': return openTag(h.id, newTab);
    }
  };

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(hits.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter' && hits[cursor]) { e.preventDefault(); go(hits[cursor]!, e.metaKey || e.ctrlKey); }
  };

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog search-dialog" role="dialog" aria-label="Search" onKeyDown={onKey}>
        <div className="search-input">
          <Icon name="search" />
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search everything…" aria-label="Search everything" role="combobox" aria-expanded aria-controls="search-results" />
        </div>
        <div className="search-filters">
          {CARD_KINDS.map((k) => <button key={k} className={`pill${kinds.includes(k) ? ' on' : ''}`} aria-pressed={kinds.includes(k)} onClick={() => setKinds(toggle(kinds, k))}>{k}</button>)}
          <span className="sep" />
          {SCOPES.map((s) => <button key={s.id} className={`pill${scopes.includes(s.id) ? ' on' : ''}`} aria-pressed={scopes.includes(s.id)} onClick={() => setScopes(toggle(scopes, s.id))}>{s.label}</button>)}
          <span className="sep" />
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort results"><option value="relevance">Relevance</option><option value="time">Last edited</option></select>
        </div>
        <ul id="search-results" className="results" role="listbox">
          {hits.map((h, i) => (
            <li key={`${h.type}:${h.id}`} role="option" aria-selected={i === cursor}>
              <button className={`result${i === cursor ? ' selected' : ''}`} onMouseMove={() => setCursor(i)} onClick={(e) => go(h, e.metaKey || e.ctrlKey)}>
                <span className="title ellipsis">
                  <Icon name={h.type === 'card' ? KIND_ICON[h.kind] ?? 'card' : TYPE_ICON[h.type]} size={14} />
                  <Highlight text={h.titleMarked || h.title || 'Untitled'} />
                </span>
                {h.snippet && <span className="snippet ellipsis"><Highlight text={h.snippet} /></span>}
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="none">No results</li>}
        </ul>
        <footer className="dialog-foot"><kbd>↑↓</kbd> move <kbd>Enter</kbd> open <kbd>⌘Enter</kbd> new tab <kbd>Esc</kbd> close</footer>
      </div>
    </div>
  );
}
