import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { createLocalApi } from '../core/local-api.js';
import { buildApp, createRpc } from '../core/rpc.js';
import { serveFile } from '../core/serve-file.js';
import { openLibrary } from '../core/library.js';
import type { CoreRequest, CoreReply } from './core-protocol.js';

/**
 * The data core runs here, off the Electron main thread: SQLite, search, sync, imports and AI loops.
 * The main process only relays messages, so a long query never stalls window, menu or file-protocol work.
 * One thread owns the database, which also serializes every write.
 */
const port = parentPort;
if (!port) throw new Error('core-worker must run as a worker thread');
const { dataDir } = workerData as { dataDir: string };

mkdirSync(dataDir, { recursive: true });
const store = openLibrary(dataDir);
store.seedIfEmpty();
const core = buildApp(store, {
  filesDir: join(dataDir, 'files'),
  backupsDir: join(dataDir, 'backups'),
  emit: (channel, payload) => port.postMessage({ event: { channel, payload } } satisfies CoreReply),
});
const rpc = createRpc(core);
const localApi = createLocalApi(core);
core.backups?.schedule();

async function handle(req: CoreRequest): Promise<{ result: unknown; transfer?: ArrayBuffer[] }> {
  switch (req.op) {
    case 'rpc':
      return { result: await rpc(req.request) };
    case 'upload':
      return { result: core.files.put(req.bytes, { name: req.name, mime: req.mime }) };
    case 'file': {
      const res = serveFile(core.files, req.fileId, req.range);
      // A Buffer may be a view into a shared pool, which can't be transferred; copy it into its own memory,
      // then hand that over rather than cloning it again.
      const body = res.body ? new Uint8Array(res.body) : null;
      return { result: { ...res, body }, transfer: body ? [body.buffer as ArrayBuffer] : [] };
    }
    case 'local':
      return { result: await localApi(req.operation, req.input) };
    case 'close':
      core.backups?.stop();
      store.close();
      return { result: null };
  }
}

const failed = (id: number, err: unknown): void => port.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies CoreReply);
port.on('message', (req: CoreRequest) => {
  void handle(req)
    // A result that can't cross threads fails this one call, not the whole core.
    .then(({ result, transfer }) => port.postMessage({ id: req.id, ok: true, result } satisfies CoreReply, transfer ?? []))
    .catch((err: unknown) => failed(req.id, err));
});
port.postMessage({ ready: true } satisfies CoreReply);
