import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type * as RpcModule from '../src/core/rpc.js';
import type * as ServeModule from '../src/core/serve-file.js';
import type * as StoreModule from '../src/core/store.js';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const MAX_UPLOAD = 512 * 1024 * 1024;

export const SQLITE_HINT =
  'Loom needs the built-in node:sqlite module. Use Bun >= 1.4 (run `bun upgrade`) or Node >= 22.13.';

/**
 * Serves the same core Electron uses over HTTP so the UI can run in a plain browser
 * (development and Playwright). Not part of the shipped app.
 */
export function devBridge(dbPath = process.env.LOOM_DB ?? '.dev/loom.db'): Plugin {
  return {
    name: 'loom-dev-bridge',
    // The store is loaded through Vite's SSR loader when the dev server starts, never at config-load
    // time. A static import would pull node:sqlite into every `vite build`, which does not need it
    // and which fails outright on Bun < 1.4.
    async configureServer(server) {
      let Store: typeof StoreModule.Store;
      let rpcModule: typeof RpcModule;
      let serveFile: typeof ServeModule.serveFile;
      try {
        ({ Store } = (await server.ssrLoadModule('/@fs' + resolve('src/core/store.ts'))) as typeof StoreModule);
        rpcModule = (await server.ssrLoadModule('/@fs' + resolve('src/core/rpc.ts'))) as typeof RpcModule;
        ({ serveFile } = (await server.ssrLoadModule('/@fs' + resolve('src/core/serve-file.ts'))) as typeof ServeModule);
      } catch (err) {
        throw new Error(`${SQLITE_HINT}\n(${err instanceof Error ? err.message : String(err)})`);
      }
      const memory = dbPath === ':memory:';
      if (!memory) mkdirSync(dirname(dbPath), { recursive: true });
      const filesDir = (): string => (memory ? mkdtempSync(join(tmpdir(), 'loom-dev-files-')) : join(dirname(dbPath), 'files'));

      const listeners = new Set<ServerResponse>();
      const emit = (channel: string, payload: unknown): void => {
        const data = `data: ${JSON.stringify({ channel, payload })}\n\n`;
        for (const res of listeners) res.write(data);
      };
      const open = (path: string) => {
        const store = new Store(path);
        store.seedIfEmpty();
        const core = rpcModule.buildApp(store, { filesDir: filesDir(), emit });
        return { store, core, rpc: rpcModule.createRpc(core) };
      };
      let state = open(dbPath);
      server.httpServer?.on('close', () => state.store.close());

      // Blocks DNS rebinding (Host) and cross-site requests (the custom header forces a CORS preflight).
      const allowed = (req: IncomingMessage): boolean => LOCAL_HOST.test(req.headers.host ?? '') && req.headers['x-loom'] === '1';

      // Test-only: start each browser test from a fresh seeded database.
      if (process.env.LOOM_E2E === '1') {
        server.middlewares.use('/__reset', (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST' || !allowed(req)) return void res.writeHead(403).end();
          state.store.close();
          state = open(':memory:');
          res.writeHead(204).end();
        });
      }

      server.middlewares.use('/events', (req: IncomingMessage, res: ServerResponse) => {
        if (!LOCAL_HOST.test(req.headers.host ?? '')) return void res.writeHead(403).end();
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': connected\n\n');
        listeners.add(res);
        req.on('close', () => listeners.delete(res));
      });

      server.middlewares.use('/file', (req: IncomingMessage, res: ServerResponse) => {
        if (!LOCAL_HOST.test(req.headers.host ?? '') || req.method !== 'GET') return void res.writeHead(403).end();
        const id = (req.url ?? '').replace(/^\//, '').split(/[?#]/)[0]!;
        const out = serveFile(state.core.files, id, req.headers.range ?? null);
        res.writeHead(out.status, out.headers).end(out.body ? Buffer.from(out.body) : undefined);
      });

      server.middlewares.use('/upload', async (req: IncomingMessage, res: ServerResponse) => {
        const reply = (status: number, body: unknown): void => void res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
        if (!allowed(req) || req.method !== 'POST') return reply(403, { error: 'forbidden' });
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += (chunk as Buffer).length;
            if (size > MAX_UPLOAD) throw new Error('That file is too large (limit 512 MB).');
            chunks.push(chunk as Buffer);
          }
          const name = decodeURIComponent(String(req.headers['x-name'] ?? 'file'));
          const mime = String(req.headers['content-type'] ?? 'application/octet-stream');
          reply(200, state.core.files.put(new Uint8Array(Buffer.concat(chunks)), { name, mime }));
        } catch (err) {
          reply(400, { error: err instanceof Error ? err.message : String(err) });
        }
      });

      server.middlewares.use('/rpc', async (req: IncomingMessage, res: ServerResponse) => {
        const reply = (status: number, body: unknown): void => {
          res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body ?? null));
        };
        if (!allowed(req) || req.method !== 'POST') return reply(403, { error: 'forbidden' });
        try {
          let body = '';
          for await (const chunk of req) body += chunk;
          reply(200, await state.rpc(JSON.parse(body)));
        } catch (err) {
          reply(400, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
