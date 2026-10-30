import { useEffect, useState } from 'react';
import type { CardSummary, SearchHit } from '../../../core/store.js';
import { api } from '../../api.js';
import { useData } from '../../store/data.js';
import { CardRow, Empty, useDebounced } from '../ui/bits.js';
import { Input } from '@/components/ui/input';

/** Search-as-you-type card list. Rows are draggable onto whiteboards. */
export function LibraryPanel() {
  const version = useData((s) => s.version);
  const [query, setQuery] = useState('');
  const q = useDebounced(query);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    let live = true;
    if (q.trim()) void api.search(q, 50).then((h) => live && setHits(h));
    else void api.listCards({ sort: 'updated', limit: 100 }).then((c) => live && setCards(c));
    return () => {
      live = false;
    };
  }, [q, version]);

  const kindOf = useData((s) => s.index);
  return (
    <div className="panel">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search cards…" aria-label="Search the card library" />
      {q.trim() ? (
        hits.length ? (
          <ul className="card-list">
            {hits.map((h) => <CardRow key={h.id} card={{ id: h.id, title: h.title, kind: kindOf.find((c) => c.id === h.id)?.kind ?? 'note' }} hit={h} />)}
          </ul>
        ) : <Empty title="No matches" />
      ) : (
        <ul className="card-list">{cards.map((c) => <CardRow key={c.id} card={c} />)}</ul>
      )}
    </div>
  );
}
