import { useEffect, useState } from 'react';
import type { TaskView } from '../../../core/store.js';
import { api } from '../../api.js';
import type { Tab } from '../../store/tabs.js';
import { useData } from '../../store/data.js';
import { TaskRow } from '../pages/Inbox.js';
import { Empty } from '../ui/bits.js';

/** To-dos found in this card, or every unfinished to-do on the journal app. */
export function TasksPanel({ tab }: { tab: Tab }) {
  const version = useData((s) => s.version);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  useEffect(() => {
    let live = true;
    void api.listTasks(tab.type === 'card' ? { cardId: tab.ref } : { done: false }).then((t) => live && setTasks(t));
    return () => {
      live = false;
    };
  }, [tab.type, tab.ref, version]);
  return (
    <div className="panel">
      {tasks.length === 0 ? <Empty title="No to-dos">Type [] at the start of a line to add a to-do.</Empty> : <ul className="task-list">{tasks.map((t) => <TaskRow key={`${t.cardId}:${t.blockId}`} task={t} />)}</ul>}
    </div>
  );
}
