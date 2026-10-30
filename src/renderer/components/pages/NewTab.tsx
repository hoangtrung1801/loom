import { useEffect, useState } from 'react';
import type { CardSummary } from '../../../core/store.js';
import { api } from '../../api.js';
import { newBoard, newCard, openJournal } from '../../actions.js';
import { useData } from '../../store/data.js';
import { useUi } from '../../store/ui.js';
import { Icon, type IconName } from '../Icon.js';
import { CardRow } from '../ui/bits.js';
import { openBoard } from '../../actions.js';

const START: { label: string; icon: IconName; run(): void }[] = [
  { label: 'New card', icon: 'card', run: () => void newCard() },
  { label: "Today's journal", icon: 'journal', run: () => void openJournal() },
  { label: 'New whiteboard', icon: 'board', run: () => void newBoard() },
  { label: 'Search…', icon: 'search', run: () => useUi.getState().setSearch(true) },
  { label: 'Save a link', icon: 'link', run: () => useUi.getState().setClip(true, 'link') },
  { label: 'Clip a web page', icon: 'globe', run: () => useUi.getState().setClip(true, 'page') },
];

/** The blank tab: quick starts plus what you touched last. */
export function NewTab() {
  const version = useData((s) => s.version);
  const boards = useData((s) => s.boards);
  const [recent, setRecent] = useState<CardSummary[]>([]);
  useEffect(() => {
    let live = true;
    void api.listCards({ sort: 'updated', limit: 8 }).then((c) => live && setRecent(c));
    return () => {
      live = false;
    };
  }, [version]);
  const recentBoards = [...boards].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  return (
    <div className="page newtab">
      <h2>Home</h2>
      <div className="quick-start">
        {START.map((s) => (
          <button key={s.label} className="tile" onClick={s.run}><Icon name={s.icon} size={15} /><span>{s.label}</span></button>
        ))}
      </div>
      <div className="columns">
        <section>
          <h3>Recent cards</h3>
          <ul className="card-list">{recent.map((c) => <CardRow key={c.id} card={c} />)}</ul>
        </section>
        <section>
          <h3>Recent whiteboards</h3>
          <ul className="card-list">
            {recentBoards.map((b) => (
              <li key={b.id}><button className="card-row" onClick={() => openBoard(b.id)}><span className="title ellipsis"><Icon name="board" size={14} />{b.name || 'Untitled whiteboard'}</span></button></li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
