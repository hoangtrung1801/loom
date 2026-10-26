import { useEffect, useState } from 'react';
import type { CardSummary } from '../../../core/store.js';
import { api } from '../../api.js';
import { useData } from '../../store/data.js';
import { Empty } from '../ui/bits.js';
import { CardRow } from '../ui/bits.js';

/** Highlight cards pulled out of PDFs and web pages. */
export function HighlightsApp() {
  const version = useData((s) => s.version);
  const [cards, setCards] = useState<CardSummary[]>([]);
  useEffect(() => {
    let live = true;
    void api.listCards({ kinds: ['highlight'], sort: 'created', limit: 1000 }).then((c) => live && setCards(c));
    return () => {
      live = false;
    };
  }, [version]);
  return (
    <div className="page">
      <div className="page-head"><h2 className="grow">Highlights</h2></div>
      {cards.length === 0 ? (
        <Empty title="No highlights yet">Select text in a PDF and choose Highlight to save it as a card.</Empty>
      ) : (
        <ul className="card-list" aria-label="Highlights">{cards.map((c) => <CardRow key={c.id} card={c} />)}</ul>
      )}
    </div>
  );
}
