import { useEffect, useState } from 'react';
import type { SearchHit } from '../../../core/store.js';
import { api } from '../../api.js';
import type { Tab } from '../../store/tabs.js';
import { useData } from '../../store/data.js';
import { CardRow, Empty } from '../ui/bits.js';

/** Cards related to what you're looking at: the cards on this whiteboard, or this card itself. */
export function SuggestionsPanel({ tab }: { tab: Tab }) {
  const version = useData((s) => s.version);
  const index = useData((s) => s.index);
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => {
      let ids: string[] = [];
      if (tab.type === 'card') ids = [tab.ref];
      else if (tab.type === 'whiteboard') {
        const board = await api.getWhiteboard(tab.ref);
        ids = board?.placements.filter((p) => p.kind === 'card').map((p) => p.cardId) ?? [];
      }
      const found = ids.length ? await api.relatedCards(ids, 12) : [];
      if (live) setHits(found);
    };
    void load();
    return () => {
      live = false;
    };
  }, [tab.type, tab.ref, version]);
  return (
    <div className="panel">
      {hits.length === 0 ? (
        <Empty title="Nothing related yet">Related cards appear as your notes share words and tags.</Empty>
      ) : (
        <ul className="card-list">{hits.map((h) => <CardRow key={h.id} card={{ id: h.id, title: h.title, kind: index.find((c) => c.id === h.id)?.kind ?? 'note' }} hit={h} />)}</ul>
      )}
    </div>
  );
}
