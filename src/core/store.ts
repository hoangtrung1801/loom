import { CARD_KINDS, type CardKind } from './kinds.js';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { Clock } from './clock.js';
import { docToText, extractHeadings, extractLinks, extractTasks, setTaskChecked, wordCount, withBlockIds, type HeadingRef } from './doc.js';
import { ENTITIES, opSchema, type EntityName, type Op, type Scalar } from './entities.js';
import { MIGRATIONS } from './schema.js';
import { snippet, textDoc, toMatchQuery } from './text.js';

type Row = Record<string, any>;

export { CARD_KINDS, type CardKind };
export type ObjectKind = 'card' | 'text' | 'section' | 'board';

export interface CardSummary {
  id: string;
  title: string;
  preview: string;
  kind: CardKind;
  journalDate: string;
  inbox: boolean;
  fileId: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  /** Task cards: workflow state, priority, who, when it is due (YYYY-MM-DD) and the parent task. */
  status: string;
  priority: string;
  assignee: string;
  due: string;
  parentId: string;
  /** Saved links: the page address. */
  url: string;
}
export interface CardIndexEntry {
  id: string;
  title: string;
  kind: CardKind;
  inbox: boolean;
  journalDate: string;
  fileId: string;
  createdAt: number;
  updatedAt: number;
}
export interface BacklinkView {
  id: string;
  title: string;
  /** Block in the linking card that contains the link, and that block's text. */
  blockId: string;
  text: string;
}
export interface CardDetail {
  id: string;
  title: string;
  content: string;
  kind: CardKind;
  journalDate: string;
  inbox: boolean;
  fileId: string;
  meta: string;
  status: string;
  priority: string;
  assignee: string;
  due: string;
  parentId: string;
  url: string;
  completedAt: number;
  createdAt: number;
  updatedAt: number;
  wordCount: number;
  tags: string[];
  backlinks: BacklinkView[];
  boards: { id: string; name: string }[];
  headings: HeadingRef[];
}
export interface WhiteboardSummary {
  id: string;
  name: string;
  parentId: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  cardCount: number;
}
export interface PlacementView {
  id: string;
  kind: ObjectKind;
  cardId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /** Card title, section title or sub-whiteboard name. */
  title: string;
  /** Card document (card objects only). */
  content: string;
  cardKind: CardKind;
  fileId: string;
  meta: string;
  text: string;
  color: string;
  refId: string;
  parentId: string;
  sectionId: string;
  size: number;
}
export interface EdgeView {
  id: string;
  from: string;
  to: string;
  label: string;
  color: string;
  style: string;
  arrow: string;
}
export interface BoardData {
  whiteboard: { id: string; name: string; parentId: string; color: string };
  placements: PlacementView[];
  edges: EdgeView[];
}
export interface SearchHit {
  id: string;
  title: string;
  /** Title and body excerpt with matches wrapped in U+0001 / U+0002, so the UI can highlight without parsing HTML. */
  titleMarked: string;
  snippet: string;
}
export type AnyHitType = 'card' | 'whiteboard' | 'text' | 'chat' | 'tag';
export interface AnyHit extends SearchHit {
  type: AnyHitType;
  kind: string;
  /** Whiteboard that contains the hit (text objects) or the hit itself (whiteboards). */
  boardId: string;
  updatedAt: number;
}
export interface SearchOptions {
  query: string;
  kinds?: CardKind[];
  whiteboards?: boolean;
  whiteboardText?: boolean;
  chats?: boolean;
  tags?: boolean;
  sort?: 'relevance' | 'time';
  limit?: number;
}
export interface PlacementPatch {
  id: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  z?: number;
  text?: string;
  color?: string;
  parentId?: string;
  sectionId?: string;
  size?: number;
}
export interface ObjectInput {
  kind: Exclude<ObjectKind, 'card'>;
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
  color?: string;
  refId?: string;
  parentId?: string;
  size?: number;
}
export interface EdgePatch {
  label?: string;
  color?: string;
  style?: string;
  arrow?: string;
}
export interface CreateCardInput {
  title?: string;
  content?: string;
  kind?: CardKind;
  inbox?: boolean;
  fileId?: string;
  meta?: string;
  journalDate?: string;
  id?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  due?: string;
  parentId?: string;
  url?: string;
}
/** Structured card fields that can change on their own (each syncs independently). */
export interface CardFieldPatch {
  title?: string;
  kind?: CardKind;
  status?: string;
  priority?: string;
  assignee?: string;
  due?: string;
  parentId?: string;
  url?: string;
  completedAt?: number;
  fileId?: string;
  meta?: string;
}
export interface ListCardsOptions {
  kinds?: CardKind[];
  tag?: string;
  inbox?: boolean;
  /** Highlight cards remember the card they were taken from in meta.sourceId. */
  sourceId?: string;
  sort?: 'updated' | 'created' | 'title';
  limit?: number;
}
export interface TaskView {
  cardId: string;
  cardTitle: string;
  cardKind: CardKind;
  journalDate: string;
  blockId: string;
  text: string;
  checked: boolean;
  due: string;
}
export interface HistoryEntry {
  opId: string;
  at: number;
  device: string;
  title: string | null;
  preview: string | null;
}

export interface Change {
  entity: EntityName;
  id: string;
  fields: Record<string, Scalar>;
}

interface Touched {
  cards: Set<string>;
  boards: Set<string>;
  placements: Set<string>;
  chats: Set<string>;
}

/** Smallest size per object kind; text can shrink to a single line, cards and sections need room. */
const MIN_SIZE: Record<ObjectKind, { w: number; h: number }> = {
  card: { w: 160, h: 100 },
  section: { w: 160, h: 100 },
  board: { w: 160, h: 80 },
  text: { w: 40, h: 24 },
};
const COLORS = new Set(['', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class Store {
  readonly deviceId: string;
  private readonly db: DatabaseSync;
  private readonly clock: Clock;
  private depth = 0;
  private readonly stmts = new Map<string, StatementSync>();

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
    this.deviceId = this.getMeta('device_id') ?? this.setMeta('device_id', randomUUID());
    this.clock = new Clock(this.deviceId, this.getMeta('hlc') ?? undefined);
  }

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------- plumbing
  // `all`, `get`, `run`, `tx` and `commit` are what the feature services (tags, chats, files, AI) build on.

  private sql(text: string): StatementSync {
    let s = this.stmts.get(text);
    if (!s) {
      s = this.db.prepare(text);
      this.stmts.set(text, s);
    }
    return s;
  }
  all(text: string, ...params: Scalar[]): Row[] {
    return this.sql(text).all(...params) as Row[];
  }
  get(text: string, ...params: Scalar[]): Row | undefined {
    return this.sql(text).get(...params) as Row | undefined;
  }
  run(text: string, ...params: Scalar[]): void {
    this.sql(text).run(...params);
  }

  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth--;
    }
  }

  private migrate(): void {
    const current = (this.get('PRAGMA user_version')?.user_version as number) ?? 0;
    if (current > MIGRATIONS.length) {
      throw new Error(`Database schema v${current} is newer than this app supports (v${MIGRATIONS.length}).`);
    }
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        for (const stmt of MIGRATIONS[v]!) this.db.exec(stmt);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
    if (current > 0 && current < MIGRATIONS.length) this.rebuildDerived();
  }

  getMeta(key: string): string | null {
    return (this.get('SELECT value FROM meta WHERE key = ?', key)?.value as string | undefined) ?? null;
  }
  setMeta(key: string, value: string): string {
    this.run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
    return value;
  }
  deleteMeta(key: string): void {
    this.run('DELETE FROM meta WHERE key = ?', key);
  }

  // -------------------------------------------------------- op log + merging

  /** Records locally-authored changes as ops and applies them, atomically. */
  commit(changes: Change[]): void {
    this.tx(() => {
      const touched = newTouched();
      for (const change of changes) {
        const op: Op = {
          id: randomUUID(),
          entity: change.entity,
          entityId: change.id,
          fields: change.fields,
          ts: this.clock.next(),
          device: this.deviceId,
        };
        this.insertOp(op, 0);
        this.applyOp(op, touched);
      }
      this.finishWrite(touched);
    });
  }

  private insertOp(op: Op, pushed: 0 | 1): boolean {
    const exists = this.get('SELECT 1 AS x FROM ops WHERE id = ?', op.id);
    if (exists) return false;
    this.run(
      'INSERT INTO ops(id, entity, entity_id, fields, ts, device, pushed) VALUES (?, ?, ?, ?, ?, ?, ?)',
      op.id, op.entity, op.entityId, JSON.stringify(op.fields), op.ts, op.device, pushed,
    );
    return true;
  }

  /** Last-write-wins per field: a field only changes if the op is newer than what produced its current value. */
  private applyOp(op: Op, touched: Touched): void {
    const { table } = ENTITIES[op.entity];
    for (const [field, value] of Object.entries(op.fields)) {
      const current = this.get(
        'SELECT ts FROM field_clock WHERE entity = ? AND entity_id = ? AND field = ?',
        op.entity, op.entityId, field,
      )?.ts as string | undefined;
      if (current !== undefined && current >= op.ts) continue;
      // table and field come from the ENTITIES allow-list (enforced by opSchema), never from raw input.
      this.run(`INSERT OR IGNORE INTO ${table}(id) VALUES (?)`, op.entityId);
      this.run(`UPDATE ${table} SET ${field} = ? WHERE id = ?`, value, op.entityId);
      this.run(
        `INSERT INTO field_clock(entity, entity_id, field, ts) VALUES (?, ?, ?, ?)
         ON CONFLICT(entity, entity_id, field) DO UPDATE SET ts = excluded.ts`,
        op.entity, op.entityId, field, op.ts,
      );
      switch (op.entity) {
        case 'card':
          if (['title', 'content', 'deleted_at', 'kind', 'url', 'assignee', 'meta'].includes(field)) touched.cards.add(op.entityId);
          break;
        case 'whiteboard':
          if (field === 'name' || field === 'deleted_at') touched.boards.add(op.entityId);
          break;
        case 'placement':
          if (field === 'text' || field === 'deleted_at' || field === 'kind') touched.placements.add(op.entityId);
          break;
        case 'chat':
          touched.chats.add(op.entityId);
          break;
        case 'chatMessage':
          if (field === 'content' || field === 'deleted_at' || field === 'chat_id') touched.chats.add(`msg:${op.entityId}`);
          break;
        default:
      }
    }
  }

  private finishWrite(touched: Touched): void {
    for (const id of touched.cards) this.reindex(id);
    for (const id of touched.boards) this.reindexBoard(id);
    for (const id of touched.placements) this.reindexText(id);
    for (const id of touched.chats) {
      if (id.startsWith('msg:')) {
        const chatId = this.get('SELECT chat_id FROM chat_messages WHERE id = ?', id.slice(4))?.chat_id as string | undefined;
        if (chatId) this.reindexChat(chatId);
      } else this.reindexChat(id);
    }
    this.setMeta('hlc', this.clock.last());
  }

  /** Rebuilds every derived index from the synced tables (used after migrations). */
  rebuildDerived(): void {
    this.tx(() => {
      for (const r of this.all('SELECT id FROM cards')) this.reindex(r.id);
      for (const r of this.all('SELECT id FROM whiteboards')) this.reindexBoard(r.id);
      for (const r of this.all("SELECT id FROM placements WHERE kind = 'text'")) this.reindexText(r.id);
      for (const r of this.all('SELECT id FROM chats')) this.reindexChat(r.id);
    });
  }

  private reindex(cardId: string): void {
    const card = this.get('SELECT title, content, kind, url, assignee, meta, deleted_at FROM cards WHERE id = ?', cardId);
    this.run('DELETE FROM search_index WHERE card_id = ?', cardId);
    this.run('DELETE FROM links WHERE source_id = ?', cardId);
    this.run('DELETE FROM tasks WHERE card_id = ?', cardId);
    if (!card || card.deleted_at != null) return;
    this.run('INSERT INTO search_index(card_id, title, body) VALUES (?, ?, ?)', cardId, card.title, [docToText(card.content), searchExtras(card)].filter(Boolean).join('\n'));
    for (const l of extractLinks(card.content)) {
      this.run('INSERT INTO links(source_id, block_id, target_id, target_title, text) VALUES (?, ?, ?, ?, ?)', cardId, l.blockId, l.targetId, l.targetTitle, snippet(l.text, 200));
    }
    for (const t of extractTasks(card.content)) {
      this.run('INSERT INTO tasks(card_id, block_id, text, checked, due) VALUES (?, ?, ?, ?, ?)', cardId, t.blockId, t.text, t.checked ? 1 : 0, t.due);
    }
  }

  private reindexBoard(id: string): void {
    this.run("DELETE FROM search_other WHERE kind = 'whiteboard' AND ref_id = ?", id);
    const w = this.get('SELECT name, deleted_at FROM whiteboards WHERE id = ?', id);
    if (w && w.deleted_at == null) this.run("INSERT INTO search_other(kind, ref_id, title, body) VALUES ('whiteboard', ?, ?, '')", id, w.name);
  }
  private reindexText(placementId: string): void {
    this.run("DELETE FROM search_other WHERE kind = 'text' AND ref_id = ?", placementId);
    const p = this.get('SELECT kind, text, deleted_at FROM placements WHERE id = ?', placementId);
    if (p && p.deleted_at == null && p.kind === 'text' && p.text) {
      this.run("INSERT INTO search_other(kind, ref_id, title, body) VALUES ('text', ?, '', ?)", placementId, p.text);
    }
  }
  private reindexChat(chatId: string): void {
    this.run("DELETE FROM search_other WHERE kind = 'chat' AND ref_id = ?", chatId);
    const c = this.get('SELECT title, deleted_at FROM chats WHERE id = ?', chatId);
    if (!c || c.deleted_at != null) return;
    const body = this.all("SELECT content FROM chat_messages WHERE chat_id = ? AND deleted_at IS NULL AND role != 'tool' ORDER BY created_at", chatId)
      .map((m) => m.content as string)
      .join('\n');
    this.run("INSERT INTO search_other(kind, ref_id, title, body) VALUES ('chat', ?, ?, ?)", chatId, c.title, body.slice(0, 200_000));
  }

  // ------------------------------------------------------------------- sync

  pendingOps(limit = 500): Op[] {
    return this.all('SELECT * FROM ops WHERE pushed = 0 ORDER BY seq LIMIT ?', limit).map(rowToOp);
  }
  pendingCount(): number {
    return this.get('SELECT COUNT(*) AS n FROM ops WHERE pushed = 0')?.n as number;
  }
  markPushed(ids: string[]): void {
    this.tx(() => ids.forEach((id) => this.run('UPDATE ops SET pushed = 1 WHERE id = ?', id)));
  }

  /** Merges ops from another device. Idempotent; invalid ops are rejected before anything is written. */
  applyRemote(ops: unknown[]): number {
    const valid = ops.map((o) => opSchema.parse(o));
    return this.tx(() => {
      const touched = newTouched();
      let applied = 0;
      for (const op of valid) {
        if (!this.insertOp(op, 1)) continue;
        this.clock.observe(op.ts);
        this.applyOp(op, touched);
        applied++;
      }
      this.finishWrite(touched);
      return applied;
    });
  }

  // ------------------------------------------------------------------ cards

  createCard(
    input: CreateCardInput = {},
  ): string {
    const id = input.id ?? randomUUID();
    const now = Date.now();
    const kind = input.kind ?? 'note';
    if (!CARD_KINDS.includes(kind)) throw new Error(`Unknown card kind "${kind}".`);
    if (input.journalDate && !DATE.test(input.journalDate)) throw new Error('Journal dates look like 2025-01-31.');
    this.commit([
      {
        entity: 'card',
        id,
        fields: {
          title: (input.title ?? '').slice(0, 500),
          content: normalizeContent(input.content ?? ''),
          kind,
          journal_date: input.journalDate ?? '',
          inbox: input.inbox ? 1 : 0,
          file_id: input.fileId ?? '',
          meta: input.meta ?? '',
          status: input.status ?? '',
          priority: input.priority ?? '',
          assignee: input.assignee ?? '',
          due: input.due ?? '',
          parent_id: input.parentId ?? '',
          url: input.url ?? '',
          completed_at: 0,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      },
    ]);
    return id;
  }

  updateCard(id: string, patch: { title?: string; content?: string; meta?: string }): void {
    const fields: Record<string, Scalar> = { updated_at: Date.now() };
    if (patch.title !== undefined) fields.title = patch.title.slice(0, 500);
    if (patch.content !== undefined) fields.content = normalizeContent(patch.content); // rejects malformed documents early
    if (patch.meta !== undefined) fields.meta = patch.meta;
    this.requireActive('cards', id);
    this.commit([{ entity: 'card', id, fields }]);
  }

  /** Changes structured fields without touching the body. Values are validated by the caller (see `Work`). */
  patchCard(id: string, patch: CardFieldPatch): void {
    this.requireActive('cards', id);
    const fields: Record<string, Scalar> = { updated_at: Date.now() };
    if (patch.title !== undefined) fields.title = patch.title.slice(0, 500);
    if (patch.kind !== undefined) {
      if (!CARD_KINDS.includes(patch.kind)) throw new Error(`Unknown card kind "${patch.kind}".`);
      fields.kind = patch.kind;
    }
    if (patch.status !== undefined) fields.status = patch.status;
    if (patch.priority !== undefined) fields.priority = patch.priority;
    if (patch.assignee !== undefined) fields.assignee = patch.assignee.slice(0, 100);
    if (patch.due !== undefined) fields.due = patch.due;
    if (patch.parentId !== undefined) fields.parent_id = patch.parentId;
    if (patch.url !== undefined) fields.url = patch.url.slice(0, 2000);
    if (patch.completedAt !== undefined) fields.completed_at = patch.completedAt;
    if (patch.fileId !== undefined) fields.file_id = patch.fileId;
    if (patch.meta !== undefined) fields.meta = patch.meta;
    this.commit([{ entity: 'card', id, fields }]);
  }

  trashCard(id: string): void {
    this.requireActive('cards', id);
    const changes: Change[] = [{ entity: 'card', id, fields: { deleted_at: Date.now() } }];
    for (const p of this.all('SELECT id FROM placements WHERE card_id = ? AND deleted_at IS NULL', id)) {
      changes.push(...this.placementRemoval(p.id));
    }
    this.commit(changes);
  }

  /** Brings a trashed card back. Its whiteboard placements stay removed; it returns to the library. */
  restoreCard(id: string): void {
    if (!this.get('SELECT 1 AS x FROM cards WHERE id = ? AND deleted_at IS NOT NULL', id)) throw new Error('Card is not in the trash.');
    this.commit([{ entity: 'card', id, fields: { deleted_at: null, updated_at: Date.now() } }]);
  }

  setInbox(id: string, inbox: boolean): void {
    this.requireActive('cards', id);
    this.commit([{ entity: 'card', id, fields: { inbox: inbox ? 1 : 0 } }]);
  }

  listCards(options: number | ListCardsOptions = {}): CardSummary[] {
    const o: ListCardsOptions = typeof options === 'number' ? { limit: options } : options;
    const where = ['c.deleted_at IS NULL'];
    const params: Scalar[] = [];
    if (o.kinds?.length) {
      where.push(`c.kind IN (${o.kinds.map(() => '?').join(',')})`);
      params.push(...o.kinds);
    }
    if (o.inbox !== undefined) where.push(`c.inbox = ${o.inbox ? 1 : 0}`);
    if (o.tag) {
      where.push('EXISTS (SELECT 1 FROM card_tags t WHERE t.card_id = c.id AND t.tag = ? AND t.deleted_at IS NULL)');
      params.push(o.tag);
    }
    if (o.sourceId) {
      where.push("json_extract(CASE WHEN json_valid(c.meta) THEN c.meta ELSE '{}' END, '$.sourceId') = ?");
      params.push(o.sourceId);
    }
    const order = o.sort === 'title' ? 'lower(c.title)' : o.sort === 'created' ? 'c.created_at DESC' : 'c.updated_at DESC';
    const rows = this.all(
      `SELECT c.id, c.title, c.content, c.kind, c.journal_date, c.inbox, c.file_id, c.status, c.priority, c.assignee, c.due, c.parent_id, c.url, c.created_at, c.updated_at FROM cards c
       WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`,
      ...params, Math.min(o.limit ?? 1000, 5000),
    );
    const tags = this.tagsByCard();
    return rows.map((r) => toSummary(r, tags.get(r.id) ?? []));
  }

  /** Every live card without its body: what title lookups, the mention menu and counters need. Cheap enough to refresh after each edit. */
  cardIndex(): CardIndexEntry[] {
    return this.all(
      'SELECT id, title, kind, inbox, journal_date, file_id, created_at, updated_at FROM cards WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 20000',
    ).map((r) => ({ id: r.id, title: r.title, kind: r.kind, inbox: !!r.inbox, journalDate: r.journal_date, fileId: r.file_id, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  getCard(id: string): CardDetail | null {
    const r = this.get('SELECT * FROM cards WHERE id = ? AND deleted_at IS NULL', id);
    if (!r) return null;
    return {
      id: r.id,
      title: r.title,
      content: r.content,
      kind: r.kind,
      journalDate: r.journal_date,
      inbox: !!r.inbox,
      fileId: r.file_id,
      meta: r.meta,
      status: r.status,
      priority: r.priority,
      assignee: r.assignee,
      due: r.due,
      parentId: r.parent_id,
      url: r.url,
      completedAt: r.completed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      wordCount: wordCount(r.content),
      tags: this.tagsByCard(id).get(id) ?? [],
      backlinks: this.backlinks(id, r.title),
      boards: this.all(
        `SELECT DISTINCT w.id, w.name FROM placements p JOIN whiteboards w ON w.id = p.whiteboard_id
         WHERE p.card_id = ? AND p.deleted_at IS NULL AND w.deleted_at IS NULL ORDER BY w.name`,
        id,
      ).map((b) => ({ id: b.id, name: b.name })),
      headings: extractHeadings(r.content),
    };
  }

  findCardByTitle(title: string): string | null {
    return (this.get('SELECT id FROM cards WHERE lower(title) = lower(?) AND deleted_at IS NULL LIMIT 1', title)?.id as string) ?? null;
  }

  /** Cards that mention this one (by @mention or [[title]]), with the block that contains the mention. */
  private backlinks(id: string, title: string): BacklinkView[] {
    return this.all(
      `SELECT l.source_id, l.block_id, l.text, c.title FROM links l JOIN cards c ON c.id = l.source_id
       WHERE c.deleted_at IS NULL AND l.source_id != ?1
         AND (l.target_id = ?1 OR (l.target_id = '' AND ?2 != '' AND lower(l.target_title) = lower(?2)))
       ORDER BY c.updated_at DESC`,
      id, title.trim(),
    ).map((r) => ({ id: r.source_id, title: r.title, blockId: r.block_id, text: r.text }));
  }

  cardsMentioning(cardId: string): BacklinkView[] {
    const card = this.get('SELECT title FROM cards WHERE id = ? AND deleted_at IS NULL', cardId);
    return card ? this.backlinks(cardId, card.title) : [];
  }

  titlesById(ids: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const id of new Set(ids)) {
      const t = this.get('SELECT title FROM cards WHERE id = ?', id)?.title as string | undefined;
      if (t !== undefined) out[id] = t;
    }
    return out;
  }

  // ----------------------------------------------------------------- search

  search(query: string, limit = 30): SearchHit[] {
    const match = toMatchQuery(query);
    if (!match) return [];
    return this.all(
      `SELECT c.id, c.title,
              highlight(search_index, 1, char(1), char(2)) AS title_marked,
              snippet(search_index, 2, char(1), char(2), '…', 14) AS snip
       FROM search_index JOIN cards c ON c.id = search_index.card_id
       WHERE search_index MATCH ? AND c.deleted_at IS NULL
       ORDER BY bm25(search_index, 0.0, 8.0, 1.0) LIMIT ?`,
      match, limit,
    ).map((r) => ({ id: r.id, title: r.title, titleMarked: r.title_marked, snippet: r.snip }));
  }

  /** Global search across cards, whiteboards, whiteboard text, chats and tags, with the filters the UI offers. */
  searchAll(options: SearchOptions): AnyHit[] {
    const { query } = options;
    const match = toMatchQuery(query);
    const limit = Math.min(options.limit ?? 40, 200);
    const hits: (AnyHit & { rank: number })[] = [];
    if (match) {
      const kinds = options.kinds?.length ? options.kinds : null;
      {
        const rows = this.all(
          `SELECT c.id, c.title, c.kind, c.updated_at,
                  highlight(search_index, 1, char(1), char(2)) AS title_marked,
                  snippet(search_index, 2, char(1), char(2), '…', 14) AS snip,
                  bm25(search_index, 0.0, 8.0, 1.0) AS rank
           FROM search_index JOIN cards c ON c.id = search_index.card_id
           WHERE search_index MATCH ? AND c.deleted_at IS NULL
             ${kinds ? `AND c.kind IN (${kinds.map(() => '?').join(',')})` : ''}
           ORDER BY rank LIMIT ?`,
          match, ...(kinds ?? []), limit,
        );
        for (const r of rows) {
          hits.push({ type: 'card', id: r.id, title: r.title, titleMarked: r.title_marked, snippet: r.snip, kind: r.kind, boardId: '', updatedAt: r.updated_at, rank: r.rank });
        }
      }
      const other: string[] = [];
      if (options.whiteboards ?? true) other.push('whiteboard');
      if (options.whiteboardText) other.push('text');
      if (options.chats) other.push('chat');
      if (other.length) {
        const rows = this.all(
          `SELECT kind, ref_id, title, highlight(search_other, 2, char(1), char(2)) AS title_marked,
                  snippet(search_other, 3, char(1), char(2), '…', 14) AS snip, bm25(search_other, 0.0, 0.0, 6.0, 1.0) AS rank
           FROM search_other WHERE search_other MATCH ? AND kind IN (${other.map(() => '?').join(',')})
           ORDER BY rank LIMIT ?`,
          match, ...other, limit,
        );
        for (const r of rows) {
          if (r.kind === 'whiteboard') {
            const w = this.get('SELECT updated_at FROM whiteboards WHERE id = ?', r.ref_id);
            hits.push({ type: 'whiteboard', id: r.ref_id, title: r.title, titleMarked: r.title_marked, snippet: '', kind: 'whiteboard', boardId: r.ref_id, updatedAt: w?.updated_at ?? 0, rank: r.rank });
          } else if (r.kind === 'text') {
            const p = this.get('SELECT whiteboard_id FROM placements WHERE id = ?', r.ref_id);
            const board = p ? this.get('SELECT name FROM whiteboards WHERE id = ? AND deleted_at IS NULL', p.whiteboard_id) : undefined;
            if (!board) continue;
            hits.push({ type: 'text', id: r.ref_id, title: board.name, titleMarked: board.name, snippet: r.snip, kind: 'text', boardId: p!.whiteboard_id, updatedAt: 0, rank: r.rank });
          } else {
            const c = this.get('SELECT updated_at FROM chats WHERE id = ?', r.ref_id);
            hits.push({ type: 'chat', id: r.ref_id, title: r.title, titleMarked: r.title_marked, snippet: r.snip, kind: 'chat', boardId: '', updatedAt: c?.updated_at ?? 0, rank: r.rank });
          }
        }
      }
    }
    if (options.tags ?? true) {
      const needle = query.trim().replace(/^#+/, '').toLowerCase();
      if (needle) {
        for (const t of this.listTags().filter((x) => x.tag.includes(needle)).slice(0, 10)) {
          hits.push({ type: 'tag', id: t.tag, title: `#${t.tag}`, titleMarked: `#${t.tag}`, snippet: `${t.count} card${t.count === 1 ? '' : 's'}`, kind: 'tag', boardId: '', updatedAt: 0, rank: -0.5 });
        }
      }
    }
    hits.sort(options.sort === 'time' ? (a, b) => b.updatedAt - a.updatedAt : (a, b) => a.rank - b.rank);
    return hits.slice(0, limit).map(({ rank: _rank, ...hit }) => hit);
  }

  /**
   * Cards related to the given ones: their most distinctive words become a ranked full-text query.
   * This is the local stand-in for Heptabase's "AI suggestions" filter, so it needs no model or network.
   */
  relatedCards(cardIds: string[], limit = 8): SearchHit[] {
    const freq = new Map<string, number>();
    for (const id of cardIds) {
      const c = this.get('SELECT title, content FROM cards WHERE id = ? AND deleted_at IS NULL', id);
      if (!c) continue;
      const text = `${c.title} ${c.title} ${docToText(c.content)}`.toLowerCase();
      for (const w of text.match(/[\p{L}\p{N}]{4,}/gu) ?? []) if (!STOPWORDS.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    }
    const terms = [...freq].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, 10).map(([w]) => `"${w}"`);
    if (!terms.length) return [];
    const exclude = new Set(cardIds);
    return this.all(
      `SELECT c.id, c.title, snippet(search_index, 2, char(1), char(2), '…', 14) AS snip
       FROM search_index JOIN cards c ON c.id = search_index.card_id
       WHERE search_index MATCH ? AND c.deleted_at IS NULL
       ORDER BY bm25(search_index, 0.0, 6.0, 1.0) LIMIT ?`,
      terms.join(' OR '), limit + exclude.size,
    )
      .filter((r) => !exclude.has(r.id))
      .slice(0, limit)
      .map((r) => ({ id: r.id, title: r.title, titleMarked: r.title, snippet: r.snip }));
  }

  // ------------------------------------------------------------------- tags

  addTag(cardId: string, rawTag: string): void {
    const tag = normalizeTag(rawTag);
    if (!tag) return;
    this.requireActive('cards', cardId);
    this.commit([{ entity: 'cardTag', id: `${cardId}:${tag}`, fields: { card_id: cardId, tag, deleted_at: null } }]);
  }
  removeTag(cardId: string, rawTag: string): void {
    const tag = normalizeTag(rawTag);
    if (tag) this.commit([{ entity: 'cardTag', id: `${cardId}:${tag}`, fields: { deleted_at: Date.now() } }]);
  }
  listTags(): { tag: string; count: number; color: string; collection: string; description: string }[] {
    const counts = new Map<string, number>(
      this.all(
        `SELECT t.tag, COUNT(*) AS n FROM card_tags t JOIN cards c ON c.id = t.card_id
         WHERE t.deleted_at IS NULL AND c.deleted_at IS NULL GROUP BY t.tag`,
      ).map((r) => [r.tag as string, r.n as number]),
    );
    const defs = new Map(this.all('SELECT id, color, collection, description FROM tag_defs WHERE deleted_at IS NULL').map((d) => [d.id as string, d]));
    for (const name of defs.keys()) if (!counts.has(name)) counts.set(name, 0);
    return [...counts]
      .map(([tag, count]) => ({ tag, count, color: defs.get(tag)?.color ?? '', collection: defs.get(tag)?.collection ?? '', description: defs.get(tag)?.description ?? '' }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }
  tagsByCard(only?: string): Map<string, string[]> {
    const rows = only
      ? this.all('SELECT card_id, tag FROM card_tags WHERE deleted_at IS NULL AND card_id = ? ORDER BY tag', only)
      : this.all('SELECT card_id, tag FROM card_tags WHERE deleted_at IS NULL ORDER BY tag');
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.card_id, [...(map.get(r.card_id) ?? []), r.tag]);
    return map;
  }

  // --------------------------------------------------------------- journals

  /** The journal card for a day, created on first use. Its id is derived from the date so devices converge. */
  ensureJournal(date: string): string {
    if (!DATE.test(date) || Number.isNaN(Date.parse(date))) throw new Error('Journal dates look like 2025-01-31.');
    const id = `journal-${date}`;
    const row = this.get('SELECT deleted_at FROM cards WHERE id = ?', id);
    if (!row) this.createCard({ id, title: date, kind: 'journal', journalDate: date });
    else if (row.deleted_at != null) this.restoreCard(id);
    return id;
  }

  /** Days (YYYY-MM-DD) in a month that have a non-empty journal, for the calendar's dots. */
  journalDays(month: string): string[] {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Month looks like 2025-01.');
    return this.all(
      "SELECT journal_date, content FROM cards WHERE kind = 'journal' AND deleted_at IS NULL AND journal_date LIKE ? ORDER BY journal_date",
      `${month}-%`,
    )
      .filter((r) => docToText(r.content).length > 0)
      .map((r) => r.journal_date as string);
  }

  listJournals(limit = 60): CardSummary[] {
    const tags = this.tagsByCard();
    return this.all(
      `SELECT id, title, content, kind, journal_date, inbox, file_id, created_at, updated_at FROM cards
       WHERE kind = 'journal' AND deleted_at IS NULL ORDER BY journal_date DESC LIMIT ?`,
      Math.min(limit, 1000),
    )
      .filter((r) => docToText(r.content).length > 0)
      .map((r) => toSummary(r, tags.get(r.id) ?? []));
  }

  // ------------------------------------------------------------------ tasks

  listTasks(options: { done?: boolean; due?: string; cardId?: string; inboxOnly?: boolean } = {}): TaskView[] {
    const where = ['c.deleted_at IS NULL'];
    const params: Scalar[] = [];
    if (options.done !== undefined) where.push(`t.checked = ${options.done ? 1 : 0}`);
    if (options.due) {
      where.push("(t.due = ? OR (t.due = '' AND c.journal_date = ?))");
      params.push(options.due, options.due);
    }
    if (options.cardId) {
      where.push('t.card_id = ?');
      params.push(options.cardId);
    }
    return this.all(
      `SELECT t.card_id, c.title, c.kind, c.journal_date, t.block_id, t.text, t.checked, t.due FROM tasks t JOIN cards c ON c.id = t.card_id
       WHERE ${where.join(' AND ')} ORDER BY c.updated_at DESC, t.rowid LIMIT 1000`,
      ...params,
    ).map((r) => ({ cardId: r.card_id, cardTitle: r.title, cardKind: r.kind, journalDate: r.journal_date, blockId: r.block_id, text: r.text, checked: !!r.checked, due: r.due }));
  }

  setTaskChecked(cardId: string, blockId: string, checked: boolean): void {
    const card = this.get('SELECT content FROM cards WHERE id = ? AND deleted_at IS NULL', cardId);
    if (!card) throw new Error('Card not found.');
    const next = setTaskChecked(card.content, blockId, checked);
    if (next === null) throw new Error('That to-do no longer exists.');
    this.updateCard(cardId, { content: next });
  }

  // ---------------------------------------------------------------- history

  /** Earlier versions of a card, newest first. The op log already holds every edit, so history is free. */
  cardHistory(id: string, limit = 100): HistoryEntry[] {
    const rows = this.all(
      `SELECT id, fields, ts, device FROM ops WHERE entity = 'card' AND entity_id = ? AND (fields LIKE '%"content"%' OR fields LIKE '%"title"%')
       ORDER BY ts DESC LIMIT ?`,
      id, limit,
    );
    return rows.map((r) => {
      const fields = JSON.parse(r.fields) as Record<string, Scalar>;
      return {
        opId: r.id,
        at: Number(String(r.ts).slice(0, 13)),
        device: r.device,
        title: typeof fields.title === 'string' ? fields.title : null,
        preview: typeof fields.content === 'string' ? snippet(docToText(fields.content), 160) : null,
      };
    });
  }

  restoreCardVersion(cardId: string, opId: string): void {
    const op = this.get("SELECT fields FROM ops WHERE id = ? AND entity = 'card' AND entity_id = ?", opId, cardId);
    if (!op) throw new Error('Version not found.');
    const fields = JSON.parse(op.fields) as Record<string, Scalar>;
    const patch: { title?: string; content?: string } = {};
    if (typeof fields.content === 'string') patch.content = fields.content;
    if (typeof fields.title === 'string') patch.title = fields.title;
    if (!Object.keys(patch).length) throw new Error('That version has no content.');
    this.updateCard(cardId, patch);
  }

  listTrash(): { cards: CardSummary[]; whiteboards: { id: string; name: string }[] } {
    return {
      cards: this.all(
        'SELECT id, title, content, kind, journal_date, inbox, file_id, created_at, updated_at FROM cards WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500',
      ).map((r) => toSummary(r, [])),
      whiteboards: this.all('SELECT id, name FROM whiteboards WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200').map((r) => ({ id: r.id, name: r.name })),
    };
  }

  // ------------------------------------------------------------ whiteboards

  createWhiteboard(name = 'Untitled whiteboard', parentId = ''): string {
    if (parentId) this.requireActive('whiteboards', parentId);
    const id = randomUUID();
    const now = Date.now();
    this.commit([{ entity: 'whiteboard', id, fields: { name: name.slice(0, 200), parent_id: parentId, created_at: now, updated_at: now } }]);
    return id;
  }
  renameWhiteboard(id: string, name: string): void {
    this.requireActive('whiteboards', id);
    this.commit([{ entity: 'whiteboard', id, fields: { name: name.slice(0, 200), updated_at: Date.now() } }]);
  }
  setWhiteboardColor(id: string, color: string): void {
    this.requireActive('whiteboards', id);
    this.commit([{ entity: 'whiteboard', id, fields: { color: validColor(color) } }]);
  }
  /** Re-parents a whiteboard (sub-whiteboard tree); refuses cycles. */
  moveWhiteboard(id: string, parentId: string): void {
    this.requireActive('whiteboards', id);
    if (parentId) {
      this.requireActive('whiteboards', parentId);
      for (let cur: string | undefined = parentId; cur; cur = this.get('SELECT parent_id FROM whiteboards WHERE id = ?', cur)?.parent_id as string | undefined) {
        if (cur === id) throw new Error('A whiteboard cannot be moved into itself.');
      }
    }
    this.commit([{ entity: 'whiteboard', id, fields: { parent_id: parentId } }]);
  }
  /** Sub-whiteboards move up a level and shortcuts to the deleted board disappear; cards are never deleted. */
  trashWhiteboard(id: string): void {
    const board = this.get('SELECT parent_id FROM whiteboards WHERE id = ? AND deleted_at IS NULL', id);
    if (!board) throw new Error('Whiteboard not found.');
    const changes: Change[] = [{ entity: 'whiteboard', id, fields: { deleted_at: Date.now() } }];
    for (const child of this.all('SELECT id FROM whiteboards WHERE parent_id = ? AND deleted_at IS NULL', id)) {
      changes.push({ entity: 'whiteboard', id: child.id, fields: { parent_id: board.parent_id } });
    }
    for (const p of this.all("SELECT id FROM placements WHERE kind = 'board' AND ref_id = ? AND deleted_at IS NULL", id)) {
      changes.push(...this.placementRemoval(p.id));
    }
    this.commit(changes);
  }
  restoreWhiteboard(id: string): void {
    if (!this.get('SELECT 1 AS x FROM whiteboards WHERE id = ? AND deleted_at IS NOT NULL', id)) throw new Error('Whiteboard is not in the trash.');
    this.commit([{ entity: 'whiteboard', id, fields: { deleted_at: null, parent_id: '' } }]);
  }

  listWhiteboards(): WhiteboardSummary[] {
    return this.all(
      `SELECT w.id, w.name, w.parent_id, w.color, w.created_at, w.updated_at,
              (SELECT COUNT(*) FROM placements p JOIN cards c ON c.id = p.card_id
                WHERE p.whiteboard_id = w.id AND p.deleted_at IS NULL AND p.kind = 'card' AND c.deleted_at IS NULL) AS n
       FROM whiteboards w WHERE w.deleted_at IS NULL ORDER BY w.created_at, w.id`,
    ).map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id, color: r.color, createdAt: r.created_at, updatedAt: r.updated_at, cardCount: r.n }));
  }

  getWhiteboard(id: string): BoardData | null {
    const w = this.get('SELECT id, name, parent_id, color FROM whiteboards WHERE id = ? AND deleted_at IS NULL', id);
    if (!w) return null;
    const placements = this.all(
      `SELECT p.id, p.kind, p.card_id, p.x, p.y, p.w, p.h, p.z, p.text, p.color, p.ref_id, p.parent_id, p.section_id, p.size,
              c.title, c.content, c.kind AS card_kind, c.file_id, c.meta, b.name AS board_name
       FROM placements p
       LEFT JOIN cards c ON c.id = p.card_id AND c.deleted_at IS NULL
       LEFT JOIN whiteboards b ON b.id = p.ref_id AND b.deleted_at IS NULL
       WHERE p.whiteboard_id = ? AND p.deleted_at IS NULL
         AND (p.kind != 'card' OR c.id IS NOT NULL) AND (p.kind != 'board' OR b.id IS NOT NULL)
       ORDER BY p.z, p.id`,
      id,
    ).map((r): PlacementView => ({
      id: r.id,
      kind: r.kind,
      cardId: r.card_id,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      z: r.z,
      title: r.kind === 'board' ? r.board_name : r.kind === 'section' ? r.text : (r.title ?? ''),
      content: r.content ?? '',
      cardKind: r.card_kind ?? 'note',
      fileId: r.file_id ?? '',
      meta: r.meta ?? '',
      text: r.text,
      color: r.color,
      refId: r.ref_id,
      parentId: r.parent_id,
      sectionId: r.section_id,
      size: r.size,
    }));
    const edges = this.all(
      `SELECT e.id, e.from_id, e.to_id, e.label, e.color, e.style, e.arrow FROM edges e
       JOIN placements a ON a.id = e.from_id AND a.deleted_at IS NULL
       JOIN placements b ON b.id = e.to_id AND b.deleted_at IS NULL
       WHERE e.whiteboard_id = ? AND e.deleted_at IS NULL`,
      id,
    ).map((r) => ({ id: r.id, from: r.from_id, to: r.to_id, label: r.label, color: r.color, style: r.style, arrow: r.arrow }));
    return { whiteboard: { id: w.id, name: w.name, parentId: w.parent_id, color: w.color }, placements, edges };
  }

  addCardToWhiteboard(whiteboardId: string, cardId: string, x: number, y: number): string {
    this.requireActive('whiteboards', whiteboardId);
    this.requireActive('cards', cardId);
    const id = randomUUID();
    const kind = this.get('SELECT kind FROM cards WHERE id = ?', cardId)?.kind as CardKind;
    const size = defaultSize(kind);
    this.commit([{ entity: 'placement', id, fields: { ...this.placementBase(whiteboardId, 'card', x, y, size.w, size.h), card_id: cardId } }]);
    return id;
  }

  /** Creates a blank card and places it in one atomic step. */
  createCardOnWhiteboard(whiteboardId: string, x: number, y: number, init: { title?: string; content?: string } = {}): { cardId: string; placementId: string } {
    this.requireActive('whiteboards', whiteboardId);
    return this.tx(() => {
      const cardId = this.createCard(init);
      return { cardId, placementId: this.addCardToWhiteboard(whiteboardId, cardId, x, y) };
    });
  }

  /** Places text, a section, or a shortcut to another whiteboard. A shortcut without a target creates the sub-whiteboard too. */
  addObject(whiteboardId: string, input: ObjectInput): string {
    this.requireActive('whiteboards', whiteboardId);
    return this.tx(() => {
      const id = randomUUID();
      const defaults = { text: [240, 56], section: [560, 360], board: [240, 120] }[input.kind];
      const w = Math.max(MIN_SIZE[input.kind].w, input.w ?? defaults[0]!);
      const h = Math.max(MIN_SIZE[input.kind].h, input.h ?? defaults[1]!);
      let refId = input.refId ?? '';
      let text = input.text ?? '';
      if (input.kind === 'board') {
        if (!refId) refId = this.createWhiteboard(text || 'Untitled whiteboard', whiteboardId);
        else this.requireActive('whiteboards', refId);
        text = '';
      }
      if (input.parentId) this.requireObject(input.parentId, whiteboardId);
      this.commit([
        {
          entity: 'placement',
          id,
          fields: {
            ...this.placementBase(whiteboardId, input.kind, num(input.x), num(input.y), w, h),
            text: text.slice(0, 20_000),
            color: validColor(input.color ?? ''),
            ref_id: refId,
            parent_id: input.parentId ?? '',
            size: Math.min(96, Math.max(8, Math.trunc(input.size ?? 16))),
          },
        },
      ]);
      return id;
    });
  }

  private placementBase(whiteboardId: string, kind: ObjectKind, x: number, y: number, w: number, h: number): Record<string, Scalar> {
    // Sections sit behind everything; other objects stack on top.
    const z =
      kind === 'section'
        ? (this.get('SELECT COALESCE(MIN(z), 0) AS z FROM placements WHERE whiteboard_id = ? AND deleted_at IS NULL', whiteboardId)?.z as number) - 1
        : (this.get('SELECT COALESCE(MAX(z), 0) AS z FROM placements WHERE whiteboard_id = ? AND deleted_at IS NULL', whiteboardId)?.z as number) + 1;
    return { whiteboard_id: whiteboardId, kind, x: num(x), y: num(y), w, h, z, deleted_at: null };
  }

  private requireObject(id: string, whiteboardId: string): void {
    const p = this.get('SELECT whiteboard_id FROM placements WHERE id = ? AND deleted_at IS NULL', id);
    if (!p || p.whiteboard_id !== whiteboardId) throw new Error('Object is not on this whiteboard.');
  }

  updatePlacements(patches: PlacementPatch[]): void {
    const changes: Change[] = [];
    for (const p of patches) {
      const fields: Record<string, Scalar> = {};
      if (p.x !== undefined) fields.x = num(p.x);
      if (p.y !== undefined) fields.y = num(p.y);
      const min = MIN_SIZE[(this.get('SELECT kind FROM placements WHERE id = ?', p.id)?.kind as ObjectKind | undefined) ?? 'card'];
      if (p.w !== undefined) fields.w = Math.max(min.w, num(p.w));
      if (p.h !== undefined) fields.h = Math.max(min.h, num(p.h));
      if (p.z !== undefined) fields.z = Math.trunc(num(p.z));
      if (p.text !== undefined) fields.text = p.text.slice(0, 20_000);
      if (p.color !== undefined) fields.color = validColor(p.color);
      if (p.parentId !== undefined) fields.parent_id = p.parentId;
      if (p.sectionId !== undefined) fields.section_id = p.sectionId;
      if (p.size !== undefined) fields.size = Math.min(96, Math.max(8, Math.trunc(num(p.size))));
      if (Object.keys(fields).length) changes.push({ entity: 'placement', id: p.id, fields });
    }
    if (changes.length) this.commit(changes);
  }

  removePlacements(ids: string[]): void {
    const seen = new Set<string>();
    this.commit(ids.flatMap((id) => this.placementRemoval(id, seen)));
  }

  /** Restores objects that were just removed (the whiteboard's undo). Edges between restored objects come back too. */
  restorePlacements(ids: string[]): void {
    const changes: Change[] = [];
    for (const id of ids) {
      changes.push({ entity: 'placement', id, fields: { deleted_at: null } });
      for (const e of this.all('SELECT id, from_id, to_id FROM edges WHERE (from_id = ?1 OR to_id = ?1) AND deleted_at IS NOT NULL', id)) {
        const other = e.from_id === id ? e.to_id : e.from_id;
        if (ids.includes(other) || this.get('SELECT 1 AS x FROM placements WHERE id = ? AND deleted_at IS NULL', other)) {
          changes.push({ entity: 'edge', id: e.id, fields: { deleted_at: null } });
        }
      }
    }
    this.commit(changes);
  }

  /** Moves objects (and the connections between them) to another whiteboard. */
  moveToWhiteboard(ids: string[], targetId: string, dx = 0, dy = 0): void {
    this.requireActive('whiteboards', targetId);
    const set = new Set(ids);
    const changes: Change[] = [];
    const now = Date.now();
    for (const id of ids) {
      const p = this.get('SELECT x, y, kind, ref_id, parent_id, section_id FROM placements WHERE id = ? AND deleted_at IS NULL', id);
      if (!p) continue;
      if (p.kind === 'board' && p.ref_id === targetId) throw new Error('A whiteboard cannot contain itself.');
      changes.push({
        entity: 'placement',
        id,
        fields: {
          whiteboard_id: targetId,
          x: p.x + dx,
          y: p.y + dy,
          // Branches and section members keep their grouping only when the whole group moves together.
          parent_id: set.has(p.parent_id) ? p.parent_id : '',
          section_id: set.has(p.section_id) ? p.section_id : '',
        },
      });
    }
    for (const id of ids) {
      for (const e of this.all('SELECT id, from_id, to_id FROM edges WHERE (from_id = ?1 OR to_id = ?1) AND deleted_at IS NULL', id)) {
        if (set.has(e.from_id) && set.has(e.to_id)) changes.push({ entity: 'edge', id: e.id, fields: { whiteboard_id: targetId } });
        else changes.push({ entity: 'edge', id: e.id, fields: { deleted_at: now } });
      }
    }
    if (changes.length) this.commit(changes);
  }

  private placementRemoval(placementId: string, seen = new Set<string>()): Change[] {
    if (seen.has(placementId)) return [];
    seen.add(placementId);
    const now = Date.now();
    const changes: Change[] = [{ entity: 'placement', id: placementId, fields: { deleted_at: now } }];
    for (const e of this.all('SELECT id FROM edges WHERE (from_id = ? OR to_id = ?) AND deleted_at IS NULL', placementId, placementId)) {
      changes.push({ entity: 'edge', id: e.id, fields: { deleted_at: now } });
    }
    // A mind-map node takes its branch with it; section members are released rather than deleted.
    for (const child of this.all('SELECT id FROM placements WHERE parent_id = ? AND deleted_at IS NULL', placementId)) {
      changes.push(...this.placementRemoval(child.id, seen));
    }
    for (const member of this.all('SELECT id FROM placements WHERE section_id = ? AND deleted_at IS NULL', placementId)) {
      changes.push({ entity: 'placement', id: member.id, fields: { section_id: '' } });
    }
    return changes;
  }

  // ------------------------------------------------------------------ edges

  createEdge(whiteboardId: string, fromId: string, toId: string, style: EdgePatch = {}): string {
    if (fromId === toId) throw new Error('An object cannot connect to itself.');
    for (const pid of [fromId, toId]) {
      const p = this.get('SELECT whiteboard_id FROM placements WHERE id = ? AND deleted_at IS NULL', pid);
      if (!p || p.whiteboard_id !== whiteboardId) throw new Error('Both objects must be on this whiteboard.');
    }
    const existing = this.get(
      'SELECT id FROM edges WHERE whiteboard_id = ? AND from_id = ? AND to_id = ? AND deleted_at IS NULL',
      whiteboardId, fromId, toId,
    );
    if (existing) return existing.id as string;
    const id = randomUUID();
    this.commit([
      {
        entity: 'edge',
        id,
        fields: { whiteboard_id: whiteboardId, from_id: fromId, to_id: toId, label: '', color: '', style: 'solid', arrow: 'end', ...edgeFields(style), deleted_at: null },
      },
    ]);
    return id;
  }
  updateEdge(id: string, patch: EdgePatch): void {
    this.commit([{ entity: 'edge', id, fields: edgeFields(patch) }]);
  }
  setEdgeLabel(id: string, label: string): void {
    this.updateEdge(id, { label });
  }
  deleteEdge(id: string): void {
    this.commit([{ entity: 'edge', id, fields: { deleted_at: Date.now() } }]);
  }

  // ------------------------------------------------------------------- misc

  private requireActive(table: 'cards' | 'whiteboards', id: string): void {
    if (!this.get(`SELECT 1 AS x FROM ${table} WHERE id = ? AND deleted_at IS NULL`, id)) {
      throw new Error(`${table === 'cards' ? 'Card' : 'Whiteboard'} not found.`);
    }
  }

  /**
   * Creates a small demo space the first time the app opens with an empty database.
   * IDs are fixed so that devices which each seed independently converge on the same
   * rows when they sync, instead of ending up with duplicate demo content.
   */
  seedIfEmpty(): void {
    if (this.getMeta('seeded')) return;
    this.setMeta('seeded', '1');
    if (this.listWhiteboards().length || this.listCards({ limit: 1 }).length) return;
    const at = 1_700_000_000_000;
    const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const [board, welcome, linking, placeA, placeB, edge] = [1, 2, 3, 4, 5, 6].map(id) as [string, string, string, string, string, string];
    this.commit([
      { entity: 'whiteboard', id: board, fields: { name: 'Getting started', created_at: at, updated_at: at } },
      {
        entity: 'card', id: welcome,
        fields: {
          title: 'Welcome to Loom', created_at: at, updated_at: at,
          content: normalizeContent(textDoc([
            'Cards are notes. Whiteboards are where you arrange them spatially.',
            '- Type / in a card for blocks (to-dos, tables, math, code, images) and @ to link another card',
            '- Double-click empty space on a whiteboard to create a card; drag the dot on a card’s edge onto another to connect them',
            '- Press Ctrl/⌘ O to search everything, Ctrl/⌘ K for commands, Ctrl/⌘ T for a new tab',
            '- Open Journal for a page per day, and tag cards with #tags to build databases',
            '- Ask the AI chat about your notes: it reads your cards and cites the lines it used (add a key in Settings)',
            'Link notes with double brackets, like [[Linking ideas]].',
          ])),
        },
      },
      {
        entity: 'card', id: linking,
        fields: {
          title: 'Linking ideas', created_at: at, updated_at: at,
          content: normalizeContent(textDoc(['Any card that mentions [[Welcome to Loom]] shows up under Backlinks in the side panel.'])),
        },
      },
      { entity: 'placement', id: placeA, fields: { whiteboard_id: board, card_id: welcome, x: 80, y: 80, w: 320, h: 320, z: 1, deleted_at: null } },
      { entity: 'placement', id: placeB, fields: { whiteboard_id: board, card_id: linking, x: 520, y: 160, w: 320, h: 240, z: 2, deleted_at: null } },
      { entity: 'edge', id: edge, fields: { whiteboard_id: board, from_id: placeA, to_id: placeB, label: '', deleted_at: null } },
      { entity: 'cardTag', id: `${welcome}:start-here`, fields: { card_id: welcome, tag: 'start-here', deleted_at: null } },
    ]);
  }
}

function newTouched(): Touched {
  return { cards: new Set(), boards: new Set(), placements: new Set(), chats: new Set() };
}

function rowToOp(r: Row): Op {
  return { id: r.id, entity: r.entity, entityId: r.entity_id, fields: JSON.parse(r.fields), ts: r.ts, device: r.device };
}

/** Words from structured fields that should be findable: a saved link's address and description, a task's assignee. */
function searchExtras(card: Row): string {
  const parts: string[] = [];
  if (card.url) parts.push(String(card.url).replace(/^https?:\/\//, ''));
  if (card.assignee) parts.push(card.assignee);
  if (card.kind === 'link' && card.meta) {
    try {
      const d = (JSON.parse(card.meta) as { description?: unknown }).description;
      if (typeof d === 'string') parts.push(d);
    } catch {
      /* no description */
    }
  }
  return parts.join('\n');
}

function toSummary(r: Row, tags: string[]): CardSummary {
  return {
    id: r.id,
    title: r.title,
    preview: snippet(docToText(r.content)),
    kind: r.kind,
    journalDate: r.journal_date,
    inbox: !!r.inbox,
    fileId: r.file_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags,
    status: r.status ?? '',
    priority: r.priority ?? '',
    assignee: r.assignee ?? '',
    due: r.due ?? '',
    parentId: r.parent_id ?? '',
    url: r.url ?? '',
  };
}

/** Validates JSON and makes sure every block has an id, so citations and block-level backlinks have something to point at. */
export function normalizeContent(content: string): string {
  if (!content) return '';
  JSON.parse(content); // reject malformed documents early
  return withBlockIds(content);
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').slice(0, 50);
}

function validColor(color: string): string {
  if (!COLORS.has(color)) throw new Error(`Unknown color "${color}".`);
  return color;
}

function edgeFields(p: EdgePatch): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  if (p.label !== undefined) out.label = p.label.slice(0, 200);
  if (p.color !== undefined) out.color = validColor(p.color);
  if (p.style !== undefined) {
    if (!['solid', 'dashed', 'dotted'].includes(p.style)) throw new Error('Edge style is solid, dashed or dotted.');
    out.style = p.style;
  }
  if (p.arrow !== undefined) {
    if (!['end', 'start', 'both', 'none'].includes(p.arrow)) throw new Error('Edge arrow is end, start, both or none.');
    out.arrow = p.arrow;
  }
  return out;
}

function defaultSize(kind: CardKind): { w: number; h: number } {
  switch (kind) {
    case 'pdf': return { w: 360, h: 460 };
    case 'image': return { w: 320, h: 260 };
    case 'video': return { w: 400, h: 300 };
    case 'audio': return { w: 340, h: 140 };
    case 'highlight': return { w: 300, h: 160 };
    default: return { w: 320, h: 240 };
  }
}

function num(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('Expected a finite number.');
  return n;
}

const STOPWORDS = new Set(
  'this that with from have your about which their there would could should these those what when where while been being were will into than then them they some such only also very just more most much many other over under again because before after between through during each both does doing done make made like need want using used uses'.split(' '),
);
