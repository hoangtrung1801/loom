import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createSyncServer } from '../server/sync-server.js';
import { buildApp, createRpc } from '../src/core/rpc.js';
import { httpTransport, runSync } from '../src/core/sync.js';
import { Files } from '../src/core/files.js';
import { Store } from '../src/core/store.js';
import { textDoc } from '../src/core/text.js';

const stores: Store[] = [];
const servers: Server[] = [];
const mem = (): Store => {
  const s = new Store(':memory:');
  stores.push(s);
  return s;
};
async function serve(token?: string): Promise<string> {
  const server = createSyncServer({ token });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  servers.splice(0).forEach((s) => s.close());
});

const snapshot = (s: Store) => ({
  cards: s.listCards().map((c) => [c.id, c.title, c.preview, c.tags]).sort(),
  boards: s.listWhiteboards().map((b) => [b.id, b.name, b.cardCount]),
});

describe('sync', () => {
  it('replicates a board between two devices', async () => {
    const url = await serve();
    const a = mem();
    const b = mem();
    const board = a.createWhiteboard('Shared');
    const x = a.createCardOnWhiteboard(board, 5, 6);
    const y = a.createCardOnWhiteboard(board, 400, 6);
    a.updateCard(x.cardId, { title: 'Hello', content: textDoc(['from device A']) });
    a.createEdge(board, x.placementId, y.placementId);
    a.addTag(x.cardId, 'sync');

    expect(await runSync(a, httpTransport(url))).toMatchObject({ pulled: 0 });
    const result = await runSync(b, httpTransport(url));
    expect(result.pulled).toBeGreaterThan(0);

    expect(snapshot(b)).toEqual(snapshot(a));
    const data = b.getWhiteboard(board)!;
    expect(data.placements).toHaveLength(2);
    expect(data.edges).toHaveLength(1);
    expect(b.search('device')[0]?.title).toBe('Hello'); // search index rebuilt on the receiving side
    expect(a.pendingCount()).toBe(0);
  });

  it('merges concurrent edits to different fields and picks the later write for the same field', async () => {
    const url = await serve();
    const a = mem();
    const b = mem();
    const id = a.createCard({ title: 'base', content: textDoc(['one']) });
    await runSync(a, httpTransport(url));
    await runSync(b, httpTransport(url));

    // offline edits on both devices
    a.updateCard(id, { title: 'title from A' });
    b.updateCard(id, { content: textDoc(['content from B']) });
    await new Promise((r) => setTimeout(r, 5));
    b.updateCard(id, { title: 'title from B (later)' });

    for (const s of [a, b, a, b]) await runSync(s, httpTransport(url));
    for (const s of [a, b]) {
      const card = s.getCard(id)!;
      expect(card.title).toBe('title from B (later)');
      expect(card.content).toContain('content from B');
    }
  });

  it('keeps a deletion even when the other device edits afterwards', async () => {
    const url = await serve();
    const a = mem();
    const b = mem();
    const id = a.createCard({ title: 'doomed' });
    await runSync(a, httpTransport(url));
    await runSync(b, httpTransport(url));
    a.trashCard(id);
    b.updateCard(id, { title: 'edited elsewhere' });
    for (const s of [a, b, a, b]) await runSync(s, httpTransport(url));
    expect(a.getCard(id)).toBeNull();
    expect(b.getCard(id)).toBeNull();
    expect(b.search('edited')).toEqual([]);
  });

  it('is idempotent and order independent', () => {
    const a = mem();
    const id = a.createCard({ title: 'one' });
    a.updateCard(id, { title: 'two' });
    a.updateCard(id, { title: 'three' });
    const ops = a.pendingOps();

    const forward = mem();
    const reversed = mem();
    expect(forward.applyRemote(ops)).toBe(ops.length);
    expect(forward.applyRemote(ops)).toBe(0);
    reversed.applyRemote([...ops].reverse());
    expect(forward.getCard(id)?.title).toBe('three');
    expect(reversed.getCard(id)?.title).toBe('three');
  });

  it('rejects ops that touch unknown fields, tables, or malformed timestamps, writing nothing', () => {
    const s = mem();
    const good = { id: 'o1', entity: 'card', entityId: 'c1', fields: { title: 'ok' }, ts: '0001700000000.0000.dev', device: 'dev' };
    const evil = { ...good, id: 'o2', fields: { 'title = 1; DROP TABLE cards; --': 'x' } };
    expect(() => s.applyRemote([good, evil])).toThrow(/not writable/);
    expect(() => s.applyRemote([{ ...good, entity: 'ops' }])).toThrow();
    expect(() => s.applyRemote([{ ...good, ts: 'zzz' }])).toThrow();
    expect(s.listCards()).toEqual([]); // the valid op in the rejected batch was not applied either
  });

  it('local writes after receiving an op always sort after it, even from a skewed clock', () => {
    const b = mem();
    const id = b.createCard({ title: 'v1' });
    const wall = String(Date.now() + 3_600_000).padStart(13, '0');
    b.applyRemote([{ id: 'future', entity: 'card', entityId: id, fields: { title: 'from the future' }, ts: `${wall}.0000.skewed`, device: 'skewed' }]);
    expect(b.getCard(id)?.title).toBe('from the future');
    b.updateCard(id, { title: 'edited after seeing it' });
    expect(b.getCard(id)?.title).toBe('edited after seeing it');
  });

  it('enforces the bearer token', async () => {
    const url = await serve('s3cret');
    const a = mem();
    a.createCard({ title: 'x' });
    await expect(runSync(a, httpTransport(url))).rejects.toThrow(/401/);
    await expect(runSync(a, httpTransport(url, 'wrong'))).rejects.toThrow(/401/);
    await expect(runSync(a, httpTransport(url, 's3cret'))).resolves.toMatchObject({ pushed: 1 });
  });

  it('syncs more than one batch', async () => {
    const url = await serve();
    const a = mem();
    const b = mem();
    for (let i = 0; i < 260; i++) a.createCard({ title: `card ${i}` });
    await runSync(a, httpTransport(url));
    await runSync(b, httpTransport(url));
    expect(b.listCards()).toHaveLength(260);
  });
});

describe('demo content', () => {
  it('two devices that each seed independently do not duplicate it after syncing', async () => {
    const url = await serve();
    const a = mem();
    const b = mem();
    a.seedIfEmpty();
    b.seedIfEmpty();
    for (const s of [a, b, a, b]) await runSync(s, httpTransport(url));
    for (const s of [a, b]) {
      expect(s.listWhiteboards()).toHaveLength(1);
      expect(s.listCards().map((c) => c.title).sort()).toEqual(['Linking ideas', 'Welcome to Loom']);
      const data = s.getWhiteboard(s.listWhiteboards()[0]!.id)!;
      expect(data.placements).toHaveLength(2);
      expect(data.edges).toHaveLength(1);
    }
    expect(snapshot(a)).toEqual(snapshot(b));
  });
});

describe('attachment sync', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const device = () => {
    const dir = mkdtempSync(join(tmpdir(), 'loom-blobs-'));
    dirs.push(dir);
    const store = mem();
    return { store, files: new Files(store, dir) };
  };

  it('uploads attachment bytes and downloads them on another device, verified by hash', async () => {
    const url = await serve();
    const a = device();
    const b = device();
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 7) % 256);
    const fileId = a.files.put(bytes, { name: 'pic.png', mime: 'image/png' });
    const card = a.store.createCard({ title: 'Picture', kind: 'image', fileId });

    expect(await runSync(a.store, httpTransport(url), a.files)).toMatchObject({ files: { up: 1, down: 0, failed: 0 } });
    // metadata arrives with the ops, bytes with the blob phase of the same sync
    const result = await runSync(b.store, httpTransport(url), b.files);
    expect(result.files).toEqual({ up: 0, down: 1, failed: 0 });
    expect(b.store.getCard(card)?.fileId).toBe(fileId);
    expect(createHash('sha256').update(b.files.read(fileId)).digest('hex')).toBe(fileId);
    // nothing left to move
    expect((await runSync(b.store, httpTransport(url), b.files)).files).toEqual({ up: 0, down: 0, failed: 0 });
  });

  it('rejects bytes that do not hash to their id and leaves other files unaffected', async () => {
    const url = await serve('tok');
    const wrong = 'a'.repeat(64);
    const res = await fetch(`${url}/files/${wrong}`, { method: 'PUT', headers: { authorization: 'Bearer tok' }, body: new Uint8Array([1, 2, 3]) });
    expect(res.status).toBe(400);
    expect((await fetch(`${url}/files/${wrong}`, { method: 'GET', headers: { authorization: 'Bearer tok' } })).status).toBe(404);
    expect((await fetch(`${url}/files/${wrong}`, { method: 'PUT', body: new Uint8Array([1]) })).status).toBe(401);
    expect((await fetch(`${url}/files/not-a-hash`, { method: 'GET', headers: { authorization: 'Bearer tok' } })).status).toBe(404);
  });

  it('refuses to store a download that does not match, and keeps syncing ops', async () => {
    const url = await serve();
    const a = device();
    const b = device();
    const fileId = a.files.put(new Uint8Array([9, 9, 9]), { name: 'x.txt', mime: 'text/plain' });
    a.store.createCard({ title: 'Doc', kind: 'file', fileId });
    await runSync(a.store, httpTransport(url), a.files);
    const honest = httpTransport(url);
    const lying = { ...honest, blobs: { ...honest.blobs!, get: async () => new Uint8Array([1, 2, 3]) } };
    const result = await runSync(b.store, lying, b.files);
    expect(result.files).toEqual({ up: 0, down: 0, failed: 1 });
    expect(result.pulled).toBeGreaterThan(0);
    expect(b.files.has(fileId)).toBe(false);
    // the next sync with an honest server repairs it
    expect((await runSync(b.store, httpTransport(url), b.files)).files.down).toBe(1);
    expect(b.files.has(fileId)).toBe(true);
  });
});

describe('rpc', () => {
  it('only exposes whitelisted methods and validates the envelope', async () => {
    const s = mem();
    const rpc = createRpc(buildApp(s, { filesDir: null }));
    const id = (await rpc({ method: 'createCard', args: [{ title: 'via rpc' }] })) as string;
    expect(((await rpc({ method: 'getCard', args: [id] })) as { title: string }).title).toBe('via rpc');
    for (const bad of ['close', 'deviceId', 'constructor', '__proto__', 'applyRemote', 'setMeta']) {
      await expect(rpc({ method: bad, args: [] })).rejects.toThrow();
    }
    await expect(rpc({ method: 'getCard' })).rejects.toThrow();
    await expect(rpc({ method: 'setSyncConfig', args: [{ url: 'file:///etc/passwd' }] })).rejects.toThrow(/http/);
  });
});
