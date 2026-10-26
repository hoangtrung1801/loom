import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';

export const DEFAULT_PORT = 21345;
const MAX_BODY = 1024 * 1024;
const TIMEOUT_MS = 30_000;

export interface LocalServerInfo {
  port: number;
  token: string;
  pid: number;
}

type Call = (operation: string, input: unknown) => Promise<{ status: number; body: unknown }>;

/**
 * The automation entry point: HTTP on 127.0.0.1 only, one bearer token per run written to a file
 * only this user can read, small bodies, a deadline per request. It knows nothing about data; every
 * request becomes a named operation the core validates (see core/local-api.ts).
 */
export class LocalServer {
  private server: Server | undefined;
  private info: LocalServerInfo | undefined;

  constructor(
    private readonly infoFile: string,
    private readonly call: Call,
  ) {}

  get running(): LocalServerInfo | undefined {
    return this.info;
  }

  async start(preferredPort = DEFAULT_PORT): Promise<LocalServerInfo> {
    if (this.info) return this.info;
    const token = randomBytes(32).toString('hex');
    const server = createServer((req, res) => void this.handle(req, res, token));
    server.requestTimeout = TIMEOUT_MS;
    let port = 0;
    // The preferred port, a few neighbours, then whatever the OS hands out.
    for (const candidate of [preferredPort, preferredPort + 1, preferredPort + 2, preferredPort + 3, 0]) {
      try {
        port = await listen(server, candidate);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      }
    }
    this.server = server;
    this.info = { port, token, pid: process.pid };
    mkdirSync(dirname(this.infoFile), { recursive: true, mode: 0o700 });
    writeFileSync(this.infoFile, JSON.stringify(this.info), { mode: 0o600 });
    chmodSync(this.infoFile, 0o600); // an older file keeps its mode on overwrite
    return this.info;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.info = undefined;
    rmSync(this.infoFile, { force: true });
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
    const send = (status: number, body: unknown): void => {
      if (res.headersSent) return;
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    const fail = (status: number, code: string, error: string): void => send(status, { error, code, retryable: status >= 500 });
    try {
      // Only local tools: no browser pages (they send Origin), no DNS-rebound hostnames.
      const host = req.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || req.headers.origin) return fail(403, 'forbidden', 'Local clients only.');
      if (!authorized(req.headers.authorization, token)) return fail(401, 'unauthorized', 'Missing or wrong bearer token.');

      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname.replace(/\/+$/, '') || '/';
      if (req.method === 'GET' && path === '/health') return send(200, { ok: true, app: 'loom', pid: process.pid });
      if (req.method === 'GET' && path === '/operations') {
        const out = await this.call('operations', {});
        return send(out.status, out.body);
      }
      const m = /^\/operations\/([A-Za-z]{1,60})$/.exec(path);
      if (!m) return fail(404, 'not_found', 'Try GET /health, GET /operations or POST /operations/<name>.');
      if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Operations are POSTed.');
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? 'application/json')) return fail(415, 'unsupported_media_type', 'Send JSON.');

      const raw = await readBody(req);
      let input: unknown = {};
      if (raw.length) {
        try {
          input = JSON.parse(raw.toString('utf8'));
        } catch {
          return fail(400, 'invalid_json', 'The body is not valid JSON.');
        }
      }
      const out = await withTimeout(this.call(m[1]!, input), TIMEOUT_MS);
      send(out.status, out.body);
    } catch (err) {
      if (err instanceof BodyTooLarge) return fail(413, 'too_large', 'Bodies are limited to 1 MiB.');
      if (err instanceof TimedOut) return fail(504, 'timeout', 'The operation took too long.');
      fail(500, 'failed', err instanceof Error ? err.message : String(err));
    }
  }
}

function authorized(header: string | undefined, token: string): boolean {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(header ?? '');
  return !!m && timingSafeEqual(Buffer.from(m[1]!), Buffer.from(token));
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    });
  });
}

class BodyTooLarge extends Error {}
class TimedOut extends Error {}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        // Stop collecting but keep draining, so the 413 still reaches the client.
        req.removeAllListeners('data');
        req.resume();
        reject(new BodyTooLarge());
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new TimedOut()), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e)),
    );
  });
}
