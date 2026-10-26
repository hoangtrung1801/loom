import type { DocNode } from '../doc.js';
import { parseDoc } from '../doc.js';
import { TASK_PRIORITIES, TASK_STATUSES } from '../kinds.js';
import { markdownToContent } from '../markdown.js';
import type { Store } from '../store.js';
import { CARD_KINDS, normalizeTag, type CardKind } from '../store.js';
import { loadCardText, readCard, type CardText } from './context.js';
import type { Handles } from './handles.js';
import type { ToolSpec } from './provider.js';
import { estimateTokens } from './tokens.js';
import { Work, type WorkTask } from '../work.js';
import { serializeBoard } from './whiteboardText.js';

/** Everything one agent run shares: what the model has been shown and what it changed. */
export interface Run {
  store: Store;
  handles: Handles;
  /** Cards the model has read, keyed by card id; citations resolve against these. */
  read: Map<string, CardText>;
  allowWrites: boolean;
  /** Short human-readable descriptions of what the run changed. */
  changes: string[];
}

interface Tool {
  spec: ToolSpec;
  write?: boolean;
  /** One-line description for the activity trail. */
  describe(args: Record<string, unknown>): string;
  run(args: Record<string, unknown>, run: Run): string;
}

const MAX_RESULT_TOKENS = 12_000;
const str = (v: unknown, max = 20_000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined);
const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false });

function card(run: Run, handle: unknown): CardText {
  const id = run.handles.resolve(handle, 'c') ?? (typeof handle === 'string' && run.store.get('SELECT 1 AS x FROM cards WHERE id = ? AND deleted_at IS NULL', handle) ? handle : undefined);
  if (!id) throw new Error(`Unknown card "${String(handle)}". Use a handle (c1, c2…) returned by a search or read.`);
  const cached = run.read.get(id);
  if (cached) return cached;
  const text = loadCardText(run.store, run.handles, id);
  if (!text) throw new Error('That card no longer exists.');
  run.read.set(id, text);
  return text;
}
function boardId(run: Run, handle: unknown): string {
  const id = run.handles.resolve(handle, 'w');
  if (!id || !run.store.getWhiteboard(id)) throw new Error(`Unknown whiteboard "${String(handle)}". Use a handle (w1…) from list_whiteboards or read_whiteboard.`);
  return id;
}
function placementId(run: Run, handle: unknown): string {
  const id = run.handles.resolve(handle, 'p');
  if (!id) throw new Error(`Unknown whiteboard object "${String(handle)}". Use a handle (p1…) from read_whiteboard.`);
  return id;
}

function appendBlocks(store: Store, id: string, markdown: string): void {
  const existing = store.getCard(id);
  if (!existing) throw new Error('That card no longer exists.');
  const base = parseDoc(existing.content) ?? { type: 'doc', content: [] };
  const extra = parseDoc(markdownToContent(markdown));
  const merged: DocNode = { type: 'doc', content: [...(base.content ?? []), ...(extra?.content ?? [])] };
  store.updateCard(id, { content: JSON.stringify(merged) });
}

/** Free space below everything already on a board. */
function freeY(store: Store, id: string): number {
  const b = store.getWhiteboard(id);
  return b && b.placements.length ? Math.max(...b.placements.map((p) => p.y + p.h)) + 80 : 0;
}

export interface MindNode {
  text: string;
  children?: MindNode[];
}

/** Lays a tree out left to right on a board, each parent centred on its children; returns the root placement id. */
export function buildMindMap(store: Store, board: string, tree: MindNode, origin?: { x: number; y: number }): string {
  const x0 = origin?.x ?? 0;
  const y0 = origin?.y ?? freeY(store, board);
  const kids = (n: MindNode, depth: number): MindNode[] => (depth < 5 ? (n.children ?? []).slice(0, 12) : []);
  const rows = (n: MindNode, depth: number): number => {
    const k = kids(n, depth);
    return k.length ? k.reduce((sum, c) => sum + rows(c, depth + 1), 0) : 1;
  };
  const size = (n: MindNode, depth: number): number => 1 + kids(n, depth).reduce((sum, c) => sum + size(c, depth + 1), 0);
  if (size(tree, 0) > 120) throw new Error('That mind map is too large (over 120 nodes).');
  const place = (n: MindNode, depth: number, top: number, parent: string): string => {
    const y = y0 + (top + (rows(n, depth) - 1) / 2) * 80;
    const id = store.addObject(board, { kind: 'text', x: x0 + depth * 300, y, w: 240, h: 56, text: str(n.text, 300) || '…', parentId: parent });
    let row = top;
    for (const child of kids(n, depth)) {
      place(child, depth + 1, row, id);
      row += rows(child, depth + 1);
    }
    return id;
  };
  return place(tree, 0, 0, '');
}

function search(args: Record<string, unknown>, run: Run): string {
  const query = str(args.query, 300).trim();
  if (!query) throw new Error('query is required.');
  const kinds = Array.isArray(args.kinds) ? (args.kinds.filter((k): k is CardKind => CARD_KINDS.includes(k as CardKind)) as CardKind[]) : undefined;
  const hits = run.store.searchAll({ query, kinds, limit: Math.min(int(args.limit) ?? 10, 25), whiteboards: true, whiteboardText: false, chats: false, tags: false });
  if (!hits.length) return 'No matches.';
  return hits
    .map((h) => {
      const handle = h.type === 'whiteboard' ? run.handles.short('w', h.id) : run.handles.short('c', h.id);
      const snippet = h.snippet.replace(/[\u0001\u0002]/g, '').replace(/\s+/g, ' ').slice(0, 200);
      return `${handle} ${h.type === 'whiteboard' ? 'whiteboard' : `card (${h.kind})`} "${h.title || 'Untitled'}"${snippet ? ` — ${snippet}` : ''}`;
    })
    .join('\n');
}

export const TOOLS: Tool[] = [
  {
    spec: {
      name: 'search_notes',
      description: 'Full-text search over the user\'s cards and whiteboards. Returns handles you can pass to read_card / read_whiteboard.',
      schema: obj({ query: { type: 'string' }, kinds: { type: 'array', items: { type: 'string', enum: [...CARD_KINDS] } }, limit: { type: 'integer' } }, ['query']),
    },
    describe: (a) => `Searched notes for “${str(a.query, 60)}”`,
    run: search,
  },
  {
    spec: {
      name: 'read_card',
      description: 'Read a card as numbered markdown lines. Cite what you use as [c1:12-14] (handle, then line range). Paginate with offset/limit, or fetch specific blocks with blockIds.',
      schema: obj({ card: { type: 'string', description: 'Card handle, e.g. c1' }, offset: { type: 'integer' }, limit: { type: 'integer' }, blockIds: { type: 'array', items: { type: 'string' } } }, ['card']),
    },
    describe: (a) => `Read card ${str(a.card, 20)}`,
    run: (a, run) => readCard(card(run, a.card), { offset: int(a.offset), limit: int(a.limit), blockIds: Array.isArray(a.blockIds) ? a.blockIds.map((b) => str(b, 80)) : undefined }).text,
  },
  {
    spec: {
      name: 'read_backlinks',
      description: 'List cards that link to a card, with the block that contains each link.',
      schema: obj({ card: { type: 'string' } }, ['card']),
    },
    describe: (a) => `Read backlinks of ${str(a.card, 20)}`,
    run: (a, run) => {
      const c = card(run, a.card);
      const links = run.store.cardsMentioning(c.id);
      return links.length ? links.map((l) => `${run.handles.short('c', l.id)} "${l.title || 'Untitled'}": ${l.text.slice(0, 160)}`).join('\n') : 'No backlinks.';
    },
  },
  {
    spec: { name: 'list_whiteboards', description: 'List all whiteboards with their handles and card counts.', schema: obj({}) },
    describe: () => 'Listed whiteboards',
    run: (_a, run) => {
      const boards = run.store.listWhiteboards();
      return boards.length ? boards.map((b) => `${run.handles.short('w', b.id)} "${b.name || 'Untitled'}" (${b.cardCount} cards)${b.parentId ? ' sub-whiteboard' : ''}`).join('\n') : 'No whiteboards.';
    },
  },
  {
    spec: {
      name: 'read_whiteboard',
      description: 'Read a whiteboard as a tree: sections contain cards, text and mind-map nodes, then connections. mode "layout" adds coordinates.',
      schema: obj({ whiteboard: { type: 'string' }, mode: { type: 'string', enum: ['content', 'layout'] } }, ['whiteboard']),
    },
    describe: (a) => `Read whiteboard ${str(a.whiteboard, 20)}`,
    run: (a, run) => serializeBoard(run.store, run.handles, boardId(run, a.whiteboard), { mode: a.mode === 'layout' ? 'layout' : 'content' }) ?? 'Whiteboard not found.',
  },
  {
    spec: { name: 'list_tags', description: 'List all tags with how many cards use each.', schema: obj({}) },
    describe: () => 'Listed tags',
    run: (_a, run) => run.store.listTags().map((t) => `#${t.tag} (${t.count})`).join(', ') || 'No tags.',
  },
  {
    spec: {
      name: 'cards_with_tag',
      description: 'List the cards that carry a tag.',
      schema: obj({ tag: { type: 'string' } }, ['tag']),
    },
    describe: (a) => `Listed cards tagged #${str(a.tag, 40)}`,
    run: (a, run) => {
      const cards = run.store.listCards({ tag: normalizeTag(str(a.tag, 80)), limit: 50 });
      return cards.length ? cards.map((c) => `${run.handles.short('c', c.id)} "${c.title || 'Untitled'}" (${c.kind}) ${c.preview.slice(0, 100)}`).join('\n') : 'No cards with that tag.';
    },
  },
  {
    spec: {
      name: 'read_journal',
      description: 'Read the journal entry for a date (YYYY-MM-DD).',
      schema: obj({ date: { type: 'string' } }, ['date']),
    },
    describe: (a) => `Read journal ${str(a.date, 12)}`,
    run: (a, run) => {
      const date = str(a.date, 12);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must look like 2025-01-31.');
      const id = run.store.findCardByTitle(date);
      return id ? readCard(card(run, id)).text : `No journal entry for ${date}.`;
    },
  },

  {
    spec: {
      name: 'list_tasks',
      description: 'List the user\'s tasks (planned work with status, priority, assignee, due date, labels, acceptance-criteria progress). Filter by any field. Returns card handles you can read_card.',
      schema: obj({
        status: { type: 'string', enum: [...TASK_STATUSES] },
        priority: { type: 'string', enum: [...TASK_PRIORITIES] },
        assignee: { type: 'string' },
        label: { type: 'string', description: 'A tag on the task' },
        overdue: { type: 'boolean', description: 'Only tasks past their due date that are not done' },
        include_done: { type: 'boolean', description: 'Default true' },
        query: { type: 'string', description: 'Words in the title' },
      }),
    },
    describe: (a) => `Listed tasks${str(a.status, 20) ? ` (${str(a.status, 20)})` : ''}`,
    run: (a, run) => {
      const tasks = new Work(run.store).listTasks({
        status: str(a.status, 20) || undefined,
        priority: str(a.priority, 20) || undefined,
        assignee: str(a.assignee, 100) || undefined,
        label: str(a.label, 80) || undefined,
        overdue: a.overdue === true,
        includeDone: a.include_done === false ? false : undefined,
        query: str(a.query, 200) || undefined,
      });
      if (!tasks.length) return 'No matching tasks.';
      return tasks.slice(0, 60).map((t) => taskLine(run, t)).join('\n') + (tasks.length > 60 ? `\n…and ${tasks.length - 60} more` : '');
    },
  },
  {
    spec: {
      name: 'list_links',
      description: 'List or search the user\'s saved links (bookmarks: address, title, description, note, tags). Returns card handles you can read_card.',
      schema: obj({ query: { type: 'string' }, tag: { type: 'string' }, limit: { type: 'integer' } }),
    },
    describe: (a) => `Listed saved links${str(a.query, 40) ? ` for “${str(a.query, 40)}”` : ''}`,
    run: (a, run) => {
      const links = new Work(run.store).listLinks({ query: str(a.query, 200) || undefined, tag: str(a.tag, 80) || undefined, limit: Math.min(int(a.limit) ?? 20, 50) });
      if (!links.length) return 'No saved links.';
      return links
        .map((l) => `${run.handles.short('c', l.id)} "${l.title || l.host}" ${l.url}${l.description ? ` — ${l.description.slice(0, 160)}` : ''}${l.note ? ` | note: ${l.note.slice(0, 120)}` : ''}${l.tags.length ? ` ${l.tags.map((t) => `#${t}`).join(' ')}` : ''}`)
        .join('\n');
    },
  },
  {
    spec: {
      name: 'list_memos',
      description: 'List the user\'s memos (quick captures), newest first, optionally only those containing some words.',
      schema: obj({ query: { type: 'string' }, limit: { type: 'integer' } }),
    },
    describe: () => 'Listed memos',
    run: (a, run) => {
      const query = str(a.query, 200).toLowerCase().trim();
      const memos = run.store.listCards({ kinds: ['memo'], sort: 'created', limit: 200 }).filter((m) => !query || m.preview.toLowerCase().includes(query)).slice(0, Math.min(int(a.limit) ?? 20, 50));
      return memos.length ? memos.map((m) => `${run.handles.short('c', m.id)} ${new Date(m.createdAt).toISOString().slice(0, 10)}: ${m.preview}`).join('\n') : 'No memos.';
    },
  },

  // ------------------------------------------------------------------ writers (only with allowWrites)
  {
    write: true,
    spec: {
      name: 'create_card',
      description: 'Create a new card from markdown. Returns its handle.',
      schema: obj({ title: { type: 'string' }, markdown: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, ['title', 'markdown']),
    },
    describe: (a) => `Create card “${str(a.title, 60)}”`,
    run: (a, run) => {
      const id = run.store.createCard({ title: str(a.title, 200), content: markdownToContent(str(a.markdown)), inbox: true });
      for (const t of Array.isArray(a.tags) ? a.tags.slice(0, 10) : []) run.store.addTag(id, str(t, 80));
      run.changes.push(`Created card “${str(a.title, 60)}”`);
      return `Created ${run.handles.short('c', id)}.`;
    },
  },
  {
    write: true,
    spec: {
      name: 'append_to_card',
      description: 'Append markdown to the end of an existing card.',
      schema: obj({ card: { type: 'string' }, markdown: { type: 'string' } }, ['card', 'markdown']),
    },
    describe: (a) => `Append to card ${str(a.card, 20)}`,
    run: (a, run) => {
      const c = card(run, a.card);
      appendBlocks(run.store, c.id, str(a.markdown));
      run.read.delete(c.id);
      run.changes.push(`Added to “${c.title}”`);
      return 'Appended.';
    },
  },
  {
    write: true,
    spec: { name: 'create_whiteboard', description: 'Create an empty whiteboard.', schema: obj({ name: { type: 'string' } }, ['name']) },
    describe: (a) => `Create whiteboard “${str(a.name, 60)}”`,
    run: (a, run) => {
      const id = run.store.createWhiteboard(str(a.name, 120) || 'Untitled whiteboard');
      run.changes.push(`Created whiteboard “${str(a.name, 60)}”`);
      return `Created ${run.handles.short('w', id)}.`;
    },
  },
  {
    write: true,
    spec: {
      name: 'place_cards',
      description: 'Place existing cards on a whiteboard, optionally grouped inside a new section.',
      schema: obj({ whiteboard: { type: 'string' }, cards: { type: 'array', items: { type: 'string' } }, section: { type: 'string', description: 'Optional section title to group them in' } }, ['whiteboard', 'cards']),
    },
    describe: (a) => `Place ${Array.isArray(a.cards) ? a.cards.length : 0} cards on ${str(a.whiteboard, 20)}`,
    run: (a, run) => {
      const board = boardId(run, a.whiteboard);
      const ids = (Array.isArray(a.cards) ? a.cards.slice(0, 60) : []).map((h) => card(run, h).id);
      if (!ids.length) throw new Error('cards is empty.');
      const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
      const cw = 300;
      const ch = 220;
      const gap = 40;
      const x0 = 0;
      const y0 = freeY(run.store, board);
      const section = str(a.section, 120).trim();
      let sectionId = '';
      if (section) {
        const rows = Math.ceil(ids.length / cols);
        sectionId = run.store.addObject(board, { kind: 'section', x: x0, y: y0, w: cols * (cw + gap) + gap, h: rows * (ch + gap) + gap + 40, text: section });
      }
      const placed = ids.map((id, i) => {
        const x = x0 + gap + (i % cols) * (cw + gap);
        const y = y0 + (section ? 60 : 0) + Math.floor(i / cols) * (ch + gap);
        const pid = run.store.addCardToWhiteboard(board, id, x, y);
        return { id: pid, w: cw, h: ch, ...(sectionId ? { sectionId } : {}) };
      });
      run.store.updatePlacements(placed);
      run.changes.push(`Placed ${ids.length} cards on a whiteboard`);
      return `Placed ${ids.length} cards.${sectionId ? ` Section ${run.handles.short('p', sectionId)}.` : ''}`;
    },
  },
  {
    write: true,
    spec: {
      name: 'create_connection',
      description: 'Connect two objects on the same whiteboard (handles from read_whiteboard).',
      schema: obj({ whiteboard: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, ['whiteboard', 'from', 'to']),
    },
    describe: () => 'Connect two objects',
    run: (a, run) => {
      const board = boardId(run, a.whiteboard);
      const id = run.store.createEdge(board, placementId(run, a.from), placementId(run, a.to));
      if (str(a.label)) run.store.setEdgeLabel(id, str(a.label, 200));
      run.changes.push('Connected two objects');
      return 'Connected.';
    },
  },
  {
    write: true,
    spec: {
      name: 'create_mind_map',
      description: 'Create a mind map (a tree of text nodes) on a whiteboard.',
      schema: obj({ whiteboard: { type: 'string' }, tree: { type: 'object', description: '{ text, children: [...] }' } }, ['whiteboard', 'tree']),
    },
    describe: () => 'Create a mind map',
    run: (a, run) => {
      const tree = a.tree as MindNode;
      if (!tree || typeof tree.text !== 'string') throw new Error('tree needs a text field.');
      const root = buildMindMap(run.store, boardId(run, a.whiteboard), tree);
      run.changes.push(`Created a mind map “${tree.text.slice(0, 40)}”`);
      return `Created mind map ${run.handles.short('p', root)}.`;
    },
  },
  {
    write: true,
    spec: {
      name: 'create_task',
      description: 'Create a task. Acceptance criteria become a checklist. Returns its handle.',
      schema: obj(
        {
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: [...TASK_STATUSES] },
          priority: { type: 'string', enum: [...TASK_PRIORITIES] },
          assignee: { type: 'string' },
          due: { type: 'string', description: 'YYYY-MM-DD' },
          labels: { type: 'array', items: { type: 'string' } },
          acceptance: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria, one per item' },
          plan: { type: 'string' },
          parent: { type: 'string', description: 'Handle of the parent task, to make this a subtask' },
        },
        ['title'],
      ),
    },
    describe: (a) => `Create task “${str(a.title, 60)}”`,
    run: (a, run) => {
      const id = new Work(run.store).createTask({
        title: str(a.title, 300),
        description: str(a.description),
        status: str(a.status, 20) || undefined,
        priority: str(a.priority, 20) || undefined,
        assignee: str(a.assignee, 100),
        due: str(a.due, 10),
        labels: Array.isArray(a.labels) ? a.labels.slice(0, 10).map((l) => str(l, 80)) : [],
        acceptance: Array.isArray(a.acceptance) ? a.acceptance.slice(0, 30).map((l) => str(l, 300)) : [],
        plan: str(a.plan),
        parentId: a.parent ? card(run, a.parent).id : undefined,
      });
      run.changes.push(`Created task “${str(a.title, 60)}”`);
      return `Created ${run.handles.short('c', id)}.`;
    },
  },
  {
    write: true,
    spec: {
      name: 'update_task',
      description: 'Change a task\'s status, priority, assignee, due date, title or parent. Use append_to_card for notes.',
      schema: obj(
        {
          task: { type: 'string', description: 'Task card handle' },
          title: { type: 'string' },
          status: { type: 'string', enum: [...TASK_STATUSES] },
          priority: { type: 'string', enum: [...TASK_PRIORITIES] },
          assignee: { type: 'string' },
          due: { type: 'string', description: 'YYYY-MM-DD, or empty to clear' },
          parent: { type: 'string', description: 'Parent task handle, or empty to detach' },
        },
        ['task'],
      ),
    },
    describe: (a) => `Update task ${str(a.task, 20)}`,
    run: (a, run) => {
      const c = card(run, a.task);
      const patch: Record<string, string> = {};
      for (const key of ['title', 'status', 'priority', 'assignee', 'due'] as const) if (typeof a[key] === 'string') patch[key] = str(a[key], 300);
      if (typeof a.parent === 'string') patch.parentId = a.parent ? card(run, a.parent).id : '';
      new Work(run.store).updateTask(c.id, patch);
      run.read.delete(c.id);
      run.changes.push(`Updated task “${c.title}”`);
      return 'Updated.';
    },
  },
  {
    write: true,
    spec: {
      name: 'save_link',
      description: 'Save a web address as a bookmark. This does not open the page, so pass a title and description if you know them.',
      schema: obj({ url: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, note: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, ['url']),
    },
    describe: (a) => `Save link ${str(a.url, 60)}`,
    run: (a, run) => {
      const saved = new Work(run.store).saveLink({
        url: str(a.url, 2000),
        title: str(a.title, 300),
        description: str(a.description, 1000),
        note: str(a.note),
        tags: Array.isArray(a.tags) ? a.tags.slice(0, 10).map((t) => str(t, 80)) : [],
      });
      run.changes.push(saved.existed ? 'Updated a saved link' : `Saved link ${str(a.url, 60)}`);
      return `${saved.existed ? 'Already saved as' : 'Saved as'} ${run.handles.short('c', saved.id)}.`;
    },
  },
  {
    write: true,
    spec: { name: 'add_memo', description: 'Capture a quick memo.', schema: obj({ text: { type: 'string' } }, ['text']) },
    describe: () => 'Add a memo',
    run: (a, run) => {
      const id = new Work(run.store).addMemo(str(a.text));
      run.changes.push('Added a memo');
      return `Created ${run.handles.short('c', id)}.`;
    },
  },
];

export function toolSpecs(allowWrites: boolean): ToolSpec[] {
  return TOOLS.filter((t) => allowWrites || !t.write).map((t) => t.spec);
}

/** Runs one tool call. Errors become text the model can react to; they never throw out of the agent loop. */
export function executeTool(run: Run, name: string, args: Record<string, unknown>): { text: string; label: string } {
  const tool = TOOLS.find((t) => t.spec.name === name);
  if (!tool) return { text: `Unknown tool "${name}".`, label: `Unknown tool ${name}` };
  if (tool.write && !run.allowWrites) return { text: 'Editing is disabled for this chat. Tell the user what you would change instead.', label: tool.describe(args) };
  try {
    let text = tool.run(args, run);
    if (estimateTokens(text) > MAX_RESULT_TOKENS) text = `${text.slice(0, MAX_RESULT_TOKENS * 3)}\n(Output truncated)`;
    return { text, label: tool.describe(args) };
  } catch (err) {
    return { text: `Error: ${err instanceof Error ? err.message : String(err)}`, label: tool.describe(args) };
  }
}

function taskLine(run: Run, t: WorkTask): string {
  const facts = [t.status, t.priority, t.assignee && `@${t.assignee}`, t.due && `due ${t.due}`].filter(Boolean).join(', ');
  const progress = [t.progress.total && `${t.progress.done}/${t.progress.total} criteria`, t.subtasks.total && `${t.subtasks.done}/${t.subtasks.total} subtasks`].filter(Boolean).join(', ');
  return `${run.handles.short('c', t.id)} "${t.title}" [${facts}]${progress ? ` ${progress}` : ''}${t.labels.length ? ` ${t.labels.map((l) => `#${l}`).join(' ')}` : ''}`;
}
