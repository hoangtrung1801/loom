import { LocalServer } from '../main/local-server.js';
import type { Backend } from './backend.js';

/**
 * `loom serve --data-dir DIR`: the local API without the desktop app, for servers and agent sandboxes.
 * Same port, token file and operations as the app's, so `loom` and `loom mcp` find it the usual way.
 */
export async function serveLocal(backend: Backend, infoFile: string): Promise<void> {
  const server = new LocalServer(infoFile, (operation, input) => (operation === 'operations' ? backend.operations().then((body) => ({ status: 200, body })) : backend.call(operation, input)));
  const info = await server.start();
  process.stderr.write(`loom serve: ${backend.describe} on http://127.0.0.1:${info.port} (token in ${infoFile}). Ctrl+C stops.\n`);
  await new Promise<void>((resolve) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => resolve());
  });
  await server.stop();
  await backend.close();
}
