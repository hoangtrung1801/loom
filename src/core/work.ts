import { docToText } from './doc.js';
import { priorityOf, statusOf, TASK_PRIORITIES, TASK_STATUSES, WRITTEN_KINDS, type CardKind } from './kinds.js';
import { markdownToContent } from './markdown.js';
import type { Store } from './store.js';
import { hostOf, normalizeUrl, parseWebUrl } from './url.js';

/** Tasks, saved links and memos: the three kinds of knowledge that are cards with a little structure on top. */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface Progress {
  done: number;
  total: number;
}
export interface WorkTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  due: string;
  parentId: string;
  labels: string[];
  /** Checked / total to-do items in the task's own body (its acceptance criteria and plan). */
  progress: Progress;
  /** Finished / total direct subtasks. */
  subtasks: Progress;
  preview: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number;
}
export interface WorkTaskDetail extends WorkTask {
  parent: { id: string; title: string } | null;
  children: WorkTask[];
}
export interface TaskFilter {
  status?: string;
  priority?: string;
  assignee?: string;
  label?: string;
  /** A task id for its subtasks, or 'none' for top-level tasks only. */
  parentId?: string;
  query?: string;
  includeDone?: boolean;
  /** Only tasks past their due date and not done. */
  overdue?: boolean;
}
export interface TaskInput {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  due?: string;
  parentId?: string;
  labels?: string[];
  acceptance?: string[];
  plan?: string;
  notes?: string;
  /** Adds empty "Acceptance criteria / Plan / Notes" headings to a task that has none of that text yet. */
  scaffold?: boolean;
}
export interface TaskPatch {
  title?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  due?: string;
  parentId?: string;
}

export interface LinkInput {
  url: string;
  title?: string;
  description?: string;
  note?: string;
  site?: string;
  imageFileId?: string;
  tags?: string[];
}
export interface LinkView {
  id: string;
  url: string;
  host: string;
  title: string;
  description: string;
  note: string;
  fileId: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}
export interface LinkFilter {
  query?: string;
  tag?: string;
  limit?: number;
}

const today = (): string => new Date().toISOString().slice(0, 10);

function checkChoice(value: string, allowed: readonly string[], what: string): void {
  if (!allowed.includes(value)) throw new Error(`Unknown ${what} "${value}". Use one of: ${allowed.join(', ')}.`);
}
function checkDue(due: string): void {
  if (due && (!DATE.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`)))) throw new Error('Due dates look like 2025-01-31.');
}

export class Work {
  constructor(private readonly store: Store) {}

  // ------------------------------------------------------------------ tasks

  createTask(input: TaskInput): string {
    const title = String(input.title ?? '').trim();
    if (!title) throw new Error('A task needs a title.');
    const status = input.status ?? 'todo';
    const priority = input.priority ?? 'medium';
    const due = input.due ?? '';
    checkChoice(status, TASK_STATUSES, 'status');
    checkChoice(priority, TASK_PRIORITIES, 'priority');
    checkDue(due);
    if (input.parentId) this.requireTask(input.parentId, 'The parent');

    const sections: string[] = [];
    const description = (input.description ?? '').trim();
    const acceptance = (input.acceptance ?? []).map((a) => a.trim()).filter(Boolean);
    const plan = (input.plan ?? '').trim();
    const notes = (input.notes ?? '').trim();
    if (description) sections.push(description);
    if (acceptance.length) sections.push(`## Acceptance criteria\n\n${acceptance.map((a) => `- [ ] ${a}`).join('\n')}`);
    if (plan) sections.push(`## Plan\n\n${plan}`);
    if (notes) sections.push(`## Notes\n\n${notes}`);
    if (!sections.length && input.scaffold) sections.push('## Acceptance criteria\n\n## Plan\n\n## Notes');

    const id = this.store.createCard({
      title, kind: 'task', status, priority, assignee: (input.assignee ?? '').trim(), due, parentId: input.parentId ?? '',
      content: markdownToContent(sections.join('\n\n')),
    });
    if (status === 'done') this.store.patchCard(id, { completedAt: Date.now() });
    for (const label of input.labels ?? []) if (label.trim()) this.store.addTag(id, label);
    return id;
  }

  updateTask(id: string, patch: TaskPatch): void {
    const task = this.requireTask(id, 'That card');
    const next: Parameters<Store['patchCard']>[1] = {};
    if (patch.title !== undefined) {
      if (!patch.title.trim()) throw new Error('A task needs a title.');
      next.title = patch.title.trim();
    }
    if (patch.status !== undefined) {
      checkChoice(patch.status, TASK_STATUSES, 'status');
      next.status = patch.status;
      const wasDone = statusOf(task.status) === 'done';
      if (patch.status === 'done' && !wasDone) next.completedAt = Date.now();
      else if (patch.status !== 'done' && wasDone) next.completedAt = 0;
    }
    if (patch.priority !== undefined) {
      checkChoice(patch.priority, TASK_PRIORITIES, 'priority');
      next.priority = patch.priority;
    }
    if (patch.assignee !== undefined) next.assignee = patch.assignee.trim();
    if (patch.due !== undefined) {
      checkDue(patch.due);
      next.due = patch.due;
    }
    if (patch.parentId !== undefined) {
      if (patch.parentId) this.assertParent(id, patch.parentId);
      next.parentId = patch.parentId;
    }
    if (Object.keys(next).length) this.store.patchCard(id, next);
  }

  getTask(id: string): WorkTaskDetail | null {
    const one = this.tasks({}, id)[0];
    if (!one) return null;
    const parent = one.parentId ? this.store.get('SELECT id, title FROM cards WHERE id = ? AND deleted_at IS NULL', one.parentId) : undefined;
    return { ...one, parent: parent ? { id: parent.id, title: parent.title } : null, children: this.tasks({ parentId: id }) };
  }

  listTasks(filter: TaskFilter = {}): WorkTask[] {
    return this.tasks(filter);
  }

  private requireTask(id: string, who: string): { id: string; kind: string; status: string; parent_id: string } {
    const row = this.store.get('SELECT id, kind, status, parent_id FROM cards WHERE id = ? AND deleted_at IS NULL', id);
    if (!row) throw new Error(`${who} no longer exists.`);
    if (row.kind !== 'task') throw new Error(`${who} is not a task.`);
    return row as { id: string; kind: string; status: string; parent_id: string };
  }

  /** A task may not become its own ancestor. */
  private assertParent(id: string, parentId: string): void {
    this.requireTask(parentId, 'The parent');
    let cursor = parentId;
    for (let depth = 0; cursor && depth < 50; depth++) {
      if (cursor === id) throw new Error('A task cannot be a subtask of itself or of its own subtasks.');
      cursor = (this.store.get('SELECT parent_id FROM cards WHERE id = ?', cursor)?.parent_id as string | undefined) ?? '';
    }
  }

  private tasks(filter: TaskFilter, onlyId?: string): WorkTask[] {
    const where = ["c.kind = 'task'", 'c.deleted_at IS NULL'];
    const params: (string | number)[] = [];
    if (onlyId) (where.push('c.id = ?'), params.push(onlyId));
    if (filter.status) {
      checkChoice(filter.status, TASK_STATUSES, 'status');
      // Cards without a status count as "to do".
      where.push(filter.status === 'todo' ? "(c.status = 'todo' OR c.status = '' OR c.status NOT IN (" + TASK_STATUSES.map(() => '?').join(',') + '))' : 'c.status = ?');
      if (filter.status === 'todo') params.push(...TASK_STATUSES);
      else params.push(filter.status);
    }
    if (filter.includeDone === false) where.push("c.status != 'done'");
    if (filter.priority) (where.push('c.priority = ?'), params.push(filter.priority));
    if (filter.assignee) (where.push('lower(c.assignee) = lower(?)'), params.push(filter.assignee));
    if (filter.parentId === 'none') where.push("c.parent_id = ''");
    else if (filter.parentId) (where.push('c.parent_id = ?'), params.push(filter.parentId));
    if (filter.label) {
      where.push('EXISTS (SELECT 1 FROM card_tags t WHERE t.card_id = c.id AND t.tag = ? AND t.deleted_at IS NULL)');
      params.push(filter.label.replace(/^#/, '').toLowerCase());
    }
    if (filter.overdue) (where.push("c.due != '' AND c.due < ? AND c.status != 'done'"), params.push(today()));
    if (filter.query?.trim()) {
      const like = `%${filter.query.trim().toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      where.push("(lower(c.title) LIKE ? ESCAPE '\\' OR lower(c.assignee) LIKE ? ESCAPE '\\')");
      params.push(like, like);
    }
    const rows = this.store.all(
      `SELECT c.id, c.title, c.content, c.status, c.priority, c.assignee, c.due, c.parent_id, c.created_at, c.updated_at, c.completed_at,
              (SELECT COUNT(*) FROM tasks t WHERE t.card_id = c.id) AS todo_total,
              (SELECT COUNT(*) FROM tasks t WHERE t.card_id = c.id AND t.checked = 1) AS todo_done,
              (SELECT COUNT(*) FROM cards k WHERE k.parent_id = c.id AND k.kind = 'task' AND k.deleted_at IS NULL) AS kids_total,
              (SELECT COUNT(*) FROM cards k WHERE k.parent_id = c.id AND k.kind = 'task' AND k.deleted_at IS NULL AND k.status = 'done') AS kids_done
       FROM cards c WHERE ${where.join(' AND ')} ORDER BY c.updated_at DESC LIMIT 5000`,
      ...params,
    );
    const labels = new Map<string, string[]>();
    for (const r of this.store.all('SELECT card_id, tag FROM card_tags WHERE deleted_at IS NULL ORDER BY tag')) {
      (labels.get(r.card_id) ?? labels.set(r.card_id, []).get(r.card_id)!).push(r.tag);
    }
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: statusOf(r.status),
      priority: priorityOf(r.priority),
      assignee: r.assignee,
      due: r.due,
      parentId: r.parent_id,
      labels: labels.get(r.id) ?? [],
      progress: { done: r.todo_done, total: r.todo_total },
      subtasks: { done: r.kids_done, total: r.kids_total },
      preview: docToText(r.content).replace(/\s+/g, ' ').trim().slice(0, 160),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at,
    }));
  }

  // ------------------------------------------------------------------ links

  /** Saves a bookmark. The same page (ignoring tracking parameters and fragments) is never saved twice. */
  saveLink(input: LinkInput): { id: string; existed: boolean } {
    const url = parseWebUrl(input.url);
    const key = normalizeUrl(url.href);
    const existing = this.findLink(key);
    if (existing) {
      const note = (input.note ?? '').trim();
      for (const tag of input.tags ?? []) if (tag.trim()) this.store.addTag(existing, tag);
      if (note) this.appendNote(existing, note);
      return { id: existing, existed: true };
    }
    const description = (input.description ?? '').trim().slice(0, 1000);
    const id = this.store.createCard({
      kind: 'link',
      title: (input.title ?? '').trim().slice(0, 300) || hostOf(url.href) || url.hostname,
      url: url.href,
      fileId: input.imageFileId ?? '',
      meta: JSON.stringify({ description, site: (input.site ?? '').slice(0, 200), key }),
      content: markdownToContent((input.note ?? '').trim()),
    });
    for (const tag of input.tags ?? []) if (tag.trim()) this.store.addTag(id, tag);
    return { id, existed: false };
  }

  findLink(normalizedKey: string): string | null {
    return (this.store.get("SELECT id FROM cards WHERE kind = 'link' AND deleted_at IS NULL AND json_extract(CASE WHEN json_valid(meta) THEN meta ELSE '{}' END, '$.key') = ? LIMIT 1", normalizedKey)?.id as string | undefined) ?? null;
  }

  private appendNote(id: string, note: string): void {
    const card = this.store.getCard(id);
    if (!card) return;
    const doc = JSON.parse(card.content || '{"type":"doc","content":[]}') as { content?: unknown[] };
    const added = JSON.parse(markdownToContent(note)) as { content?: unknown[] };
    doc.content = [...(doc.content ?? []), ...(added.content ?? [])];
    this.store.updateCard(id, { content: JSON.stringify(doc) });
  }

  updateLink(id: string, patch: { title?: string; description?: string; url?: string }): void {
    const card = this.store.getCard(id);
    if (!card || card.kind !== 'link') throw new Error('That card is not a saved link.');
    const next: Parameters<Store['patchCard']>[1] = {};
    if (patch.title !== undefined) next.title = patch.title.trim();
    if (patch.url !== undefined) {
      const url = parseWebUrl(patch.url);
      next.url = url.href;
    }
    if (patch.description !== undefined || patch.url !== undefined) {
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(card.meta || '{}') as Record<string, unknown>;
      } catch {
        /* start fresh */
      }
      if (patch.description !== undefined) meta.description = patch.description.trim().slice(0, 1000);
      if (next.url) meta.key = normalizeUrl(next.url);
      next.meta = JSON.stringify(meta);
    }
    this.store.patchCard(id, next);
  }

  listLinks(filter: LinkFilter = {}): LinkView[] {
    const rows = this.store.all(
      "SELECT id, title, url, content, meta, file_id, created_at, updated_at FROM cards WHERE kind = 'link' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5000",
    );
    const tags = this.store.tagsByCard();
    let views: LinkView[] = rows.map((r) => {
      let description = '';
      try {
        description = String((JSON.parse(r.meta) as { description?: string }).description ?? '');
      } catch {
        /* no description */
      }
      return {
        id: r.id,
        url: r.url,
        host: hostOf(r.url),
        title: r.title,
        description,
        note: docToText(r.content).replace(/\s+/g, ' ').trim(),
        fileId: r.file_id,
        tags: tags.get(r.id) ?? [],
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
    if (filter.tag) {
      const t = filter.tag.replace(/^#/, '').toLowerCase();
      views = views.filter((v) => v.tags.includes(t));
    }
    const tokens = (filter.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length) {
      const scored = views
        .map((v) => {
          let score = 0;
          for (const token of tokens) {
            const hit =
              (v.title.toLowerCase().includes(token) ? 6 : 0) + (v.tags.some((t) => t.includes(token)) ? 5 : 0) + (v.host.includes(token) ? 4 : 0) +
              (v.url.toLowerCase().includes(token) ? 3 : 0) + (v.note.toLowerCase().includes(token) ? 2 : 0) + (v.description.toLowerCase().includes(token) ? 1 : 0);
            if (!hit) return null; // every word has to match somewhere
            score += hit;
          }
          return { v, score };
        })
        .filter((x): x is { v: LinkView; score: number } => !!x);
      scored.sort((a, b) => b.score - a.score || b.v.createdAt - a.v.createdAt);
      views = scored.map((x) => x.v);
    }
    return views.slice(0, Math.min(filter.limit ?? 1000, 5000));
  }

  // ------------------------------------------------------------------ memos

  /** A quick capture: text only, no title, no ceremony. */
  addMemo(text: string): string {
    const body = String(text ?? '').trim();
    if (!body) throw new Error('Write something first.');
    if (body.length > 100_000) throw new Error('That memo is too long. Make it a card instead.');
    return this.store.createCard({ kind: 'memo', content: markdownToContent(body) });
  }

  // ------------------------------------------------------------- conversion

  /**
   * Turns a memo, note or task into another of those kinds. A memo has no title, so its first line becomes the
   * title and is removed from the body; converting to a task also gives it a status and priority.
   */
  convertCard(id: string, to: CardKind): void {
    const card = this.store.getCard(id);
    if (!card) throw new Error('That card no longer exists.');
    if (!WRITTEN_KINDS.includes(to)) throw new Error('Only notes, memos and tasks can be converted into each other.');
    if (!WRITTEN_KINDS.includes(card.kind)) throw new Error(`A ${card.kind} card cannot be converted.`);
    if (card.kind === to) return;
    const patch: Parameters<Store['patchCard']>[1] = { kind: to };
    if (!card.title.trim()) {
      const { title, content } = splitFirstLine(card.content);
      if (title) {
        patch.title = title;
        this.store.updateCard(id, { content });
      }
    }
    if (to === 'task') {
      patch.status = card.status || 'todo';
      patch.priority = card.priority || 'medium';
    }
    this.store.patchCard(id, patch);
  }
}

/** First block of a document as a plain title (max 120 chars), and the document without that block. */
export function splitFirstLine(content: string): { title: string; content: string } {
  try {
    const doc = JSON.parse(content || '{}') as { content?: { type: string; content?: unknown[] }[] };
    const first = doc.content?.[0];
    if (!first || !['paragraph', 'heading'].includes(first.type)) return { title: '', content };
    const title = docToText(JSON.stringify({ type: 'doc', content: [first] })).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) return { title: '', content };
    return { title, content: JSON.stringify({ ...doc, content: doc.content!.slice(1) }) };
  } catch {
    return { title: '', content };
  }
}
