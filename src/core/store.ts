import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { Clock } from './clock.js';
import { ENTITIES, opSchema, type EntityName, type Op, type Scalar } from './entities.js';
import { MIGRATIONS } from './schema.js';
import { docToText, snippet, textDoc, toMatchQuery } from './text.js';

type Row = Record<string, any>;

export interface CardSummary {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  tags: string[];
}
export interface CardDetail {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  backlinks: { id: string; title: string }[];
  boards: { id: string; name: string }[];
}
export interface WhiteboardSummary {
  id: string;
  name: string;
  updatedAt: number;
  cardCount: number;
}
export interface PlacementView {
  id: string;
  cardId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  title: string;
  content: string;
}
export interface EdgeView {
  id: string;
  from: string;
  to: string;
  label: string;
}
export interface BoardData {
  whiteboard: { id: string; name: string };
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
export interface PlacementPatch {
  id: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  z?: number;
}

interface Change {
  entity: EntityName;
  id: string;
  fields: Record<string, Scalar>;
}

const MIN_W = 160;
const MIN_H = 100;

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

  private sql(text: string): StatementSync {
    let s = this.stmts.get(text);
    if (!s) {
      s = this.db.prepare(text);
      this.stmts.set(text, s);
    }
    return s;
  }
  private all(text: string, ...params: Scalar[]): Row[] {
    return this.sql(text).all(...params) as Row[];
  }
  private get(text: string, ...params: Scalar[]): Row | undefined {
    return this.sql(text).get(...params) as Row | undefined;
  }
  private run(text: string, ...params: Scalar[]): void {
    this.sql(text).run(...params);
  }

  private tx<T>(fn: () => T): T {
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
  }

  getMeta(key: string): string | null {
    return (this.get('SELECT value FROM meta WHERE key = ?', key)?.value as string | undefined) ?? null;
  }
  setMeta(key: string, value: string): string {
    this.run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
    return value;
  }

  // -------------------------------------------------------- op log + merging

  /** Records locally-authored changes as ops and applies them, atomically. */
  private commit(changes: Change[]): void {
    this.tx(() => {
      const touched = new Set<string>();
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
  private applyOp(op: Op, touched: Set<string>): void {
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
      if (op.entity === 'card' && (field === 'title' || field === 'content' || field === 'deleted_at')) {
        touched.add(op.entityId);
      }
    }
  }

  private finishWrite(touched: Set<string>): void {
    for (const id of touched) this.reindex(id);
    this.setMeta('hlc', this.clock.last());
  }

  private reindex(cardId: string): void {
    const card = this.get('SELECT title, content, deleted_at FROM cards WHERE id = ?', cardId);
    this.run('DELETE FROM search_index WHERE card_id = ?', cardId);
    if (!card || card.deleted_at != null) return;
    this.run('INSERT INTO search_index(card_id, title, body) VALUES (?, ?, ?)', cardId, card.title, docToText(card.content));
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
      const touched = new Set<string>();
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

  createCard(input: { title?: string; content?: string } = {}): string {
    const id = randomUUID();
    const now = Date.now();
    this.commit([
      { entity: 'card', id, fields: { title: input.title ?? '', content: input.content ?? '', created_at: now, updated_at: now } },
    ]);
    return id;
  }

  updateCard(id: string, patch: { title?: string; content?: string }): void {
    const fields: Record<string, Scalar> = { updated_at: Date.now() };
    if (patch.title !== undefined) fields.title = patch.title.slice(0, 500);
    if (patch.content !== undefined) {
      JSON.parse(patch.content); // reject malformed documents early
      fields.content = patch.content;
    }
    this.requireActive('cards', id);
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

  listCards(limit = 500): CardSummary[] {
    const rows = this.all('SELECT id, title, content, updated_at FROM cards WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?', limit);
    const tags = this.tagsByCard();
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      preview: snippet(docToText(r.content)),
      updatedAt: r.updated_at,
      tags: tags.get(r.id) ?? [],
    }));
  }

  getCard(id: string): CardDetail | null {
    const r = this.get('SELECT * FROM cards WHERE id = ? AND deleted_at IS NULL', id);
    if (!r) return null;
    return {
      id: r.id,
      title: r.title,
      content: r.content,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      tags: this.tagsByCard(id).get(id) ?? [],
      backlinks: this.backlinks(id, r.title),
      boards: this.all(
        `SELECT DISTINCT w.id, w.name FROM placements p JOIN whiteboards w ON w.id = p.whiteboard_id
         WHERE p.card_id = ? AND p.deleted_at IS NULL AND w.deleted_at IS NULL ORDER BY w.name`,
        id,
      ).map((b) => ({ id: b.id, name: b.name })),
    };
  }

  findCardByTitle(title: string): string | null {
    return (this.get('SELECT id FROM cards WHERE lower(title) = lower(?) AND deleted_at IS NULL LIMIT 1', title)?.id as string) ?? null;
  }

  private backlinks(id: string, title: string): { id: string; title: string }[] {
    if (!title.trim()) return [];
    return this.all(
      `SELECT c.id, c.title FROM search_index s JOIN cards c ON c.id = s.card_id
       WHERE c.deleted_at IS NULL AND c.id != ? AND instr(lower(s.body), lower(?)) > 0`,
      id, `[[${title}]]`,
    ).map((r) => ({ id: r.id, title: r.title }));
  }

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
  listTags(): { tag: string; count: number }[] {
    return this.all(
      `SELECT t.tag, COUNT(*) AS n FROM card_tags t JOIN cards c ON c.id = t.card_id
       WHERE t.deleted_at IS NULL AND c.deleted_at IS NULL GROUP BY t.tag ORDER BY n DESC, t.tag`,
    ).map((r) => ({ tag: r.tag, count: r.n }));
  }
  private tagsByCard(only?: string): Map<string, string[]> {
    const rows = only
      ? this.all('SELECT card_id, tag FROM card_tags WHERE deleted_at IS NULL AND card_id = ? ORDER BY tag', only)
      : this.all('SELECT card_id, tag FROM card_tags WHERE deleted_at IS NULL ORDER BY tag');
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.card_id, [...(map.get(r.card_id) ?? []), r.tag]);
    return map;
  }

  // ------------------------------------------------------------ whiteboards

  createWhiteboard(name = 'Untitled whiteboard'): string {
    const id = randomUUID();
    const now = Date.now();
    this.commit([{ entity: 'whiteboard', id, fields: { name: name.slice(0, 200), created_at: now, updated_at: now } }]);
    return id;
  }
  renameWhiteboard(id: string, name: string): void {
    this.requireActive('whiteboards', id);
    this.commit([{ entity: 'whiteboard', id, fields: { name: name.slice(0, 200), updated_at: Date.now() } }]);
  }
  trashWhiteboard(id: string): void {
    this.requireActive('whiteboards', id);
    this.commit([{ entity: 'whiteboard', id, fields: { deleted_at: Date.now() } }]);
  }
  listWhiteboards(): WhiteboardSummary[] {
    return this.all(
      `SELECT w.id, w.name, w.updated_at,
              (SELECT COUNT(*) FROM placements p JOIN cards c ON c.id = p.card_id
                WHERE p.whiteboard_id = w.id AND p.deleted_at IS NULL AND c.deleted_at IS NULL) AS n
       FROM whiteboards w WHERE w.deleted_at IS NULL ORDER BY w.created_at, w.id`,
    ).map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at, cardCount: r.n }));
  }

  getWhiteboard(id: string): BoardData | null {
    const w = this.get('SELECT id, name FROM whiteboards WHERE id = ? AND deleted_at IS NULL', id);
    if (!w) return null;
    const placements = this.all(
      `SELECT p.id, p.card_id, p.x, p.y, p.w, p.h, p.z, c.title, c.content
       FROM placements p JOIN cards c ON c.id = p.card_id
       WHERE p.whiteboard_id = ? AND p.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY p.z, p.id`,
      id,
    ).map((r) => ({ id: r.id, cardId: r.card_id, x: r.x, y: r.y, w: r.w, h: r.h, z: r.z, title: r.title, content: r.content }));
    const edges = this.all(
      `SELECT e.id, e.from_id, e.to_id, e.label FROM edges e
       JOIN placements a ON a.id = e.from_id AND a.deleted_at IS NULL
       JOIN placements b ON b.id = e.to_id AND b.deleted_at IS NULL
       WHERE e.whiteboard_id = ? AND e.deleted_at IS NULL`,
      id,
    ).map((r) => ({ id: r.id, from: r.from_id, to: r.to_id, label: r.label }));
    return { whiteboard: { id: w.id, name: w.name }, placements, edges };
  }

  addCardToWhiteboard(whiteboardId: string, cardId: string, x: number, y: number): string {
    this.requireActive('whiteboards', whiteboardId);
    this.requireActive('cards', cardId);
    const id = randomUUID();
    this.commit([{ entity: 'placement', id, fields: this.placementFields(whiteboardId, cardId, x, y) }]);
    return id;
  }

  /** Creates a blank card and places it in one atomic step. */
  createCardOnWhiteboard(whiteboardId: string, x: number, y: number): { cardId: string; placementId: string } {
    this.requireActive('whiteboards', whiteboardId);
    return this.tx(() => {
      const cardId = this.createCard();
      return { cardId, placementId: this.addCardToWhiteboard(whiteboardId, cardId, x, y) };
    });
  }

  private placementFields(whiteboardId: string, cardId: string, x: number, y: number): Record<string, Scalar> {
    const top = this.get('SELECT COALESCE(MAX(z), 0) AS z FROM placements WHERE whiteboard_id = ? AND deleted_at IS NULL', whiteboardId)?.z as number;
    return { whiteboard_id: whiteboardId, card_id: cardId, x: num(x), y: num(y), w: 320, h: 240, z: top + 1, deleted_at: null };
  }

  updatePlacements(patches: PlacementPatch[]): void {
    const changes: Change[] = [];
    for (const p of patches) {
      const fields: Record<string, Scalar> = {};
      if (p.x !== undefined) fields.x = num(p.x);
      if (p.y !== undefined) fields.y = num(p.y);
      if (p.w !== undefined) fields.w = Math.max(MIN_W, num(p.w));
      if (p.h !== undefined) fields.h = Math.max(MIN_H, num(p.h));
      if (p.z !== undefined) fields.z = Math.trunc(num(p.z));
      if (Object.keys(fields).length) changes.push({ entity: 'placement', id: p.id, fields });
    }
    if (changes.length) this.commit(changes);
  }

  removePlacements(ids: string[]): void {
    this.commit(ids.flatMap((id) => this.placementRemoval(id)));
  }

  private placementRemoval(placementId: string): Change[] {
    const now = Date.now();
    const changes: Change[] = [{ entity: 'placement', id: placementId, fields: { deleted_at: now } }];
    for (const e of this.all('SELECT id FROM edges WHERE (from_id = ? OR to_id = ?) AND deleted_at IS NULL', placementId, placementId)) {
      changes.push({ entity: 'edge', id: e.id, fields: { deleted_at: now } });
    }
    return changes;
  }

  // ------------------------------------------------------------------ edges

  createEdge(whiteboardId: string, fromId: string, toId: string): string {
    if (fromId === toId) throw new Error('A card cannot connect to itself.');
    for (const pid of [fromId, toId]) {
      const p = this.get('SELECT whiteboard_id FROM placements WHERE id = ? AND deleted_at IS NULL', pid);
      if (!p || p.whiteboard_id !== whiteboardId) throw new Error('Both cards must be on this whiteboard.');
    }
    const existing = this.get(
      'SELECT id FROM edges WHERE whiteboard_id = ? AND from_id = ? AND to_id = ? AND deleted_at IS NULL',
      whiteboardId, fromId, toId,
    );
    if (existing) return existing.id as string;
    const id = randomUUID();
    this.commit([{ entity: 'edge', id, fields: { whiteboard_id: whiteboardId, from_id: fromId, to_id: toId, label: '', deleted_at: null } }]);
    return id;
  }
  setEdgeLabel(id: string, label: string): void {
    this.commit([{ entity: 'edge', id, fields: { label: label.slice(0, 200) } }]);
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
    if (this.listWhiteboards().length || this.listCards(1).length) return;
    const at = 1_700_000_000_000;
    const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const [board, welcome, linking, placeA, placeB, edge] = [1, 2, 3, 4, 5, 6].map(id) as [string, string, string, string, string, string];
    this.commit([
      { entity: 'whiteboard', id: board, fields: { name: 'Getting started', created_at: at, updated_at: at } },
      {
        entity: 'card', id: welcome,
        fields: {
          title: 'Welcome to Loom', created_at: at, updated_at: at,
          content: textDoc([
            'Cards are notes. Whiteboards are where you arrange them spatially.',
            '- Double-click empty space to create a card',
            '- Drag the dot on a card’s edge onto another card to connect them',
            '- Press Ctrl/⌘ K to search everything',
            'Link notes with double brackets, like [[Linking ideas]].',
          ]),
        },
      },
      {
        entity: 'card', id: linking,
        fields: {
          title: 'Linking ideas', created_at: at, updated_at: at,
          content: textDoc(['Any card that mentions [[Welcome to Loom]] shows up under Backlinks in the side panel.']),
        },
      },
      { entity: 'placement', id: placeA, fields: { whiteboard_id: board, card_id: welcome, x: 80, y: 80, w: 320, h: 320, z: 1, deleted_at: null } },
      { entity: 'placement', id: placeB, fields: { whiteboard_id: board, card_id: linking, x: 520, y: 160, w: 320, h: 240, z: 2, deleted_at: null } },
      { entity: 'edge', id: edge, fields: { whiteboard_id: board, from_id: placeA, to_id: placeB, label: '', deleted_at: null } },
      { entity: 'cardTag', id: `${welcome}:start-here`, fields: { card_id: welcome, tag: 'start-here', deleted_at: null } },
    ]);
  }
}

function rowToOp(r: Row): Op {
  return { id: r.id, entity: r.entity, entityId: r.entity_id, fields: JSON.parse(r.fields), ts: r.ts, device: r.device };
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').slice(0, 50);
}

function num(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('Expected a finite number.');
  return n;
}
