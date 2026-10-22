export {};
const port = Number(process.env.PORT ?? 8787);
const token = process.env.LOOM_SYNC_TOKEN;
if (!token) console.warn('LOOM_SYNC_TOKEN is not set: the server accepts unauthenticated requests.');

// Loaded lazily so a runtime without node:sqlite fails with an actionable message.
const { createSyncServer } = await import('./sync-server.js').catch((err: unknown) => {
  console.error('Loom needs the built-in node:sqlite module. Use Bun >= 1.4 (run `bun upgrade`) or Node >= 22.13.');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

createSyncServer({ dbPath: process.env.LOOM_SYNC_DB ?? 'sync-server.db', token }).listen(port, '127.0.0.1', () => {
  console.log(`loom sync server listening on http://127.0.0.1:${port}`);
});
