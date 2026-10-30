import { useEffect, useState } from 'react';
import type { CardSummary } from '../../../core/store.js';
import { api } from '../../api.js';
import { openJournal } from '../../actions.js';
import { todayIso } from '../../editor/commands.js';
import { useData } from '../../store/data.js';
import { CardRow, Empty } from '../ui/bits.js';
import { Button } from '@/components/ui/button';

/** Recent journal days, so you can drag a thought from a journal onto a whiteboard. */
export function JournalPanel() {
  const version = useData((s) => s.version);
  const [days, setDays] = useState<CardSummary[]>([]);
  useEffect(() => {
    let live = true;
    void api.listJournals(30).then((d) => live && setDays(d));
    return () => {
      live = false;
    };
  }, [version]);
  return (
    <div className="panel">
      <Button onClick={() => void openJournal(todayIso())}>Today's journal</Button>
      {days.length === 0 ? <Empty title="No journal entries yet" /> : <ul className="card-list">{days.map((d) => <CardRow key={d.id} card={d} />)}</ul>}
    </div>
  );
}
