import { useEffect, useState } from 'react';
import type { HistoryEntry } from '../../../core/store.js';
import { api } from '../../api.js';
import { openCard } from '../../actions.js';
import type { Tab } from '../../store/tabs.js';
import { mutate, useData } from '../../store/data.js';
import { discardPending, flushAll, useCardDetail } from '../../store/edits.js';
import { timeAgo } from '../ui/bits.js';

export function InfoPanel({ tab }: { tab: Tab }) {
  return tab.type === 'card' ? <CardInfo id={tab.ref} /> : <BoardInfo id={tab.ref} />;
}

function BoardInfo({ id }: { id: string }) {
  const board = useData((s) => s.boards.find((b) => b.id === id));
  if (!board) return null;
  return (
    <dl className="panel info">
      <dt>Name</dt><dd>{board.name}</dd>
      <dt>Cards</dt><dd>{board.cardCount}</dd>
      <dt>Created</dt><dd>{new Date(board.createdAt).toLocaleString()}</dd>
      <dt>Updated</dt><dd>{timeAgo(board.updatedAt)}</dd>
    </dl>
  );
}

function CardInfo({ id }: { id: string }) {
  const { card } = useCardDetail(id);
  const version = useData((s) => s.version);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    let live = true;
    void api.cardHistory(id, 30).then((h) => live && setHistory(h));
    return () => {
      live = false;
    };
  }, [id, version]);
  if (!card) return null;

  const restore = async (opId: string): Promise<void> => {
    await flushAll();
    discardPending(id);
    await mutate(() => api.restoreCardVersion(id, opId));
  };

  return (
    <div className="panel info">
      <dl>
        <dt>Type</dt><dd>{card.kind}</dd>
        <dt>Words</dt><dd>{card.wordCount}</dd>
        <dt>Created</dt><dd>{new Date(card.createdAt).toLocaleString()}</dd>
        <dt>Edited</dt><dd>{timeAgo(card.updatedAt)}</dd>
      </dl>
      <h3>Backlinks <span className="count">{card.backlinks.length}</span></h3>
      {card.backlinks.length === 0 ? <p className="hint">Mention this card with @ or [[title]] from another card.</p> : (
        <ul className="backlinks">
          {card.backlinks.map((b) => (
            <li key={`${b.id}:${b.blockId}`}>
              <button className="link" onClick={() => openCard(b.id)}><strong>{b.title || 'Untitled'}</strong><span>{b.text}</span></button>
            </li>
          ))}
        </ul>
      )}
      <h3>History</h3>
      <ul className="history">
        {history.map((h, i) => (
          <li key={h.opId}>
            <span>{new Date(h.at).toLocaleString()}</span>
            {i > 0 && <button className="link" onClick={() => void restore(h.opId)}>Restore</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
