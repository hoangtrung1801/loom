import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { opSchema, type Op } from '../src/core/entities.js';
import { isFileId } from '../src/core/fileid.js';

const MAX_BODY = 8 * 1024 * 1024;
const pushSchema = z.object({ ops: z.array(opSchema).max(2000) });

/**
 * Minimal reference sync server: an append-only op log with a global sequence.
 * It never interprets ops, so clients do all merging.
 */
export function createSyncServer(options: { dbPath?: string; token?: string; maxFileBytes?: number } = {}): Server {
  const maxFile = options.maxFileBytes ?? 512 * 1024 * 1024;
  const db = new DatabaseSync(options.dbPath ?? ':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS ops (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, device TEXT NOT NULL, body TEXT NOT NULL)`);
  db.exec('CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, bytes BLOB NOT NULL)');
  const hasBlob = db.prepare('SELECT 1 AS x FROM blobs WHERE id = ?');
  const putBlob = db.prepare('INSERT OR IGNORE INTO blobs(id, bytes) VALUES (?, ?)');
  const getBlob = db.prepare('SELECT bytes FROM blobs WHERE id = ?');
  const insert = db.prepare('INSERT OR IGNORE INTO ops(id, device, body) VALUES (?, ?, ?)');
  const scan = db.prepare('SELECT seq, device, body FROM ops WHERE seq > ? ORDER BY seq LIMIT ?');

  const authorized = (req: IncomingMessage): boolean => {
    if (!options.token) return true;
    const given = Buffer.from(req.headers.authorization ?? '');
    const want = Buffer.from(`Bearer ${options.token}`);
    return given.length === want.length && timingSafeEqual(given, want);
  };

  return createServer(async (req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };
    try {
      if (!authorized(req)) return send(401, { error: 'unauthorized' });
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'POST' && url.pathname === '/push') {
        const { ops } = pushSchema.parse(JSON.parse(await readBody(req)));
        db.exec('BEGIN');
        try {
          for (const op of ops) insert.run(op.id, op.device, JSON.stringify(op));
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
        return send(200, { accepted: ops.length });
      }

      if (req.method === 'GET' && url.pathname === '/pull') {
        const since = z.coerce.number().int().min(0).parse(url.searchParams.get('since') ?? 0);
        const limit = z.coerce.number().int().min(1).max(1000).parse(url.searchParams.get('limit') ?? 500);
        const device = url.searchParams.get('device') ?? '';
        const rows = scan.all(since, limit) as { seq: number; device: string; body: string }[];
        const ops: Op[] = rows.filter((r) => r.device !== device).map((r) => JSON.parse(r.body));
        // The cursor advances past our own ops too, so we never rescan them.
        return send(200, { ops, cursor: rows.at(-1)?.seq ?? since, more: rows.length === limit });
      }

      if (req.method === 'POST' && url.pathname === '/files/missing') {
        const { ids } = z.object({ ids: z.array(z.string()).max(1000) }).parse(JSON.parse(await readBody(req)));
        return send(200, { missing: ids.filter((id) => isFileId(id) && !hasBlob.get(id)) });
      }

      const blob = /^\/files\/([0-9a-f]{64})$/.exec(url.pathname);
      if (blob) {
        const id = blob[1]!;
        if (req.method === 'PUT') {
          const bytes = await readBytes(req, maxFile);
          // Content addressing: the server refuses bytes that do not hash to their id.
          if (createHash('sha256').update(bytes).digest('hex') !== id) return send(400, { error: 'content does not match id' });
          putBlob.run(id, bytes);
          return send(200, { ok: true });
        }
        if (req.method === 'GET') {
          const row = getBlob.get(id) as { bytes: Uint8Array } | undefined;
          if (!row) return send(404, { error: 'not found' });
          return void res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': row.bytes.byteLength, 'x-content-type-options': 'nosniff' }).end(row.bytes);
        }
      }

      if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true });
      send(404, { error: 'not found' });
    } catch (err) {
      send(err instanceof z.ZodError || err instanceof SyntaxError ? 400 : 500, { error: err instanceof Error ? err.message : 'error' });
    }
  });
}

async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readBody(req: IncomingMessage): Promise<string> {
  return (await readBytes(req, MAX_BODY)).toString('utf8');
}
