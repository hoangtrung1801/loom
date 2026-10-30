import { useEffect, useState } from 'react';
import type { CardSummary, TaskView } from '../../../core/store.js';
import { api } from '../../api.js';
import { newCard, openCard } from '../../actions.js';
import { mutate, useData } from '../../store/data.js';
import { Icon } from '../Icon.js';
import { CardRow, Empty } from '../ui/bits.js';
import { Button } from '@/components/ui/button';

/** New cards land here. Archiving a card removes it from the inbox without deleting it. */
export function Inbox() {
  const version = useData((s) => s.version);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  useEffect(() => {
    let live = true;
    void api.listCards({ inbox: true, sort: 'updated', limit: 500 }).then((c) => live && setCards(c));
    void api.listTasks({ done: false, inboxOnly: true }).then((t) => live && setTasks(t));
    return () => {
      live = false;
    };
  }, [version]);

  return (
    <div className="page">
      <div className="page-head">
        <h2 className="grow">Inbox</h2>
        <Button variant="outline" disabled={!cards.length} onClick={() => void mutate(() => Promise.all(cards.map((c) => api.setInbox(c.id, false))))}>Archive all</Button>
        <Button onClick={() => void newCard()}><Icon name="plus" size={14} /> New card</Button>
      </div>
      {tasks.length > 0 && (
        <section aria-label="Unfinished to-dos">
          <h3>Unfinished to-dos</h3>
          <ul className="task-list">
            {tasks.map((t) => <TaskRow key={`${t.cardId}:${t.blockId}`} task={t} />)}
          </ul>
        </section>
      )}
      {cards.length === 0 ? (
        <Empty title="Inbox zero">New cards you create show up here until you archive them.</Empty>
      ) : (
        <ul className="card-list" aria-label="Inbox cards">
          {cards.map((c) => (
            <CardRow key={c.id} card={c} extra={<button className="link" onClick={(e) => { e.stopPropagation(); void mutate(() => api.setInbox(c.id, false)); }}>Archive</button>} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function TaskRow({ task }: { task: TaskView }) {
  return (
    <li className="task">
      <input
        type="checkbox"
        className="task-check"
        checked={task.checked}
        aria-label={task.text}
        onChange={(e) => void mutate(() => api.setTaskChecked(task.cardId, task.blockId, e.target.checked))}
      />
      <button className="link" onClick={() => openCard(task.cardId)}>
        <span className={task.checked ? 'done' : ''}>{task.text || 'Untitled task'}</span>
        <em>{task.cardTitle || task.journalDate || 'Untitled'}</em>
      </button>
    </li>
  );
}
