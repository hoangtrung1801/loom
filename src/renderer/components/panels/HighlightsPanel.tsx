import { useEffect, useState } from 'react';
import type { CardSummary } from '../../../core/store.js';
import { api } from '../../api.js';
import type { Tab } from '../../store/tabs.js';
import { useData } from '../../store/data.js';
import { CardRow, Empty } from '../ui/bits.js';

/** Highlights from the open PDF/web card, or every highlight when the tab isn't a source. */
export function HighlightsPanel({ tab }: { tab: Tab }) {
  const version = useData((s) => s.version);
  const [cards, setCards] = useState<CardSummary[]>([]);
  useEffect(() => {
    let live = true;
    void api.listCards({ kinds: ['highlight'], sourceId: tab.type === 'card' ? tab.ref : undefined, sort: 'created', limit: 500 }).then((c) => live && setCards(c));
    return () => {
      live = false;
    };
  }, [tab.type, tab.ref, version]);
  return (
    <div className="panel">
      {cards.length === 0 ? <Empty title="No highlights" /> : <ul className="card-list">{cards.map((c) => <CardRow key={c.id} card={c} />)}</ul>}
    </div>
  );
}
