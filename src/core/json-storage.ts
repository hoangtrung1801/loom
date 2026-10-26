import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { ENTITIES, type EntityName, type Op } from './entities.js';
import { MIGRATIONS } from './schema.js';
import type { Store } from './store.js';

/**
 * Loom's data on disk is plain JSON. SQLite only runs in memory, as the query and full-text engine;
 * it is filled from these files at startup and every committed change is written straight back.
 *
 *   loom.json                 format marker and schema version
 *   meta.json                 device id, clock, sync and AI settings (this device only; mode 0600)
 *   cards/<id>.json           one file per record, for every synced table, with a `_clock` of
 *   whiteboards/<id>.json     per-field timestamps that last-write-wins merging needs
 *   …
 *   ops.jsonl                 the change log, one op per line, append-only
 *   outbox.json               ids of ops not yet pushed to the sync server
 *
 * Every file is replaced atomically (write to a temp file, fsync, rename), so a crash leaves either
 * the old or the new version, never half of one. Derived data (backlinks, to-dos, search) is rebuilt
 * on load and never stored.
 */

export const FORMAT = 'loom-json';
export const FORMAT_VERSION = 1;

const TABLE_ENTITY = new Map<string, EntityName>(Object.entries(ENTITIES).map(([name, e]) => [e.table, name as EntityName]));
const TABLES = [...TABLE_ENTITY.keys()];
/** Text columns that hold JSON; on disk they are written as nested JSON so the files read naturally. */
const JSON_COLUMNS: Record<string, readonly string[]> = { cards: ['content', 'meta'], chats: ['context'], chat_messages: ['sources'], tag_props: ['options'] };
/** Never written to backups or exports: they only make sense on this device and some are secrets. */
const SECRET_META = new Set(['ai_key', 'sync_token']);

type Row = Record<string, unknown>;

export interface LoadReport {
  records: number;
  ops: number;
  /** Files that could not be read; they are left untouched on disk. */
  skipped: string[];
}

/** File name for a record id: ids that are already safe keep their name, anything else is hashed. */
export function fileNameFor(id: string): string {
  return /^[a-z0-9][a-z0-9_-]{0,99}$/.test(id) ? `${id}.json` : `x-${createHash('sha256').update(id).digest('hex').slice(0, 40)}.json`;
}

export function writeFileAtomic(path: string, text: string, mode = 0o644): void {
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w', mode);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

function encodeRow(table: string, row: Row, clock: Record<string, string>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' && JSON_COLUMNS[table]?.includes(key) && /^[[{]/.test(value)) {
      try {
        out[key] = JSON.parse(value);
        continue;
      } catch {
        /* not JSON after all: keep the string */
      }
    }
    out[key] = value;
  }
  if (Object.keys(clock).length) out._clock = clock;
  return out;
}

function decodeValue(table: string, key: string, value: unknown): string | number | null {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value as string | number | null;
  if (JSON_COLUMNS[table]?.includes(key) && typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  throw new Error(`unexpected value for ${key}`);
}

export class JsonStorage {
  private readonly dirtyRecords = new Map<string, Set<string>>();
  private readonly newOps: Op[] = [];
  private metaDirty = false;
  private outboxDirty = false;
  private readonly columns = new Map<string, Set<string>>();

  constructor(readonly dir: string) {}

  // --------------------------------------------------------------- tracking

  touch(table: string, id: string): void {
    let set = this.dirtyRecords.get(table);
    if (!set) this.dirtyRecords.set(table, (set = new Set()));
    set.add(id);
  }
  addOp(op: Op, pushed: boolean): void {
    this.newOps.push(op);
    if (!pushed) this.outboxDirty = true;
  }
  touchMeta(): void {
    this.metaDirty = true;
  }
  touchOutbox(): void {
    this.outboxDirty = true;
  }
  /** A transaction rolled back: nothing it touched reached the database, so nothing is written. */
  discard(): void {
    this.dirtyRecords.clear();
    this.newOps.length = 0;
    this.metaDirty = false;
    this.outboxDirty = false;
  }
  get pending(): boolean {
    return this.dirtyRecords.size > 0 || this.newOps.length > 0 || this.metaDirty || this.outboxDirty;
  }

  // ----------------------------------------------------------------- writing

  /** Writes everything changed since the last flush. Items are cleared only once written, so a failure retries. */
  flush(store: Store): void {
    if (!this.pending) return;
    this.ensureLayout();
    for (const [table, ids] of this.dirtyRecords) {
      for (const id of [...ids]) {
        this.writeRecord(store, table, id);
        ids.delete(id);
      }
      this.dirtyRecords.delete(table);
    }
    if (this.newOps.length) {
      appendFileSync(join(this.dir, 'ops.jsonl'), this.newOps.map((op) => `${JSON.stringify(op)}\n`).join(''));
      this.newOps.length = 0;
    }
    if (this.metaDirty) {
      const meta = Object.fromEntries(store.all('SELECT key, value FROM meta ORDER BY key').map((r) => [r.key, r.value]));
      writeFileAtomic(join(this.dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 0o600);
      this.metaDirty = false;
    }
    if (this.outboxDirty) {
      const ids = store.all('SELECT id FROM ops WHERE pushed = 0 ORDER BY seq').map((r) => r.id);
      writeFileAtomic(join(this.dir, 'outbox.json'), `${JSON.stringify(ids)}\n`);
      this.outboxDirty = false;
    }
  }

  private writeRecord(store: Store, table: string, id: string): void {
    const entity = TABLE_ENTITY.get(table)!;
    const path = join(this.dir, table, fileNameFor(id));
    const row = store.get(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!row) return rmSync(path, { force: true });
    const clock = Object.fromEntries(store.all('SELECT field, ts FROM field_clock WHERE entity = ? AND entity_id = ? ORDER BY field', entity, id).map((r) => [r.field, r.ts]));
    writeFileAtomic(path, `${JSON.stringify(encodeRow(table, row, clock), null, 2)}\n`);
  }

  private ensureLayout(): void {
    mkdirSync(this.dir, { recursive: true });
    const marker = join(this.dir, 'loom.json');
    if (!existsSync(marker)) {
      writeFileAtomic(marker, `${JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, schema: MIGRATIONS.length, createdAt: new Date().toISOString() }, null, 2)}\n`);
    }
    for (const table of TABLES) mkdirSync(join(this.dir, table), { recursive: true });
  }

  /** Writes every record, the whole change log and the settings: used when a library is first created from another source. */
  writeAll(store: Store): void {
    this.ensureLayout();
    for (const table of TABLES) for (const r of store.all(`SELECT id FROM ${table}`)) this.touch(table, r.id as string);
    const ops = store.all('SELECT * FROM ops ORDER BY seq');
    writeFileAtomic(
      join(this.dir, 'ops.jsonl'),
      ops.map((r) => `${JSON.stringify({ id: r.id, entity: r.entity, entityId: r.entity_id, fields: JSON.parse(r.fields as string), ts: r.ts, device: r.device })}\n`).join(''),
    );
    this.metaDirty = true;
    this.outboxDirty = true;
    this.flush(store);
  }

  // ----------------------------------------------------------------- reading

  exists(): boolean {
    return existsSync(join(this.dir, 'loom.json'));
  }

  /** Fills an empty in-memory store from the files. Runs inside one transaction and marks nothing dirty. */
  load(store: Store): LoadReport {
    const report: LoadReport = { records: 0, ops: 0, skipped: [] };
    if (!this.exists()) return report;
    const marker = JSON.parse(readFileSync(join(this.dir, 'loom.json'), 'utf8')) as { format?: string; version?: number; schema?: number };
    if (marker.format !== FORMAT) throw new Error(`${this.dir} is not a Loom library.`);
    if ((marker.version ?? 0) > FORMAT_VERSION || (marker.schema ?? 0) > MIGRATIONS.length) {
      throw new Error('This Loom library was written by a newer version of Loom. Update the app to open it.');
    }

    const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
    store.tx(() => {
      const metaPath = join(this.dir, 'meta.json');
      if (existsSync(metaPath)) {
        for (const [key, value] of Object.entries(readJson(metaPath) as Record<string, unknown>)) {
          if (typeof value === 'string') store.run('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)', key, value);
        }
      }

      for (const table of TABLES) {
        const folder = join(this.dir, table);
        if (!existsSync(folder)) continue;
        const entity = TABLE_ENTITY.get(table)!;
        const cols = this.columnsOf(store, table);
        for (const name of readdirSync(folder)) {
          if (!name.endsWith('.json')) continue;
          const path = join(folder, name);
          try {
            const record = readJson(path) as Row;
            if (!record || typeof record !== 'object' || typeof record.id !== 'string') throw new Error('no id');
            const keys = Object.keys(record).filter((k) => cols.has(k));
            const values = keys.map((k) => decodeValue(table, k, record[k]));
            store.run(`INSERT OR REPLACE INTO ${table}(${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...values);
            const clock = record._clock;
            if (clock && typeof clock === 'object') {
              for (const [field, ts] of Object.entries(clock as Record<string, unknown>)) {
                if (typeof ts === 'string') store.run('INSERT OR REPLACE INTO field_clock(entity, entity_id, field, ts) VALUES (?, ?, ?, ?)', entity, record.id, field, ts);
              }
            }
            report.records++;
          } catch {
            report.skipped.push(path);
          }
        }
      }

      let outbox = new Set<string>();
      const outboxPath = join(this.dir, 'outbox.json');
      if (existsSync(outboxPath)) {
        try {
          outbox = new Set(readJson(outboxPath) as string[]);
        } catch {
          report.skipped.push(outboxPath);
        }
      }
      const opsPath = join(this.dir, 'ops.jsonl');
      if (existsSync(opsPath)) {
        for (const line of readFileSync(opsPath, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            const op = JSON.parse(line) as Op;
            store.run(
              'INSERT OR IGNORE INTO ops(id, entity, entity_id, fields, ts, device, pushed) VALUES (?, ?, ?, ?, ?, ?, ?)',
              op.id, op.entity, op.entityId, JSON.stringify(op.fields), op.ts, op.device, outbox.has(op.id) ? 0 : 1,
            );
            report.ops++;
          } catch {
            // A crash mid-append can leave the last line cut short; everything before it is intact.
          }
        }
      }
    });
    this.discard();
    return report;
  }

  private columnsOf(store: Store, table: string): Set<string> {
    let cols = this.columns.get(table);
    if (!cols) {
      cols = new Set(store.all(`SELECT name FROM pragma_table_info('${table}')`).map((r) => r.name as string));
      this.columns.set(table, cols);
    }
    return cols;
  }
}

/** The whole current state as one JSON document (backups). Secrets are left out. */
export function snapshot(store: Store): Row {
  const records: Record<string, Row[]> = {};
  for (const table of TABLES) {
    const entity = TABLE_ENTITY.get(table)!;
    const clocks = new Map<string, Record<string, string>>();
    for (const c of store.all('SELECT entity_id, field, ts FROM field_clock WHERE entity = ?', entity)) {
      const m = clocks.get(c.entity_id as string) ?? {};
      m[c.field as string] = c.ts as string;
      clocks.set(c.entity_id as string, m);
    }
    records[table] = store.all(`SELECT * FROM ${table} ORDER BY id`).map((r) => encodeRow(table, r, clocks.get(r.id as string) ?? {}));
  }
  const meta = Object.fromEntries(store.all('SELECT key, value FROM meta ORDER BY key').filter((r) => !SECRET_META.has(r.key as string)).map((r) => [r.key, r.value]));
  return { format: `${FORMAT}-snapshot`, version: FORMAT_VERSION, schema: MIGRATIONS.length, takenAt: new Date().toISOString(), meta, records };
}
