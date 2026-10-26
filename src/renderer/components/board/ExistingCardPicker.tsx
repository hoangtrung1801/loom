import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from '../../../core/store.js';
import { api } from '../../api.js';
import { useData } from '../../store/data.js';
import { Highlight, useDebounced } from '../ui/bits.js';

/** Popover to add an existing card to the whiteboard without leaving it. */
export function ExistingCardPicker({ onPick, onClose }: { onPick(cardId: string): void; onClose(): void }) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 100);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const index = useData((s) => s.index);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    let live = true;
    if (q.trim()) void api.search(q, 12).then((h) => live && setHits(h));
    else setHits(index.slice(0, 12).map((c) => ({ id: c.id, title: c.title, titleMarked: c.title, snippet: '' })));
    return () => {
      live = false;
    };
  }, [q, index]);
  return (
    <div className="popover picker" role="dialog" aria-label="Add existing card" onPointerDown={(e) => e.stopPropagation()}>
      <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search cards…" aria-label="Search cards to add" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && hits[0]) onPick(hits[0].id); e.stopPropagation(); }} />
      <ul>
        {hits.map((h) => (
          <li key={h.id}><button onClick={() => onPick(h.id)}><Highlight text={h.titleMarked || h.title || 'Untitled'} /></button></li>
        ))}
        {hits.length === 0 && <li className="none">No cards</li>}
      </ul>
    </div>
  );
}
