import { z } from 'zod';
import { appendBlocks, freeY } from './ai/tools.js';
import { docToMarkdown } from './doc.js';
import { CARD_KINDS, TASK_PRIORITIES, TASK_STATUSES } from './kinds.js';
import { markdownToContent } from './markdown.js';
import type { App } from './rpc.js';

/**
 * Operations scripts and agents may run against a running Loom through the local API
 * (`loom` CLI, or HTTP on 127.0.0.1). Deliberately a small, named, validated surface:
 * markdown in, markdown out, ids that stay valid, and never raw SQL or the full RPC table.
 */
export interface LocalResult {
  status: number;
  body: unknown;
}

export class LocalApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const id = z.string().min(1).max(100);
const markdown = z.string().max(500_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates look like 2026-01-31');
const tags = z.array(z.string().min(1).max(100)).max(50);
const kind = z.enum(CARD_KINDS as unknown as [string, ...string[]]);
const status = z.enum(TASK_STATUSES);
const priority = z.enum(TASK_PRIORITIES);

interface Operation<S extends z.ZodType> {
  description: string;
  write: boolean;
  input: S;
  run(app: App, input: z.infer<S>): unknown;
}
const op = <S extends z.ZodType>(o: Operation<S>): Operation<S> => o;

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function mustCard(app: App, cardId: string) {
  const card = app.store.getCard(cardId);
  if (!card) throw new LocalApiError(404, 'not_found', `No card with id "${cardId}".`);
  return card;
}

function cardAsMarkdown(app: App, cardId: string) {
  const c = mustCard(app, cardId);
  const linked = new Map(Object.entries(app.store.titlesById([...c.content.matchAll(/"cardId":"([^"]+)"/g)].map((m) => m[1]!))));
  return {
    id: c.id,
    title: c.title,
    kind: c.kind,
    tags: c.tags,
    journalDate: c.journalDate || undefined,
    url: c.url || undefined,
    status: c.status || undefined,
    priority: c.priority || undefined,
    assignee: c.assignee || undefined,
    due: c.due || undefined,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    markdown: docToMarkdown(c.content, (x) => linked.get(x)).lines.map((l) => l.text).join('\n'),
    backlinks: c.backlinks.map((b) => ({ id: b.id, title: b.title })),
    whiteboards: c.boards,
  };
}

export const OPERATIONS = {
  // ------------------------------------------------------------------ read
  search: op({
    description: 'Full-text search over cards. Returns ids, titles and a snippet.',
    write: false,
    input: z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(100).optional() }),
    run: (app, i) => app.store.search(i.query, i.limit ?? 20).map((h) => ({ id: h.id, title: h.title, snippet: h.snippet.replace(/[\u0001\u0002]/g, '') })),
  }),
  listCards: op({
    description: 'Lists cards, newest edit first. Filter by kind, tag or inbox.',
    write: false,
    input: z.object({ kind: kind.optional(), tag: z.string().max(100).optional(), inbox: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional() }),
    run: (app, i) =>
      app.store
        .listCards({ kinds: i.kind ? [i.kind as never] : undefined, tag: i.tag, inbox: i.inbox, limit: i.limit ?? 50, sort: 'updated' })
        .map((c) => ({ id: c.id, title: c.title, kind: c.kind, tags: c.tags, preview: c.preview, updatedAt: c.updatedAt })),
  }),
  readCard: op({
    description: 'Reads one card as markdown, by id or exact title.',
    write: false,
    input: z.object({ id: id.optional(), title: z.string().min(1).max(500).optional() }).refine((v) => v.id || v.title, 'Give an id or a title.'),
    run: (app, i) => {
      const cardId = i.id ?? app.store.findCardByTitle(i.title!);
      if (!cardId) throw new LocalApiError(404, 'not_found', `No card titled "${i.title}".`);
      return cardAsMarkdown(app, cardId);
    },
  }),
  readJournal: op({
    description: "Reads a day's journal as markdown (today when no date is given).",
    write: false,
    input: z.object({ date: date.optional() }),
    run: (app, i) => {
      const day = i.date ?? today();
      const found = app.store.listJournals().find((j) => j.journalDate === day);
      return found ? cardAsMarkdown(app, found.id) : { journalDate: day, markdown: '' };
    },
  }),
  listTags: op({ description: 'Lists tags with how many cards carry each.', write: false, input: z.object({}), run: (app) => app.store.listTags().map((t) => ({ tag: t.tag, count: t.count })) }),
  listWhiteboards: op({
    description: 'Lists whiteboards.',
    write: false,
    input: z.object({}),
    run: (app) => app.store.listWhiteboards().map((w) => ({ id: w.id, name: w.name, parentId: w.parentId || undefined })),
  }),
  readWhiteboard: op({
    description: 'Reads a whiteboard: its cards, sections, text and connections with positions.',
    write: false,
    input: z.object({ id }),
    run: (app, i) => {
      const b = app.store.getWhiteboard(i.id);
      if (!b) throw new LocalApiError(404, 'not_found', `No whiteboard with id "${i.id}".`);
      const objects = b.placements.map((p) => ({
        id: p.id,
        kind: p.kind,
        cardId: p.cardId || undefined,
        title: p.title || undefined,
        text: p.text || undefined,
        sectionId: p.sectionId || undefined,
        x: Math.round(p.x),
        y: Math.round(p.y),
        w: Math.round(p.w),
        h: Math.round(p.h),
      }));
      return { id: b.whiteboard.id, name: b.whiteboard.name, objects, connections: b.edges.map((e) => ({ from: e.from, to: e.to, label: e.label || undefined })) };
    },
  }),
  listTasks: op({
    description: 'Lists tasks. Done tasks are left out unless includeDone is set.',
    write: false,
    input: z.object({ status: status.optional(), priority: priority.optional(), assignee: z.string().max(100).optional(), label: z.string().max(100).optional(), query: z.string().max(500).optional(), includeDone: z.boolean().optional(), overdue: z.boolean().optional() }),
    run: (app, i) => app.work.listTasks(i).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, assignee: t.assignee, due: t.due, labels: t.labels, parentId: t.parentId || undefined })),
  }),
  listLinks: op({
    description: 'Lists saved links.',
    write: false,
    input: z.object({ query: z.string().max(500).optional(), tag: z.string().max(100).optional(), limit: z.number().int().min(1).max(500).optional() }),
    run: (app, i) => app.work.listLinks(i).map((l) => ({ id: l.id, title: l.title, url: l.url, description: l.description, note: l.note, tags: l.tags })),
  }),

  // ----------------------------------------------------------------- write
  createNote: op({
    description: 'Creates a note card from markdown. Lands in the inbox unless inbox is false.',
    write: true,
    input: z.object({ title: z.string().max(500), markdown: markdown.optional(), tags: tags.optional(), inbox: z.boolean().optional() }),
    run: (app, i) => {
      const cardId = app.store.createCard({ title: i.title, content: i.markdown ? markdownToContent(i.markdown) : '', inbox: i.inbox ?? true });
      for (const t of i.tags ?? []) app.store.addTag(cardId, t);
      return { id: cardId };
    },
  }),
  appendToCard: op({
    description: 'Appends markdown to the end of a card.',
    write: true,
    input: z.object({ id, markdown: markdown.min(1) }),
    run: (app, i) => {
      mustCard(app, i.id);
      appendBlocks(app.store, i.id, i.markdown);
      return { id: i.id };
    },
  }),
  appendToJournal: op({
    description: "Appends markdown to a day's journal (today by default), creating the day if needed.",
    write: true,
    input: z.object({ date: date.optional(), markdown: markdown.min(1) }),
    run: (app, i) => {
      const cardId = app.store.ensureJournal(i.date ?? today());
      appendBlocks(app.store, cardId, i.markdown);
      return { id: cardId };
    },
  }),
  addMemo: op({ description: 'Captures a quick memo.', write: true, input: z.object({ text: z.string().min(1).max(20_000) }), run: (app, i) => ({ id: app.work.addMemo(i.text) }) }),
  createTask: op({
    description: 'Creates a task.',
    write: true,
    input: z.object({ title: z.string().min(1).max(500), description: markdown.optional(), status: status.optional(), priority: priority.optional(), assignee: z.string().max(100).optional(), due: date.optional(), parentId: id.optional(), labels: tags.optional() }),
    run: (app, i) => ({ id: app.work.createTask(i) }),
  }),
  updateTask: op({
    description: "Changes a task's title, status, priority, assignee, due date or parent.",
    write: true,
    input: z.object({ id, title: z.string().min(1).max(500).optional(), status: status.optional(), priority: priority.optional(), assignee: z.string().max(100).optional(), due: z.union([date, z.literal('')]).optional(), parentId: z.string().max(100).optional() }),
    run: (app, { id: taskId, ...patch }) => {
      mustCard(app, taskId);
      app.work.updateTask(taskId, patch);
      return { id: taskId };
    },
  }),
  saveLink: op({
    description: 'Saves a web link; Loom fetches its title, description and preview image.',
    write: true,
    input: z.object({ url: z.string().min(1).max(4000), note: z.string().max(20_000).optional(), tags: tags.optional() }),
    run: (app, i) => app.methods.saveLink(i.url, { note: i.note, tags: i.tags }),
  }),
  addTag: op({
    description: 'Adds a tag to a card.',
    write: true,
    input: z.object({ id, tag: z.string().min(1).max(100) }),
    run: (app, i) => {
      mustCard(app, i.id);
      app.store.addTag(i.id, i.tag);
      return { id: i.id };
    },
  }),
  createWhiteboard: op({ description: 'Creates a whiteboard.', write: true, input: z.object({ name: z.string().min(1).max(200) }), run: (app, i) => ({ id: app.store.createWhiteboard(i.name) }) }),
  addCardToWhiteboard: op({
    description: 'Places an existing card on a whiteboard (below everything else unless x and y are given).',
    write: true,
    input: z.object({ whiteboardId: id, cardId: id, x: z.number().finite().optional(), y: z.number().finite().optional() }),
    run: (app, i) => {
      mustCard(app, i.cardId);
      if (!app.store.getWhiteboard(i.whiteboardId)) throw new LocalApiError(404, 'not_found', `No whiteboard with id "${i.whiteboardId}".`);
      return { id: app.store.addCardToWhiteboard(i.whiteboardId, i.cardId, i.x ?? 0, i.y ?? freeY(app.store, i.whiteboardId)) };
    },
  }),
} satisfies Record<string, Operation<z.ZodType>>;

export type OperationName = keyof typeof OPERATIONS;

export const describeOperations = () =>
  Object.entries(OPERATIONS).map(([name, o]) => ({ name, description: o.description, write: o.write, input: z.toJSONSchema(o.input as z.ZodType, { unrepresentable: 'any' }) }));

/**
 * Runs named operations against the core. Writes go through a single queue so two scripts
 * can't interleave halfway through an async write (saving a link awaits the network).
 */
export function createLocalApi(app: App): (operation: string, input: unknown) => Promise<LocalResult> {
  let writes: Promise<unknown> = Promise.resolve();
  return async (operation, input) => {
    try {
      if (operation === 'operations') return { status: 200, body: describeOperations() };
      const o = Object.hasOwn(OPERATIONS, operation) ? (OPERATIONS as Record<string, Operation<z.ZodType>>)[operation] : undefined;
      if (!o) throw new LocalApiError(404, 'unknown_operation', `Unknown operation "${operation}". GET /operations lists them.`);
      const parsed = o.input.safeParse(input ?? {});
      if (!parsed.success) throw new LocalApiError(400, 'invalid_input', parsed.error.issues.map((x) => `${x.path.join('.') || 'input'}: ${x.message}`).join('; '));
      const run = (): unknown => o.run(app, parsed.data);
      if (!o.write) return { status: 200, body: await run() };
      const result = writes.then(run, run);
      writes = result.catch(() => undefined);
      return { status: 200, body: await result };
    } catch (err) {
      if (err instanceof LocalApiError) return { status: err.status, body: { error: err.message, code: err.code, retryable: false } };
      return { status: 500, body: { error: err instanceof Error ? err.message : String(err), code: 'failed', retryable: false } };
    }
  };
}
