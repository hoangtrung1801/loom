import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalApi, describeOperations } from '../core/local-api.js';
import { openLibrary } from '../core/library.js';
import { buildApp } from '../core/rpc.js';

/**
 * The core without the app: the same library on disk, the same named operations, run in this process.
 * Used by `loom --data-dir`, `loom mcp --data-dir` and `loom serve`.
 */
export function openHeadless(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const store = openLibrary(dataDir);
  const core = buildApp(store, { filesDir: join(dataDir, 'files') });
  return {
    core,
    call: createLocalApi(core),
    operations: describeOperations,
    close: () => store.close(),
  };
}
