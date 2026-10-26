import { useEffect, useState } from 'react';
import { TASK_PRIORITIES, TASK_STATUSES, TASK_STATUS_LABELS, WRITTEN_KINDS, statusOf } from '../../core/kinds.js';
import type { CardDetail, CardKind } from '../../core/store.js';
import { isFileId } from '../../core/fileid.js';
import type { WorkTaskDetail } from '../../core/work.js';
import { api, fileUrl } from '../api.js';
import { newTask, openCard } from '../actions.js';
import { mutate, useData } from '../store/data.js';
import { Icon } from './Icon.js';

/** Status, priority, assignee, due date, parent and subtasks of a task card. Each field is its own synced value. */
export function TaskHeader({ card }: { card: CardDetail }) {
  const version = useData((s) => s.version);
  const [task, setTask] = useState<WorkTaskDetail | null>(null);
  const [assignee, setAssignee] = useState(card.assignee);
  const [subtask, setSubtask] = useState('');
  useEffect(() => {
    let live = true;
    void api.getWorkTask(card.id).then((t) => {
      if (!live || !t) return;
      setTask(t);
      setAssignee(t.assignee);
    });
    return () => {
      live = false;
    };
  }, [card.id, version]);
  if (!task) return null;
  const set = (patch: Parameters<typeof api.updateWorkTask>[1]): void => void mutate(() => api.updateWorkTask(card.id, patch));
  const addSubtask = (): void => {
    const title = subtask.trim();
    if (!title) return;
    setSubtask('');
    void newTask({ title, parentId: card.id, open: false });
  };
  return (
    <section className="work-header" aria-label="Task details">
      <div className="work-fields">
        <label>Status
          <select value={statusOf(task.status)} onChange={(e) => set({ status: e.target.value })} aria-label="Task status">
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
          </select>
        </label>
        <label>Priority
          <select value={task.priority || 'medium'} onChange={(e) => set({ priority: e.target.value })} aria-label="Task priority">
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>Assignee
          <input value={assignee} onChange={(e) => setAssignee(e.target.value)} onBlur={() => assignee !== task.assignee && set({ assignee })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} placeholder="Nobody" aria-label="Task assignee" />
        </label>
        <label>Due
          <input type="date" value={task.due} onChange={(e) => set({ due: e.target.value })} aria-label="Task due date" />
        </label>
      </div>
      {task.parent && <p className="work-parent">Subtask of <button className="link" onClick={() => openCard(task.parent!.id)}>{task.parent.title || 'Untitled'}</button> · <button className="link" onClick={() => set({ parentId: '' })}>Detach</button></p>}
      <div className="subtasks" aria-label="Subtasks">
        <h4>Subtasks {task.children.length > 0 && <span className="count">{task.subtasks.done}/{task.subtasks.total}</span>}</h4>
        <ul className="task-list">
          {task.children.map((c) => (
            <li key={c.id} className="subtask">
              <input
                type="checkbox"
                checked={statusOf(c.status) === 'done'}
                aria-label={`Mark ${c.title} done`}
                onChange={(e) => void mutate(() => api.updateWorkTask(c.id, { status: e.target.checked ? 'done' : 'todo' }))}
              />
              <button className={`link${statusOf(c.status) === 'done' ? ' done' : ''}`} onClick={() => openCard(c.id)}>{c.title}</button>
            </li>
          ))}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); addSubtask(); }}>
          <input value={subtask} onChange={(e) => setSubtask(e.target.value)} placeholder="Add a subtask" aria-label="Add a subtask" />
        </form>
      </div>
    </section>
  );
}

/** Preview of a saved link: image, address, description, and a way back to the original page. */
export function LinkHeader({ card }: { card: CardDetail }) {
  let description = '';
  try {
    description = String((JSON.parse(card.meta || '{}') as { description?: string }).description ?? '');
  } catch {
    /* no description */
  }
  const [desc, setDesc] = useState(description);
  const [address, setAddress] = useState(card.url);
  useEffect(() => setDesc(description), [description]);
  useEffect(() => setAddress(card.url), [card.url]);
  const save = (patch: { description?: string; url?: string }): void => void mutate(() => api.updateLink(card.id, patch));
  return (
    <section className="work-header link-header" aria-label="Link details">
      {isFileId(card.fileId) && <img className="link-hero" src={fileUrl(card.fileId)} alt="" />}
      <label>Address
        <input value={address} onChange={(e) => setAddress(e.target.value)} onBlur={() => address.trim() && address !== card.url && save({ url: address })} aria-label="Link address" />
      </label>
      <label>Description
        <textarea value={desc} rows={2} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== description && save({ description: desc })} aria-label="Link description" />
      </label>
      {/^https?:\/\//i.test(card.url) && <a className="file-link" href={card.url} target="_blank" rel="noreferrer noopener"><Icon name="globe" size={14} /> Open original · {new URL(card.url).hostname}</a>}
    </section>
  );
}

/** Notes, memos and tasks are the same material at different stages; this moves one to the next. */
export function ConvertBar({ card }: { card: CardDetail }) {
  if (!(WRITTEN_KINDS as readonly string[]).includes(card.kind)) return null;
  const targets = (WRITTEN_KINDS as readonly CardKind[]).filter((k) => k !== card.kind);
  return (
    <span className="convert">
      {targets.map((k) => (
        <button key={k} className="link" onClick={() => void mutate(() => api.convertCard(card.id, k))}>Turn into {k === 'note' ? 'a note' : k === 'memo' ? 'a memo' : 'a task'}</button>
      ))}
    </span>
  );
}
