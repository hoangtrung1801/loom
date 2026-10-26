import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { openJournal } from '../../actions.js';
import { todayIso } from '../../editor/commands.js';
import { useData } from '../../store/data.js';
import { Icon } from '../Icon.js';
import { Editor } from '../../editor/Editor.js';
import { editCard, useCardDetail } from '../../store/edits.js';
import { openByTitle } from '../../actions.js';

const pad = (n: number): string => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number): string => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Month calendar plus the selected day's journal card, edited in place. */
export function JournalApp() {
  const version = useData((s) => s.version);
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [day, setDay] = useState(todayIso());
  const [written, setWritten] = useState<Set<string>>(new Set());
  const [cardId, setCardId] = useState('');

  useEffect(() => {
    let live = true;
    void api.journalDays(month).then((d) => live && setWritten(new Set(d)));
    return () => {
      live = false;
    };
  }, [month, version]);

  useEffect(() => {
    let live = true;
    void api.ensureJournal(day).then((id) => live && setCardId(id));
    return () => {
      live = false;
    };
  }, [day]);

  const [y, m] = month.split('-').map(Number) as [number, number];
  const cells = useMemo(() => {
    const first = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    return [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  }, [y, m]);
  const shift = (by: number): void => {
    const d = new Date(y, m - 1 + by, 1);
    setMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };

  return (
    <div className="journal-app">
      <aside className="calendar" aria-label="Calendar">
        <div className="cal-head">
          <button className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}><Icon name="chevronRight" className="flip" /></button>
          <strong className="grow">{new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
          <button className="icon-btn" aria-label="Next month" onClick={() => shift(1)}><Icon name="chevronRight" /></button>
        </div>
        <div className="cal-grid">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} className="dow">{d}</span>)}
          {cells.map((d, i) =>
            d === null ? (
              <span key={i} />
            ) : (
              <button
                key={i}
                className={`day${iso(y, m - 1, d) === day ? ' selected' : ''}${iso(y, m - 1, d) === todayIso() ? ' today' : ''}${written.has(iso(y, m - 1, d)) ? ' written' : ''}`}
                aria-label={iso(y, m - 1, d)}
                onClick={() => setDay(iso(y, m - 1, d))}
              >
                {d}
              </button>
            ),
          )}
        </div>
        <button className="btn" onClick={() => { setDay(todayIso()); setMonth(todayIso().slice(0, 7)); }}>Today</button>
        <button className="btn" onClick={() => void openJournal(day)}>Open as card</button>
      </aside>
      <div className="journal-day">
        <h2>{new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2>
        {cardId && <JournalEditor key={cardId} id={cardId} />}
      </div>
    </div>
  );
}

function JournalEditor({ id }: { id: string }) {
  const { card } = useCardDetail(id);
  if (!card) return <div className="loading">Loading…</div>;
  return (
    <Editor
      value={card.content}
      onChange={(json) => editCard(card.id, { content: json })}
      onOpenLink={(t) => void openByTitle(t)}
      placeholder="What's on your mind today?"
    />
  );
}
