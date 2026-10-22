import { createSyncServer } from './sync-server.js';

const port = Number(process.env.PORT ?? 8787);
const token = process.env.LOOM_SYNC_TOKEN;
if (!token) console.warn('LOOM_SYNC_TOKEN is not set: the server accepts unauthenticated requests.');

createSyncServer({ dbPath: process.env.LOOM_SYNC_DB ?? 'sync-server.db', token }).listen(port, '127.0.0.1', () => {
  console.log(`loom sync server listening on http://127.0.0.1:${port}`);
});
