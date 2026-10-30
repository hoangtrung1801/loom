import { z } from 'zod';
import { appendBlocks, buildMindMap, freeY, type MindNode } from './ai/tools.js';
import { docToMarkdown } from './doc.js';
import { CARD_KINDS, TASK_PRIORITIES, TASK_STATUSES, WRITTEN_KINDS, type CardKind } from './kinds.js';
import { markdownToContent } from './markdown.js';
import type { App } from './rpc.js';
import { PROP_TYPES, type PropDef } from './tagdb.js';

/**
 * Operations scripts and agents may run against a running Loom through the local API
 * (`loom` CLI, `loom mcp`, or HTTP on 127.0.0.1). Deliberately a named, validated surface:
 * markdown in, markdown out, ids that stay valid, and never raw SQL or the full RPC table.
 * Between them they read, create, change and delete every kind of object a library holds:
 * cards of each kind, whiteboards and what sits on them, connections, tags and their
 * database properties, and chats.
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
const tag = z.string().min(1).max(100);
const kind = z.enum(CARD_KINDS as unknown as [string, ...string[]]);
const status = z.enum(TASK_STATUSES);
const priority = z.enum(TASK_PRIORITIES);
const color = z.enum(['', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray']);
const propType = z.enum(PROP_TYPES);
const options = z.array(z.string().min(1).max(60)).max(100);
const coord = z.number().finite();
/** A tag-database value: text, a number, a yes/no, a list of options, or null to clear it. */
const propValue = z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.array(z.string().max(60)).max(100), z.null()]);
/** `{ "<tag>": { "<property name or id>": value } }`; a tag the card lacks is added first. */
const properties = z.record(z.string().max(100), z.record(z.string().max(100), propValue));

/** Kinds that can be made from text alone; the others hold an imported file (import those in the app). */
const CREATABLE_KINDS = ['note', 'memo', 'task', 'journal', 'link', 'web', 'highlight'] as const;

interface MindInput {
  text: string;
  children?: MindInput[];
}
const mindNode: z.ZodType<MindInput> = z.object({
  text: z.string().max(500),
  get children() {
    return z.array(mindNode).max(12).optional();
  },
});

interface Operation<S extends z.ZodType> {
  description: string;
  write: boolean;
  /** Deletes or discards something (trash can still bring cards and whiteboards back). */
  destructive?: boolean;
  input: S;
  run(app: App, input: z.infer<S>): unknown;
}
const op = <S extends z.ZodType>(o: Operation<S>): Operation<S> => o;

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const notFound = (what: string, key: string): LocalApiError => new LocalApiError(404, 'not_found', `No ${what} with id "${key}".`);

function mustCard(app: App, cardId: string) {
  const card = app.store.getCard(cardId);
  if (!card) throw notFound('card', cardId);
  return card;
}

function mustBoard(app: App, boardId: string) {
  const board = app.store.getWhiteboard(boardId);
  if (!board) throw notFound('whiteboard', boardId);
  return board;
}

function mustObject(app: App, objectId: string): { whiteboardId: string; kind: string } {
  const p = app.store.get('SELECT whiteboard_id, kind FROM placements WHERE id = ? AND deleted_at IS NULL', objectId);
  if (!p) throw notFound('whiteboard object', objectId);
  return { whiteboardId: p.whiteboard_id, kind: p.kind };
}

function mustEdge(app: App, edgeId: string): void {
  if (!app.store.get('SELECT 1 AS x FROM edges WHERE id = ? AND deleted_at IS NULL', edgeId)) throw notFound('connection', edgeId);
}

/** A card's tag-database values as `{ tag: { property: value } }`, with lists and checkboxes decoded. */
function cardProperties(app: App, cardId: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const group of app.tags.getCardProps(cardId)) {
    out[group.tag] = Object.fromEntries(group.props.map((p) => [p.name, decodeValue(p, p.value)]));
  }
  return out;
}

function decodeValue(prop: PropDef, value: string): unknown {
  if (value === '') return prop.type === 'checkbox' ? false : prop.type === 'multiselect' ? [] : null;
  if (prop.type === 'number') return Number(value);
  if (prop.type === 'checkbox') return value === '1';
  if (prop.type === 'multiselect') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  return value;
}

function encodeValue(prop: PropDef, value: z.infer<typeof propValue>): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? '1' : '';
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : '';
  if (prop.type === 'multiselect' && typeof value === 'string' && !value.trim().startsWith('[')) return value.trim() ? JSON.stringify([value.trim()]) : '';
  return String(value);
}

function findProp(app: App, rawTag: string, key: string): PropDef {
  const props = app.tags.listTagProps(rawTag);
  const prop = props.find((p) => p.id === key) ?? props.find((p) => p.name.toLowerCase() === key.trim().toLowerCase());
  if (!prop) {
    const known = props.map((p) => p.name).join(', ') || 'none yet';
    throw new LocalApiError(404, 'not_found', `#${rawTag} has no property "${key}" (it has: ${known}). Add one with addTagProperty.`);
  }
  return prop;
}

function setProperties(app: App, cardId: string, values: z.infer<typeof properties>): void {
  for (const [rawTag, byName] of Object.entries(values)) {
    for (const [key, value] of Object.entries(byName)) {
      const prop = findProp(app, rawTag, key);
      app.store.addTag(cardId, prop.tag);
      app.tags.setCardProp(cardId, prop.id, encodeValue(prop, value));
    }
  }
}

function cardAsMarkdown(app: App, cardId: string) {
  const c = mustCard(app, cardId);
  const linked = new Map(Object.entries(app.store.titlesById([...c.content.matchAll(/"cardId":"([^"]+)"/g)].map((m) => m[1]!))));
  let description: string | undefined;
  if (c.kind === 'link') {
    try {
      description = (JSON.parse(c.meta || '{}') as { description?: string }).description || undefined;
    } catch {
      /* no description */
    }
  }
  const props = cardProperties(app, cardId);
  return {
    id: c.id,
    title: c.title,
    kind: c.kind,
    tags: c.tags,
    inbox: c.inbox,
    journalDate: c.journalDate || undefined,
    url: c.url || undefined,
    description,
    status: c.status || undefined,
    priority: c.priority || undefined,
    assignee: c.assignee || undefined,
    due: c.due || undefined,
    parentId: c.parentId || undefined,
    properties: Object.keys(props).length ? props : undefined,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    markdown: docToMarkdown(c.content, (x) => linked.get(x)).lines.map((l) => l.text).join('\n'),
    backlinks: c.backlinks.map((b) => ({ id: b.id, title: b.title })),
    whiteboards: c.boards,
  };
}

function boardView(app: App, boardId: string) {
  const b = mustBoard(app, boardId);
  const objects = b.placements.map((p) => ({
    id: p.id,
    kind: p.kind,
    cardId: p.cardId || undefined,
    cardKind: p.kind === 'card' ? p.cardKind : undefined,
    whiteboardRef: p.kind === 'board' ? p.refId : undefined,
    title: p.title || undefined,
    text: p.kind === 'text' ? p.text || undefined : undefined,
    color: p.color || undefined,
    parentId: p.parentId || undefined,
    sectionId: p.sectionId || undefined,
    x: Math.round(p.x),
    y: Math.round(p.y),
    w: Math.round(p.w),
    h: Math.round(p.h),
  }));
  return {
    id: b.whiteboard.id,
    name: b.whiteboard.name,
    parentId: b.whiteboard.parentId || undefined,
    color: b.whiteboard.color || undefined,
    objects,
    connections: b.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.label || undefined, color: e.color || undefined, style: e.style, arrow: e.arrow })),
  };
}

function tagView(app: App, rawTag: string) {
  const t = app.tags.getTagTable(rawTag);
  return {
    tag: t.tag,
    color: t.color || undefined,
    collection: t.collection || undefined,
    description: t.description || undefined,
    properties: t.props.map((p) => ({ id: p.id, name: p.name, type: p.type, options: p.options.length ? p.options : undefined })),
    cards: t.rows.map((r) => ({
      id: r.cardId,
      title: r.title,
      kind: r.kind,
      values: Object.fromEntries(t.props.filter((p) => r.values[p.id] !== undefined).map((p) => [p.name, decodeValue(p, r.values[p.id]!)])),
    })),
  };
}

const ok = (objectId: string) => ({ id: objectId });

export const OPERATIONS = {
  // ------------------------------------------------------------------ read
  search: op({
    description: 'Full-text search over cards. Returns ids, titles and a snippet.',
    write: false,
    input: z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(100).optional() }),
    run: (app, i) => app.store.search(i.query, i.limit ?? 20).map((h) => ({ id: h.id, title: h.title, snippet: h.snippet.replace(/[\u0001\u0002]/g, '') })),
  }),
  searchAll: op({
    description:
      'Searches every type of object at once: cards (optionally only some kinds), whiteboards, text on whiteboards, chats and tags. Each hit says its type; open it with getObject.',
    write: false,
    input: z.object({
      query: z.string().min(1).max(500),
      types: z.array(z.enum(['card', 'whiteboard', 'text', 'chat', 'tag'])).max(5).optional(),
      kinds: z.array(kind).max(12).optional(),
      sort: z.enum(['relevance', 'time']).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: (app, i) => {
      const want = new Set(i.types ?? ['card', 'whiteboard', 'text', 'chat', 'tag']);
      return app.store
        .searchAll({ query: i.query, kinds: i.kinds as CardKind[] | undefined, whiteboards: want.has('whiteboard'), whiteboardText: want.has('text'), chats: want.has('chat'), tags: want.has('tag'), sort: i.sort, limit: i.limit ?? 30 })
        .filter((h) => want.has(h.type))
        .map((h) => ({ type: h.type, id: h.id, title: h.title, kind: h.type === 'card' ? h.kind : undefined, whiteboardId: h.type === 'text' ? h.boardId : undefined, snippet: h.snippet.replace(/[\u0001\u0002]/g, '') || undefined }));
    },
  }),
  getObject: op({
    description:
      'Reads any object by id, whatever its type: a card (as markdown), a whiteboard, an object on a whiteboard, a connection, a chat, a tag property, or a tag (by name). The result has a "type" field.',
    write: false,
    input: z.object({ id: z.string().min(1).max(200) }),
    run: (app, i) => {
      if (app.store.getCard(i.id)) return { type: 'card', ...cardAsMarkdown(app, i.id) };
      if (app.store.getWhiteboard(i.id)) return { type: 'whiteboard', ...boardView(app, i.id) };
      const placement = app.store.get('SELECT whiteboard_id FROM placements WHERE id = ? AND deleted_at IS NULL', i.id);
      if (placement) {
        const found = boardView(app, placement.whiteboard_id).objects.find((o) => o.id === i.id);
        if (found) return { type: 'object', whiteboardId: placement.whiteboard_id, ...found };
      }
      const edge = app.store.get('SELECT whiteboard_id FROM edges WHERE id = ? AND deleted_at IS NULL', i.id);
      if (edge) {
        const found = boardView(app, edge.whiteboard_id).connections.find((e) => e.id === i.id);
        if (found) return { type: 'connection', whiteboardId: edge.whiteboard_id, ...found };
      }
      const chat = app.chats.getChat(i.id);
      if (chat) return { type: 'chat', ...chat };
      const prop = app.store.get('SELECT tag FROM tag_props WHERE id = ? AND deleted_at IS NULL', i.id);
      if (prop) return { type: 'property', ...app.tags.listTagProps(prop.tag).find((p) => p.id === i.id) };
      const name = i.id.replace(/^#/, '');
      if (app.store.listTags().some((t) => t.tag === name.toLowerCase() || t.tag === name)) return { type: 'tag', ...tagView(app, name) };
      throw new LocalApiError(404, 'not_found', `Nothing has the id "${i.id}".`);
    },
  }),
  listCards: op({
    description: 'Lists cards, newest edit first. Filter by kind, tag or inbox.',
    write: false,
    input: z.object({ kind: kind.optional(), tag: z.string().max(100).optional(), inbox: z.boolean().optional(), sort: z.enum(['updated', 'created', 'title']).optional(), limit: z.number().int().min(1).max(500).optional() }),
    run: (app, i) =>
      app.store
        .listCards({ kinds: i.kind ? [i.kind as CardKind] : undefined, tag: i.tag, inbox: i.inbox, limit: i.limit ?? 50, sort: i.sort ?? 'updated' })
        .map((c) => ({ id: c.id, title: c.title, kind: c.kind, tags: c.tags, preview: c.preview, updatedAt: c.updatedAt })),
  }),
  readCard: op({
    description: 'Reads one card as markdown, by id or exact title, with its fields, tag-database values, backlinks and whiteboards.',
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
      const found = app.store.listJournals(10_000).find((j) => j.journalDate === day);
      return found ? cardAsMarkdown(app, found.id) : { journalDate: day, markdown: '' };
    },
  }),
  listTags: op({
    description: 'Lists tags with how many cards carry each.',
    write: false,
    input: z.object({}),
    run: (app) => app.store.listTags().map((t) => ({ tag: t.tag, count: t.count, collection: t.collection || undefined, description: t.description || undefined })),
  }),
  readTag: op({
    description: "Reads a tag as a database: its settings, its typed properties, and every tagged card with that card's values.",
    write: false,
    input: z.object({ tag }),
    run: (app, i) => tagView(app, i.tag),
  }),
  listWhiteboards: op({
    description: 'Lists whiteboards.',
    write: false,
    input: z.object({}),
    run: (app) => app.store.listWhiteboards().map((w) => ({ id: w.id, name: w.name, parentId: w.parentId || undefined, cardCount: w.cardCount })),
  }),
  readWhiteboard: op({
    description: 'Reads a whiteboard: its cards, sections, text, sub-whiteboards and connections with positions and ids.',
    write: false,
    input: z.object({ id }),
    run: (app, i) => boardView(app, i.id),
  }),
  listTasks: op({
    description: 'Lists tasks. Done tasks are left out unless includeDone is set.',
    write: false,
    input: z.object({ status: status.optional(), priority: priority.optional(), assignee: z.string().max(100).optional(), label: z.string().max(100).optional(), parentId: z.string().max(100).optional(), query: z.string().max(500).optional(), includeDone: z.boolean().optional(), overdue: z.boolean().optional() }),
    run: (app, i) => app.work.listTasks(i).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, assignee: t.assignee, due: t.due, labels: t.labels, parentId: t.parentId || undefined })),
  }),
  readTask: op({
    description: 'Reads a task with its body, parent, subtasks and checklist progress.',
    write: false,
    input: z.object({ id }),
    run: (app, i) => {
      const t = app.work.getTask(i.id);
      if (!t) throw notFound('task', i.id);
      return {
        ...cardAsMarkdown(app, i.id),
        progress: t.progress,
        subtasks: t.children.map((c) => ({ id: c.id, title: c.title, status: c.status })),
        parent: t.parent ?? undefined,
      };
    },
  }),
  listLinks: op({
    description: 'Lists saved links.',
    write: false,
    input: z.object({ query: z.string().max(500).optional(), tag: z.string().max(100).optional(), limit: z.number().int().min(1).max(500).optional() }),
    run: (app, i) => app.work.listLinks(i).map((l) => ({ id: l.id, title: l.title, url: l.url, description: l.description, note: l.note, tags: l.tags })),
  }),
  listChats: op({
    description: 'Lists AI chats, most recent first.',
    write: false,
    input: z.object({ limit: z.number().int().min(1).max(500).optional() }),
    run: (app, i) => app.chats.listChats(i.limit ?? 50),
  }),
  readChat: op({
    description: 'Reads an AI chat with its messages.',
    write: false,
    input: z.object({ id }),
    run: (app, i) => {
      const chat = app.chats.getChat(i.id);
      if (!chat) throw notFound('chat', i.id);
      return { ...chat, messages: chat.messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })) };
    },
  }),
  listTrash: op({
    description: 'Lists trashed cards and whiteboards (restore them with restoreCard / restoreWhiteboard).',
    write: false,
    input: z.object({}),
    run: (app) => {
      const t = app.store.listTrash();
      return { cards: t.cards.map((c) => ({ id: c.id, title: c.title, kind: c.kind })), whiteboards: t.whiteboards };
    },
  }),

  // ----------------------------------------------------------------- cards
  createNote: op({
    description: 'Creates a note card from markdown. Lands in the inbox unless inbox is false.',
    write: true,
    input: z.object({ title: z.string().max(500), markdown: markdown.optional(), tags: tags.optional(), inbox: z.boolean().optional() }),
    run: (app, i) => {
      const cardId = app.store.createCard({ title: i.title, content: i.markdown ? markdownToContent(i.markdown) : '', inbox: i.inbox ?? true });
      for (const t of i.tags ?? []) app.store.addTag(cardId, t);
      return ok(cardId);
    },
  }),
  createCard: op({
    description:
      'Creates a card of any text kind (note, memo, task, journal, link, web, highlight) with markdown, tags, task fields and tag-database values. ' +
      'journal appends to that day (date, default today); link needs url and fetches its title. PDFs, images, video, audio and files are imported in the app.',
    write: true,
    input: z.object({
      kind: z.enum(CREATABLE_KINDS).optional(),
      title: z.string().max(500).optional(),
      markdown: markdown.optional(),
      tags: tags.optional(),
      inbox: z.boolean().optional(),
      status: status.optional(),
      priority: priority.optional(),
      assignee: z.string().max(100).optional(),
      due: date.optional(),
      parentId: id.optional(),
      url: z.string().max(4000).optional(),
      date: date.optional(),
      properties: properties.optional(),
      whiteboardId: id.optional(),
    }),
    run: async (app, i) => {
      const k = i.kind ?? 'note';
      let cardId: string;
      if (k === 'task') {
        if (!i.title?.trim()) throw new LocalApiError(400, 'invalid_input', 'A task needs a title.');
        cardId = app.work.createTask({ title: i.title, description: i.markdown, status: i.status, priority: i.priority, assignee: i.assignee, due: i.due, parentId: i.parentId, labels: i.tags });
      } else if (k === 'link') {
        if (!i.url) throw new LocalApiError(400, 'invalid_input', 'A link needs a url.');
        cardId = (await app.methods.saveLink(i.url, { note: i.markdown, tags: i.tags, title: i.title })).id;
      } else if (k === 'journal') {
        cardId = app.store.ensureJournal(i.date ?? today());
        if (i.markdown) appendBlocks(app.store, cardId, i.markdown);
      } else if (k === 'memo') {
        if (!i.markdown?.trim()) throw new LocalApiError(400, 'invalid_input', 'A memo needs markdown.');
        cardId = app.work.addMemo(i.markdown);
      } else {
        cardId = app.store.createCard({ kind: k, title: i.title ?? '', content: i.markdown ? markdownToContent(i.markdown) : '', inbox: i.inbox ?? true, url: i.url });
      }
      if (k !== 'task' && k !== 'link') for (const t of i.tags ?? []) app.store.addTag(cardId, t);
      if (i.inbox !== undefined && k !== 'note' && k !== 'web' && k !== 'highlight') app.store.setInbox(cardId, i.inbox);
      if (i.properties) setProperties(app, cardId, i.properties);
      if (i.whiteboardId) {
        mustBoard(app, i.whiteboardId);
        app.store.addCardToWhiteboard(i.whiteboardId, cardId, 0, freeY(app.store, i.whiteboardId));
      }
      return ok(cardId);
    },
  }),
  updateCard: op({
    description:
      'Changes a card of any kind: title, the whole markdown body (replaced), kind (between note, memo and task), inbox, task fields, link url/description, tags to add or remove, and tag-database values. Only the fields given change.',
    write: true,
    input: z.object({
      id,
      title: z.string().max(500).optional(),
      markdown: markdown.optional(),
      kind: z.enum(WRITTEN_KINDS as unknown as [string, ...string[]]).optional(),
      inbox: z.boolean().optional(),
      status: status.optional(),
      priority: priority.optional(),
      assignee: z.string().max(100).optional(),
      due: z.union([date, z.literal('')]).optional(),
      parentId: z.string().max(100).optional(),
      url: z.string().max(4000).optional(),
      description: z.string().max(1000).optional(),
      addTags: tags.optional(),
      removeTags: tags.optional(),
      properties: properties.optional(),
    }),
    run: (app, i) => {
      const card = mustCard(app, i.id);
      if (i.kind && i.kind !== card.kind) app.work.convertCard(i.id, i.kind as CardKind);
      const kindNow = (i.kind ?? card.kind) as CardKind;
      const taskPatch = { status: i.status, priority: i.priority, assignee: i.assignee, due: i.due, parentId: i.parentId };
      if (Object.values(taskPatch).some((v) => v !== undefined)) {
        if (kindNow !== 'task') throw new LocalApiError(400, 'invalid_input', 'status, priority, assignee, due and parentId belong to tasks; set kind "task" first.');
        app.work.updateTask(i.id, taskPatch);
      }
      if (i.url !== undefined || i.description !== undefined) {
        if (kindNow !== 'link') throw new LocalApiError(400, 'invalid_input', 'url and description belong to saved links.');
        app.work.updateLink(i.id, { url: i.url, description: i.description });
      }
      if (i.title !== undefined) app.store.patchCard(i.id, { title: i.title });
      if (i.markdown !== undefined) app.store.updateCard(i.id, { content: markdownToContent(i.markdown) });
      if (i.inbox !== undefined) app.store.setInbox(i.id, i.inbox);
      for (const t of i.addTags ?? []) app.store.addTag(i.id, t);
      for (const t of i.removeTags ?? []) app.store.removeTag(i.id, t);
      if (i.properties) setProperties(app, i.id, i.properties);
      return ok(i.id);
    },
  }),
  appendToCard: op({
    description: 'Appends markdown to the end of a card.',
    write: true,
    input: z.object({ id, markdown: markdown.min(1) }),
    run: (app, i) => {
      mustCard(app, i.id);
      appendBlocks(app.store, i.id, i.markdown);
      return ok(i.id);
    },
  }),
  appendToJournal: op({
    description: "Appends markdown to a day's journal (today by default), creating the day if needed.",
    write: true,
    input: z.object({ date: date.optional(), markdown: markdown.min(1) }),
    run: (app, i) => {
      const cardId = app.store.ensureJournal(i.date ?? today());
      appendBlocks(app.store, cardId, i.markdown);
      return ok(cardId);
    },
  }),
  trashCard: op({
    description: 'Moves a card to the trash and takes it off every whiteboard. restoreCard brings it back.',
    write: true,
    destructive: true,
    input: z.object({ id }),
    run: (app, i) => {
      mustCard(app, i.id);
      app.store.trashCard(i.id);
      return ok(i.id);
    },
  }),
  restoreCard: op({ description: 'Brings a card back from the trash.', write: true, input: z.object({ id }), run: (app, i) => (app.store.restoreCard(i.id), ok(i.id)) }),
  addMemo: op({ description: 'Captures a quick memo.', write: true, input: z.object({ text: z.string().min(1).max(20_000) }), run: (app, i) => ok(app.work.addMemo(i.text)) }),
  createTask: op({
    description: 'Creates a task. Acceptance criteria become a checklist.',
    write: true,
    input: z.object({
      title: z.string().min(1).max(500),
      description: markdown.optional(),
      status: status.optional(),
      priority: priority.optional(),
      assignee: z.string().max(100).optional(),
      due: date.optional(),
      parentId: id.optional(),
      labels: tags.optional(),
      acceptance: z.array(z.string().min(1).max(500)).max(50).optional(),
      plan: markdown.optional(),
    }),
    run: (app, i) => ok(app.work.createTask(i)),
  }),
  updateTask: op({
    description: "Changes a task's title, status, priority, assignee, due date or parent.",
    write: true,
    input: z.object({ id, title: z.string().min(1).max(500).optional(), status: status.optional(), priority: priority.optional(), assignee: z.string().max(100).optional(), due: z.union([date, z.literal('')]).optional(), parentId: z.string().max(100).optional() }),
    run: (app, { id: taskId, ...patch }) => {
      mustCard(app, taskId);
      app.work.updateTask(taskId, patch);
      return ok(taskId);
    },
  }),
  saveLink: op({
    description: 'Saves a web link; Loom fetches its title, description and preview image.',
    write: true,
    input: z.object({ url: z.string().min(1).max(4000), note: z.string().max(20_000).optional(), tags: tags.optional(), title: z.string().max(500).optional() }),
    run: (app, i) => app.methods.saveLink(i.url, { note: i.note, tags: i.tags, title: i.title }),
  }),
  addTag: op({
    description: 'Adds a tag to a card.',
    write: true,
    input: z.object({ id, tag }),
    run: (app, i) => {
      mustCard(app, i.id);
      app.store.addTag(i.id, i.tag);
      return ok(i.id);
    },
  }),
  removeTag: op({
    description: 'Removes a tag from a card.',
    write: true,
    input: z.object({ id, tag }),
    run: (app, i) => {
      mustCard(app, i.id);
      app.store.removeTag(i.id, i.tag);
      return ok(i.id);
    },
  }),

  // ------------------------------------------------- tags as databases
  updateTag: op({
    description: "Sets a tag's color, collection (a group in the tag list) or description. Creates the tag's database entry if needed.",
    write: true,
    input: z.object({ tag, color: color.optional(), collection: z.string().max(80).optional(), description: z.string().max(2000).optional() }),
    run: (app, { tag: name, ...patch }) => (app.tags.setTagDef(name, patch), { tag: name }),
  }),
  renameTag: op({
    description: 'Renames a tag on every card, keeping its properties and values. Renaming onto an existing tag merges them.',
    write: true,
    input: z.object({ from: tag, to: tag }),
    run: (app, i) => (app.tags.renameTag(i.from, i.to), { tag: i.to }),
  }),
  deleteTag: op({
    description: 'Deletes a tag: removes it from every card along with its properties. The cards stay.',
    write: true,
    destructive: true,
    input: z.object({ tag }),
    run: (app, i) => (app.tags.deleteTag(i.tag), { tag: i.tag }),
  }),
  addTagProperty: op({
    description: `Adds a typed property (a database column) to a tag. Types: ${PROP_TYPES.join(', ')}; select and multiselect take options.`,
    write: true,
    input: z.object({ tag, name: z.string().min(1).max(80), type: propType.optional(), options: options.optional() }),
    run: (app, i) => ok(app.tags.addTagProp(i.tag, { name: i.name, type: i.type, options: i.options })),
  }),
  updateTagProperty: op({
    description: "Renames a tag property or changes its type or options. Identify it by id, or by tag and current name.",
    write: true,
    input: z
      .object({ id: id.optional(), tag: tag.optional(), property: z.string().max(80).optional(), name: z.string().min(1).max(80).optional(), type: propType.optional(), options: options.optional() })
      .refine((v) => v.id || (v.tag && v.property), 'Give the property id, or tag and property.'),
    run: (app, i) => {
      const propId = i.id ?? findProp(app, i.tag!, i.property!).id;
      app.tags.updateTagProp(propId, { name: i.name, type: i.type, options: i.options });
      return ok(propId);
    },
  }),
  removeTagProperty: op({
    description: "Removes a tag property and every card's value for it. Identify it by id, or by tag and name.",
    write: true,
    destructive: true,
    input: z.object({ id: id.optional(), tag: tag.optional(), property: z.string().max(80).optional() }).refine((v) => v.id || (v.tag && v.property), 'Give the property id, or tag and property.'),
    run: (app, i) => {
      const propId = i.id ?? findProp(app, i.tag!, i.property!).id;
      if (!app.store.get('SELECT 1 AS x FROM tag_props WHERE id = ? AND deleted_at IS NULL', propId)) throw notFound('property', propId);
      app.tags.removeTagProp(propId);
      return ok(propId);
    },
  }),
  setCardProperty: op({
    description: "Sets one tag-database value on a card (adds the tag if the card lacks it). value: text, number, true/false, a list for multiselect, or null to clear.",
    write: true,
    input: z.object({ id, tag, property: z.string().min(1).max(100), value: propValue }),
    run: (app, i) => {
      mustCard(app, i.id);
      setProperties(app, i.id, { [i.tag]: { [i.property]: i.value } });
      return ok(i.id);
    },
  }),

  // ---------------------------------------------------------- whiteboards
  createWhiteboard: op({
    description: 'Creates a whiteboard, optionally inside another one.',
    write: true,
    input: z.object({ name: z.string().min(1).max(200), parentId: id.optional() }),
    run: (app, i) => ok(app.store.createWhiteboard(i.name, i.parentId ?? '')),
  }),
  updateWhiteboard: op({
    description: 'Renames a whiteboard, changes its color, or moves it under another whiteboard (parentId "" for the top level).',
    write: true,
    input: z.object({ id, name: z.string().min(1).max(200).optional(), color: color.optional(), parentId: z.string().max(100).optional() }),
    run: (app, i) => {
      mustBoard(app, i.id);
      if (i.name !== undefined) app.store.renameWhiteboard(i.id, i.name);
      if (i.color !== undefined) app.store.setWhiteboardColor(i.id, i.color);
      if (i.parentId !== undefined) app.store.moveWhiteboard(i.id, i.parentId);
      return ok(i.id);
    },
  }),
  trashWhiteboard: op({
    description: 'Moves a whiteboard to the trash. Its cards are kept; sub-whiteboards move up a level.',
    write: true,
    destructive: true,
    input: z.object({ id }),
    run: (app, i) => (app.store.trashWhiteboard(i.id), ok(i.id)),
  }),
  restoreWhiteboard: op({ description: 'Brings a whiteboard back from the trash.', write: true, input: z.object({ id }), run: (app, i) => (app.store.restoreWhiteboard(i.id), ok(i.id)) }),
  addCardToWhiteboard: op({
    description: 'Places an existing card on a whiteboard (below everything else unless x and y are given). Returns the new object id.',
    write: true,
    input: z.object({ whiteboardId: id, cardId: id, x: coord.optional(), y: coord.optional(), sectionId: id.optional() }),
    run: (app, i) => {
      mustCard(app, i.cardId);
      mustBoard(app, i.whiteboardId);
      const objectId = app.store.addCardToWhiteboard(i.whiteboardId, i.cardId, i.x ?? 0, i.y ?? freeY(app.store, i.whiteboardId));
      if (i.sectionId) app.store.updatePlacements([{ id: objectId, sectionId: i.sectionId }]);
      return ok(objectId);
    },
  }),
  addWhiteboardObject: op({
    description:
      'Adds a text box, a section (a titled area that groups what is inside it) or a shortcut to a sub-whiteboard ("board"; without whiteboardRef a new sub-whiteboard named by text is created). Returns the object id.',
    write: true,
    input: z.object({
      whiteboardId: id,
      kind: z.enum(['text', 'section', 'board']),
      text: z.string().max(20_000).optional(),
      x: coord.optional(),
      y: coord.optional(),
      w: coord.optional(),
      h: coord.optional(),
      color: color.optional(),
      whiteboardRef: id.optional(),
      sectionId: id.optional(),
      size: z.number().int().min(8).max(96).optional(),
    }),
    run: (app, i) => {
      mustBoard(app, i.whiteboardId);
      const objectId = app.store.addObject(i.whiteboardId, { kind: i.kind, text: i.text, x: i.x ?? 0, y: i.y ?? freeY(app.store, i.whiteboardId), w: i.w, h: i.h, color: i.color, refId: i.whiteboardRef, size: i.size });
      if (i.sectionId) app.store.updatePlacements([{ id: objectId, sectionId: i.sectionId }]);
      return ok(objectId);
    },
  }),
  updateWhiteboardObject: op({
    description: 'Moves, resizes, recolors or re-texts an object on a whiteboard, or puts it in a section (sectionId "" takes it out).',
    write: true,
    input: z.object({ id, x: coord.optional(), y: coord.optional(), w: coord.optional(), h: coord.optional(), text: z.string().max(20_000).optional(), color: color.optional(), sectionId: z.string().max(100).optional(), size: z.number().int().min(8).max(96).optional() }),
    run: (app, { id: objectId, ...patch }) => {
      const o = mustObject(app, objectId);
      if (patch.sectionId) {
        const s = mustObject(app, patch.sectionId);
        if (s.kind !== 'section' || s.whiteboardId !== o.whiteboardId) throw new LocalApiError(400, 'invalid_input', 'sectionId must be a section on the same whiteboard.');
      }
      app.store.updatePlacements([{ id: objectId, ...patch }]);
      return ok(objectId);
    },
  }),
  removeWhiteboardObjects: op({
    description: 'Removes objects from their whiteboard (cards stay in the library) along with their connections.',
    write: true,
    destructive: true,
    input: z.object({ ids: z.array(id).min(1).max(500) }),
    run: (app, i) => {
      for (const x of i.ids) mustObject(app, x);
      app.store.removePlacements(i.ids);
      return { ids: i.ids };
    },
  }),
  createConnection: op({
    description: 'Connects two objects on the same whiteboard (object ids from readWhiteboard), with an optional label and style.',
    write: true,
    input: z.object({ whiteboardId: id, from: id, to: id, label: z.string().max(200).optional(), color: color.optional(), style: z.enum(['solid', 'dashed', 'dotted']).optional(), arrow: z.enum(['none', 'end', 'start', 'both']).optional() }),
    run: (app, i) => ok(app.store.createEdge(i.whiteboardId, i.from, i.to, { label: i.label, color: i.color, style: i.style, arrow: i.arrow })),
  }),
  updateConnection: op({
    description: "Changes a connection's label, color, line style or arrows.",
    write: true,
    input: z.object({ id, label: z.string().max(200).optional(), color: color.optional(), style: z.enum(['solid', 'dashed', 'dotted']).optional(), arrow: z.enum(['none', 'end', 'start', 'both']).optional() }),
    run: (app, { id: edgeId, ...patch }) => {
      mustEdge(app, edgeId);
      app.store.updateEdge(edgeId, patch);
      return ok(edgeId);
    },
  }),
  deleteConnection: op({
    description: 'Deletes a connection between two whiteboard objects.',
    write: true,
    destructive: true,
    input: z.object({ id }),
    run: (app, i) => {
      mustEdge(app, i.id);
      app.store.deleteEdge(i.id);
      return ok(i.id);
    },
  }),
  createMindMap: op({
    description: 'Lays out a mind map (a tree of text nodes, up to 5 levels and 12 children each) on a whiteboard. Returns the root object id.',
    write: true,
    input: z.object({ whiteboardId: id, tree: mindNode, x: coord.optional(), y: coord.optional() }),
    run: (app, i) => {
      mustBoard(app, i.whiteboardId);
      return ok(buildMindMap(app.store, i.whiteboardId, i.tree as MindNode, i.x !== undefined && i.y !== undefined ? { x: i.x, y: i.y } : undefined));
    },
  }),

  // ----------------------------------------------------------------- chats
  renameChat: op({
    description: 'Renames an AI chat.',
    write: true,
    input: z.object({ id, title: z.string().max(200) }),
    run: (app, i) => (app.chats.renameChat(i.id, i.title), ok(i.id)),
  }),
  deleteChat: op({ description: 'Deletes an AI chat.', write: true, destructive: true, input: z.object({ id }), run: (app, i) => (app.chats.deleteChat(i.id), ok(i.id)) }),
} satisfies Record<string, Operation<z.ZodType>>;

export type OperationName = keyof typeof OPERATIONS;

export const describeOperations = () =>
  Object.entries(OPERATIONS).map(([name, o]) => ({
    name,
    description: o.description,
    write: o.write,
    destructive: (o as Operation<z.ZodType>).destructive ?? false,
    input: z.toJSONSchema(o.input as z.ZodType, { unrepresentable: 'any' }),
  }));

/** Errors the core raises for missing records (as opposed to bad input or a bug). */
const MISSING = /not found|no longer exists|not in the trash|is not a saved link/i;

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
      const message = err instanceof Error ? err.message : String(err);
      // The core refuses things with plain Errors whose message is meant for people; pass those on as client errors.
      // Anything else (a TypeError, say) is a bug and stays a 500.
      if (err instanceof Error && err.constructor === Error) {
        if (MISSING.test(message)) return { status: 404, body: { error: message, code: 'not_found', retryable: false } };
        return { status: 422, body: { error: message, code: 'rejected', retryable: false } };
      }
      return { status: 500, body: { error: message, code: 'failed', retryable: false } };
    }
  };
}
