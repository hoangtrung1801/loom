import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { mutate, useData } from '../../store/data.js';
import { Empty, timeAgo } from '../ui/bits.js';
import { Button } from '@/components/ui/button';

type Trash = Awaited<ReturnType<typeof api.listTrash>>;

export function TrashPage() {
  const version = useData((s) => s.version);
  const [trash, setTrash] = useState<Trash>({ cards: [], whiteboards: [] });
  useEffect(() => {
    let live = true;
    void api.listTrash().then((t) => live && setTrash(t));
    return () => {
      live = false;
    };
  }, [version]);
  const empty = !trash.cards.length && !trash.whiteboards.length;
  return (
    <div className="page">
      <div className="page-head"><h2 className="grow">Trash</h2></div>
      {empty ? (
        <Empty title="Trash is empty">Deleted cards and whiteboards can be restored from here.</Empty>
      ) : (
        <ul className="card-list" aria-label="Trash">
          {trash.cards.map((c) => (
            <li key={c.id} className="trash-row">
              <span className="ellipsis grow">{c.title || 'Untitled'}</span>
              <em>{c.kind} · {timeAgo(c.updatedAt)}</em>
              <Button variant="outline" onClick={() => void mutate(() => api.restoreCard(c.id))}>Restore</Button>
            </li>
          ))}
          {trash.whiteboards.map((b) => (
            <li key={b.id} className="trash-row">
              <span className="ellipsis grow">{b.name || 'Untitled whiteboard'}</span>
              <em>whiteboard</em>
              <Button variant="outline" onClick={() => void mutate(() => api.restoreWhiteboard(b.id))}>Restore</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
