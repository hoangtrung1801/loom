import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { createRpc } from '../src/core/rpc.js';
import { Store } from '../src/core/store.js';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Serves the same RPC layer Electron uses over HTTP so the UI can run in a
 * plain browser (development and Playwright). Not part of the shipped app.
 */
export function devBridge(dbPath = process.env.LOOM_DB ?? '.dev/loom.db'): Plugin {
  return {
    name: 'loom-dev-bridge',
    configureServer(server) {
      if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
      let store = new Store(dbPath);
      store.seedIfEmpty();
      let rpc = createRpc(store);
      server.httpServer?.on('close', () => store.close());

      // Test-only: start each browser test from a fresh seeded database.
      if (process.env.LOOM_E2E === '1') {
        server.middlewares.use('/__reset', (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST' || req.headers['x-loom'] !== '1') return void res.writeHead(403).end();
          store.close();
          store = new Store(':memory:');
          store.seedIfEmpty();
          rpc = createRpc(store);
          res.writeHead(204).end();
        });
      }

      server.middlewares.use('/rpc', async (req: IncomingMessage, res: ServerResponse) => {
        const reply = (status: number, body: unknown): void => {
          res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body ?? null));
        };
        // Blocks DNS rebinding (Host) and cross-site form posts (custom header forces a CORS preflight).
        if (!LOCAL_HOST.test(req.headers.host ?? '') || req.headers['x-loom'] !== '1' || req.method !== 'POST') {
          return reply(403, { error: 'forbidden' });
        }
        try {
          let body = '';
          for await (const chunk of req) body += chunk;
          reply(200, await rpc(JSON.parse(body)));
        } catch (err) {
          reply(400, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
