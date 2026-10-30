import { useEffect, useMemo, useState } from 'react';
import { TASK_PRIORITIES, TASK_STATUSES, TASK_STATUS_LABELS, statusOf } from '../../../core/kinds.js';
import type { WorkTask } from '../../../core/work.js';
import { api } from '../../api.js';
import { newTask, openCard } from '../../actions.js';
import { mutate, useData } from '../../store/data.js';
import { Icon } from '../Icon.js';
import { menuFor } from '../ui/ContextMenu.js';
import { Empty, useDebounced } from '../ui/bits.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

const TASK_MIME = 'application/x-loom-task';
/** The columns every board has; Blocked and On hold appear only while they hold something. */
const CORE = ['todo', 'in-progress', 'in-review', 'done'] as const;

const todayIso = (): string => new Date().toISOString().slice(0, 10);
export const isOverdue = (t: Pick<WorkTask, 'due' | 'status'>): boolean => !!t.due && t.due < todayIso() && statusOf(t.status) !== 'done';

/** Kanban board and list of work tasks. Dragging a card to another column changes its status. */
export function TasksApp() {
  const version = useData((s) => s.version);
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [text, setText] = useState('');
  const [priority, setPriority] = useState('');
  const [label, setLabel] = useState('');
  const [assignee, setAssignee] = useState('');
  const [overdue, setOverdue] = useState(false);
  const q = useDebounced(text);

  useEffect(() => {
    let live = true;
    void api
      .listWorkTasks({ includeDone: true, query: q.trim() || undefined, priority: priority || undefined, label: label || undefined, assignee: assignee || undefined, overdue: overdue || undefined })
      .then((t) => live && setTasks(t));
    return () => {
      live = false;
    };
  }, [q, priority, label, assignee, overdue, version]);

  // Filters offer what exists, so they come from the unfiltered set when nothing is filtering.
  const [everyone, setEveryone] = useState<{ labels: string[]; assignees: string[] }>({ labels: [], assignees: [] });
  useEffect(() => {
    let live = true;
    void api.listWorkTasks({ includeDone: true }).then((all) => {
      if (!live) return;
      setEveryone({
        labels: [...new Set(all.flatMap((t) => t.labels))].sort(),
        assignees: [...new Set(all.map((t) => t.assignee).filter(Boolean))].sort(),
      });
    });
    return () => {
      live = false;
    };
  }, [version]);

  const columns = useMemo(() => {
    const byStatus = new Map<string, WorkTask[]>();
    for (const t of tasks) {
      const s = statusOf(t.status);
      byStatus.set(s, [...(byStatus.get(s) ?? []), t]);
    }
    const shown = TASK_STATUSES.filter((s) => (CORE as readonly string[]).includes(s) || byStatus.has(s));
    return shown.map((status) => ({ status, items: byStatus.get(status) ?? [] }));
  }, [tasks]);

  const move = (id: string, status: string): void => {
    void mutate(() => api.updateWorkTask(id, { status }));
  };
  const filtering = !!(q.trim() || priority || label || assignee || overdue);

  return (
    <div className="page wide tasks-app">
      <div className="page-head">
        <h2 className="grow">Tasks</h2>
        <div className="seg" role="group" aria-label="View">
          <button className={`seg-btn${view === 'board' ? ' on' : ''}`} aria-pressed={view === 'board'} onClick={() => setView('board')}>Board</button>
          <button className={`seg-btn${view === 'list' ? ' on' : ''}`} aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
        </div>
        <Button onClick={() => void newTask()}><Icon name="plus" size={14} /> New task</Button>
      </div>
      <div className="filters">
        <input className="filter-search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter tasks…" aria-label="Filter tasks" />
        <NativeSelect value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Filter by priority">
          <NativeSelectOption value="">Any priority</NativeSelectOption>
          {TASK_PRIORITIES.map((p) => <NativeSelectOption key={p} value={p}>{p}</NativeSelectOption>)}
        </NativeSelect>
        <NativeSelect value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Filter by label">
          <NativeSelectOption value="">Any label</NativeSelectOption>
          {everyone.labels.map((l) => <NativeSelectOption key={l} value={l}>#{l}</NativeSelectOption>)}
        </NativeSelect>
        <NativeSelect value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Filter by assignee">
          <NativeSelectOption value="">Anyone</NativeSelectOption>
          {everyone.assignees.map((a) => <NativeSelectOption key={a} value={a}>{a}</NativeSelectOption>)}
        </NativeSelect>
        <label className="check"><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Overdue</label>
      </div>

      {view === 'board' ? (
        <div className="kanban" role="group" aria-label="Task board">
          {columns.map(({ status, items }) => (
            <Column key={status} status={status} items={items} onDrop={move} />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <Empty title={filtering ? 'No tasks match' : 'No tasks yet'}>{filtering ? 'Clear the filters to see everything.' : 'Add one with New task, or capture it from a column on the board.'}</Empty>
      ) : (
        <table className="db-table task-table" aria-label="Task list">
          <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Due</th><th>Progress</th></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td><button className="link" onClick={() => openCard(t.id)}>{t.title}</button>{t.labels.map((l) => <em key={l} className="label"> #{l}</em>)}</td>
                <td><StatusSelect task={t} onChange={move} /></td>
                <td>{t.priority}</td>
                <td>{t.assignee}</td>
                <td className={isOverdue(t) ? 'overdue' : ''}>{t.due}</td>
                <td><Progress task={t} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatusSelect({ task, onChange }: { task: WorkTask; onChange(id: string, status: string): void }) {
  return (
    <NativeSelect value={statusOf(task.status)} onChange={(e) => onChange(task.id, e.target.value)} aria-label={`Status of ${task.title}`}>
      {TASK_STATUSES.map((s) => <NativeSelectOption key={s} value={s}>{TASK_STATUS_LABELS[s]}</NativeSelectOption>)}
    </NativeSelect>
  );
}

function Column({ status, items, onDrop }: { status: string; items: WorkTask[]; onDrop(id: string, status: string): void }) {
  const [over, setOver] = useState(false);
  const [draft, setDraft] = useState('');
  const label = TASK_STATUS_LABELS[status as keyof typeof TASK_STATUS_LABELS] ?? status;
  const add = (): void => {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    void newTask({ title, status, open: false });
  };
  return (
    <section
      className={`kanban-col${over ? ' over' : ''}`}
      aria-label={label}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(TASK_MIME)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(TASK_MIME);
        if (id) {
          e.preventDefault();
          onDrop(id, status);
        }
      }}
    >
      <h3><StatusIcon status={status} /><span className="grow">{label}</span><span className="count">{items.length}</span></h3>
      <ul className="kanban-list">
        {items.map((t) => <TaskCardView key={t.id} task={t} onMove={onDrop} />)}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Icon name="plus" size={14} /><Input className="h-[34px] border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a task" aria-label={`Add a task to ${label}`} />
      </form>
    </section>
  );
}

const initials = (name: string): string => name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** Ring icons tell statuses apart by shape as well as color. */
const STATUS_MARK: Record<string, string> = {
  todo: '',
  'in-progress': 'M12 7v5l3 2',
  'in-review': 'M8 12h8',
  blocked: 'M7 17L17 7',
  'on-hold': 'M10 9v6M14 9v6',
  done: 'M8 12l3 3 5-6',
};
function StatusIcon({ status }: { status: string }) {
  return (
    <svg className={`icon status-icon s-${status}`} width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={`M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z${STATUS_MARK[status] ?? ''}`} />
    </svg>
  );
}

function Progress({ task }: { task: WorkTask }) {
  const parts: string[] = [];
  if (task.subtasks.total) parts.push(`${task.subtasks.done}/${task.subtasks.total} subtasks`);
  if (task.progress.total) parts.push(`${task.progress.done}/${task.progress.total} to-dos`);
  return parts.length ? <span className="progress">{parts.join(' · ')}</span> : null;
}

function TaskCardView({ task, onMove }: { task: WorkTask; onMove(id: string, status: string): void }) {
  return (
    <li
      className={`task-card${statusOf(task.status) === 'done' ? ' done' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TASK_MIME, task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onContextMenu={menuFor(() => [
        { label: 'Open', onClick: () => openCard(task.id) },
        { label: 'Open in new tab', onClick: () => openCard(task.id, true) },
        { separator: true },
        ...TASK_STATUSES.filter((s) => s !== statusOf(task.status)).map((s) => ({ label: `Move to ${TASK_STATUS_LABELS[s]}`, onClick: () => onMove(task.id, s) })),
      ])}
    >
      <div className="task-meta">
        <span className={`prio p-${task.priority || 'medium'}`}>{task.priority || 'medium'}</span>
        {task.labels.map((l) => <em key={l} className="label">#{l}</em>)}
      </div>
      <button className="task-title" onClick={(e) => openCard(task.id, e.metaKey || e.ctrlKey)}>{task.title}</button>
      <div className="task-meta">
        {task.due && <span className={`due${isOverdue(task) ? ' overdue' : ''}`}>{task.due}</span>}
        <Progress task={task} />
        <span className="grow" />
        {task.assignee && <span className="avatar" title={task.assignee}>{initials(task.assignee)}</span>}
      </div>
      <StatusSelect task={task} onChange={onMove} />
    </li>
  );
}
