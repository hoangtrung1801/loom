import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Backups } from '../src/core/backup.js';
import { fileNameFor } from '../src/core/json-storage.js';
import { LIBRARY_DIR, openLibrary } from '../src/core/library.js';
import { createLocalApi } from '../src/core/local-api.js';
import { buildApp } from '../src/core/rpc.js';
import { Store } from '../src/core/store.js';
import { textDoc } from '../src/core/text.js';
import { LocalServer } from '../src/main/local-server.js';

const open: Store[] = [];
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'loom-lib-'));
  dirs.push(d);
  return d;
};
const track = (s: Store): Store => (open.push(s), s);
afterEach(() => {
  open.splice(0).forEach((s) => s.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'));

describe('JSON library', () => {
  it('writes one readable file per record and survives reopening', () => {
    const dir = join(tmp(), LIBRARY_DIR);
    const first = Store.open(dir);
    const id = first.createCard({ title: 'Persisted', content: textDoc(['links to [[Target]]']) });
    const target = first.createCard({ title: 'Target' });
    first.addTag(id, 'kept');
    const device = first.deviceId;
    first.close();

    expect(readJson(join(dir, 'loom.json'))).toMatchObject({ format: 'loom-json', version: 1 });
    const file = readJson(join(dir, 'cards', fileNameFor(id)));
    expect(file.title).toBe('Persisted');
    expect(typeof file.content).toBe('object'); // the document is nested JSON, not an escaped string
    expect(file._clock.title).toBeTruthy();
    expect(statSync(join(dir, 'meta.json')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, 'ops.jsonl'), 'utf8').trim().split('\n').length).toBeGreaterThan(2);

    const second = track(Store.open(dir));
    expect(second.loaded?.records).toBeGreaterThan(0);
    expect(second.deviceId).toBe(device);
    expect(second.getCard(id)?.title).toBe('Persisted');
    expect(second.getCard(target)!.backlinks.map((b) => b.id)).toEqual([id]); // derived data is rebuilt
    expect(second.search('links').map((h) => h.id)).toEqual([id]);
    expect(second.listTags().map((t) => t.tag)).toContain('kept');
    second.updateCard(id, { title: 'Renamed' });
    expect(readJson(join(dir, 'cards', fileNameFor(id))).title).toBe('Renamed');
  });

  it('removes a record file when the record is deleted, and keeps no temp files', () => {
    const dir = join(tmp(), LIBRARY_DIR);
    const s = track(Store.open(dir));
    const board = s.createWhiteboard('Board');
    const card = s.createCard({ title: 'On board' });
    const placement = s.addCardToWhiteboard(board, card, 0, 0);
    const edgeTo = s.addCardToWhiteboard(board, s.createCard({ title: 'Other' }), 300, 0);
    const edge = s.createEdge(board, placement, edgeTo);
    const edgeFile = readdirSync(dir).flatMap((t) => (existsSync(join(dir, t, fileNameFor(edge))) ? [join(dir, t, fileNameFor(edge))] : []));
    expect(edgeFile).toHaveLength(1);
    s.deleteEdge(edge);
    const still = existsSync(edgeFile[0]!) ? readJson(edgeFile[0]!) : null;
    // Either the file is gone or it records the deletion; it never claims the edge is live.
    expect(still === null || still.deleted_at || still.deleted).toBeTruthy();
    const leftovers = readdirSync(dir, { recursive: true }).filter((n) => String(n).includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('writes nothing for a transaction that rolls back', () => {
    const dir = join(tmp(), LIBRARY_DIR);
    const s = track(Store.open(dir));
    s.createCard({ title: 'First' });
    const before = readFileSync(join(dir, 'ops.jsonl'), 'utf8');
    expect(() =>
      s.tx(() => {
        s.createCard({ title: 'Never saved' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(readFileSync(join(dir, 'ops.jsonl'), 'utf8')).toBe(before);
    s.createCard({ title: 'Saved' });
    s.close();
    open.pop();
    const again = track(Store.open(dir));
    expect(again.listCards().map((c) => c.title)).toContain('Saved');
    expect(again.listCards().map((c) => c.title)).not.toContain('Never saved');
  });

  it('skips a corrupt record and a cut-off last change-log line instead of failing to open', () => {
    const dir = join(tmp(), LIBRARY_DIR);
    const s = Store.open(dir);
    const good = s.createCard({ title: 'Good' });
    const bad = s.createCard({ title: 'Bad' });
    s.close();
    writeFileSync(join(dir, 'cards', fileNameFor(bad)), '{"id": "bad", "tit');
    writeFileSync(join(dir, 'ops.jsonl'), `${readFileSync(join(dir, 'ops.jsonl'), 'utf8')}{"id":"half`);

    const again = track(Store.open(dir));
    expect(again.getCard(good)?.title).toBe('Good');
    expect(again.loaded?.skipped).toEqual([join(dir, 'cards', fileNameFor(bad))]);
    // The unreadable file is left alone for the person (or a backup) to fix.
    expect(readFileSync(join(dir, 'cards', fileNameFor(bad)), 'utf8')).toContain('"tit');
  });

  it('refuses a library written by a newer Loom', () => {
    const dir = join(tmp(), LIBRARY_DIR);
    Store.open(dir).close();
    const marker = readJson(join(dir, 'loom.json'));
    writeFileSync(join(dir, 'loom.json'), JSON.stringify({ ...marker, schema: marker.schema + 1 }));
    expect(() => Store.open(dir)).toThrow(/newer version/);
  });

  it('keeps unpushed changes in the outbox across restarts', () => {
    const dir = join(tmp(), LIBRARY_DIR);
    const s = Store.open(dir);
    s.createCard({ title: 'Offline' });
    const pending = s.pendingCount();
    expect(pending).toBeGreaterThan(0);
    const half = s.pendingOps().slice(0, 1).map((o) => o.id);
    s.markPushed(half);
    s.close();
    const again = track(Store.open(dir));
    expect(again.pendingCount()).toBe(pending - 1);
    expect(again.pendingOps().map((o) => o.id)).not.toContain(half[0]);
  });

  it('gives ids that are not safe file names a hashed name', () => {
    expect(fileNameFor('abc-123')).toBe('abc-123.json');
    expect(fileNameFor('../etc/passwd')).toMatch(/^x-[0-9a-f]{40}\.json$/);
    expect(fileNameFor('Card:1')).toMatch(/^x-[0-9a-f]{40}\.json$/);
  });
});

describe('legacy import', () => {
  it('converts a SQLite library once and sets the database aside', () => {
    const dataDir = tmp();
    const old = new Store(join(dataDir, 'loom.db'));
    const id = old.createCard({ title: 'From SQLite', content: textDoc(['old words']) });
    old.setMeta('ai_model', 'some-model');
    const device = old.deviceId;
    old.close();

    const s = track(openLibrary(dataDir));
    expect(s.getCard(id)?.title).toBe('From SQLite');
    expect(s.search('old words').map((h) => h.id)).toEqual([id]);
    expect(s.deviceId).toBe(device);
    expect(s.getMeta('ai_model')).toBe('some-model');
    expect(existsSync(join(dataDir, 'loom.db'))).toBe(false);
    expect(existsSync(join(dataDir, 'loom.db.imported'))).toBe(true);
    expect(existsSync(join(dataDir, `${LIBRARY_DIR}.importing`))).toBe(false);
    s.close();
    open.pop();

    // A second start opens the JSON library and leaves the old file alone.
    const again = track(openLibrary(dataDir));
    expect(again.getCard(id)?.title).toBe('From SQLite');
  });
});

describe('backups', () => {
  it('writes JSON snapshots without secrets and keeps the newest few', () => {
    const dataDir = tmp();
    const s = track(openLibrary(dataDir));
    s.createCard({ title: 'Backed up' });
    s.setMeta('ai_key', 'sk-secret');
    s.setMeta('sync_token', 'tok-secret');
    const backups = new Backups(s, join(dataDir, 'backups'), 2);
    const day = 86_400_000;
    const start = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 3; i++) backups.run(start + i * day);
    const list = backups.list();
    expect(list.map((b) => b.name)).toEqual(['loom-2026-01-03T000000.json', 'loom-2026-01-02T000000.json']);

    const raw = readFileSync(join(dataDir, 'backups', list[0]!.name), 'utf8');
    expect(raw).not.toContain('sk-secret');
    expect(raw).not.toContain('tok-secret');
    const snap = JSON.parse(raw);
    expect(snap.format).toBe('loom-json-snapshot');
    expect(snap.records.cards.map((c: { title: string }) => c.title)).toContain('Backed up');
    expect(statSync(join(dataDir, 'backups', list[0]!.name)).mode & 0o777).toBe(0o600);
  });
});

describe('local API', () => {
  const api = () => {
    const store = track(new Store(':memory:'));
    return { store, call: createLocalApi(buildApp(store, { filesDir: null })) };
  };

  it('captures and reads back notes as markdown', async () => {
    const { call } = api();
    const made = await call('createNote', { title: 'From a script', markdown: '# Heading\n\n- one\n- two', tags: ['cli'] });
    expect(made.status).toBe(200);
    const id = (made.body as { id: string }).id;
    await call('appendToCard', { id, markdown: 'More text' });
    const read = await call('readCard', { id });
    expect(read.status).toBe(200);
    expect((read.body as { markdown: string }).markdown).toMatch(/one[\s\S]*two[\s\S]*More text/);
    const hits = await call('search', { query: 'script' });
    expect((hits.body as { id: string }[]).map((h) => h.id)).toContain(id);
    const tagged = await call('listCards', { tag: 'cli' });
    expect((tagged.body as { id: string }[]).map((c) => c.id)).toEqual([id]);
  });

  it('handles tasks, memos, links and the journal', async () => {
    const { call } = api();
    const task = (await call('createTask', { title: 'Ship it', priority: 'high', due: '2026-02-01' })).body as { id: string };
    expect((await call('updateTask', { id: task.id, status: 'done' })).status).toBe(200);
    expect((await call('listTasks', { includeDone: true })).body).toEqual(expect.arrayContaining([expect.objectContaining({ id: task.id, status: 'done' })]));
    expect((await call('addMemo', { text: 'quick thought' })).status).toBe(200);
    expect((await call('saveLink', { url: 'https://example.com', tags: ['ref'] })).status).toBe(200);
    expect(((await call('listLinks', { tag: 'ref' })).body as unknown[]).length).toBe(1);
    await call('appendToJournal', { date: '2026-01-05', markdown: 'Dear diary' });
    expect(((await call('readJournal', { date: '2026-01-05' })).body as { markdown: string }).markdown).toContain('Dear diary');
  });

  it('rejects unknown operations and bad input with clear errors', async () => {
    const { call } = api();
    expect(await call('dropEverything', {})).toMatchObject({ status: 404, body: { code: 'unknown_operation' } });
    expect(await call('toString', {})).toMatchObject({ status: 404 });
    expect(await call('createTask', { title: '' })).toMatchObject({ status: 400, body: { code: 'invalid_input' } });
    expect(await call('readCard', {})).toMatchObject({ status: 400 });
    expect(await call('readCard', { id: 'missing' })).toMatchObject({ status: 404 });
    const ops = (await call('operations', {})).body as { name: string; input: unknown }[];
    expect(ops.map((o) => o.name)).toContain('createNote');
    expect(ops.every((o) => typeof o.input === 'object')).toBe(true);
  });

  it('runs writes one at a time', async () => {
    const { call, store } = api();
    await Promise.all(Array.from({ length: 10 }, (_, i) => call('appendToJournal', { date: '2026-03-01', markdown: `line ${i}` })));
    const md = ((await call('readJournal', { date: '2026-03-01' })).body as { markdown: string }).markdown;
    for (let i = 0; i < 10; i++) expect(md).toContain(`line ${i}`);
    expect(store.listJournals().length).toBe(1);
  });
});

describe('local server', () => {
  const servers: LocalServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.stop()));
  });

  async function start() {
    const infoFile = join(tmp(), 'local-server.json');
    const calls: [string, unknown][] = [];
    const server = new LocalServer(infoFile, async (operation, input) => {
      calls.push([operation, input]);
      return { status: 200, body: { operation, input } };
    });
    servers.push(server);
    const info = await server.start(0);
    const url = (path: string) => `http://127.0.0.1:${info.port}${path}`;
    const auth = { authorization: `Bearer ${info.token}` };
    return { server, info, infoFile, calls, url, auth };
  }

  it('writes a private connection file and removes it on stop', async () => {
    const { server, info, infoFile } = await start();
    expect(readJson(infoFile)).toMatchObject({ port: info.port, token: info.token });
    expect(statSync(infoFile).mode & 0o777).toBe(0o600);
    expect(info.token).toMatch(/^[0-9a-f]{64}$/);
    await server.stop();
    expect(existsSync(infoFile)).toBe(false);
  });

  it('serves health and operations to a client with the token', async () => {
    const { url, auth, calls } = await start();
    const health = await fetch(url('/health'), { headers: auth });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, app: 'loom' });
    const res = await fetch(url('/operations/search'), { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ query: 'x' }) });
    expect(res.status).toBe(200);
    expect(calls).toEqual([['search', { query: 'x' }]]);
  });

  it('turns away clients without the token, browsers, and rebound host names', async () => {
    const { url, auth, info, calls } = await start();
    expect((await fetch(url('/health'))).status).toBe(401);
    expect((await fetch(url('/health'), { headers: { authorization: `Bearer ${'0'.repeat(64)}` } })).status).toBe(401);
    expect((await fetch(url('/health'), { headers: { ...auth, origin: 'https://evil.example' } })).status).toBe(403);
    const rebound = await rawRequest(info.port, `GET /health HTTP/1.1\r\nHost: evil.example:${info.port}\r\nAuthorization: ${auth.authorization}\r\nConnection: close\r\n\r\n`);
    expect(rebound).toMatch(/^HTTP\/1\.1 403/);
    expect(calls).toEqual([]);
  });

  it('rejects bad paths, methods, bodies and oversized requests', async () => {
    const { url, auth, calls } = await start();
    expect((await fetch(url('/nope'), { headers: auth })).status).toBe(404);
    expect((await fetch(url('/operations/search'), { headers: auth })).status).toBe(405);
    expect((await fetch(url('/operations/search'), { method: 'POST', headers: { ...auth, 'content-type': 'text/plain' }, body: 'x' })).status).toBe(415);
    expect((await fetch(url('/operations/search'), { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{nope' })).status).toBe(400);
    const big = await fetch(url('/operations/addMemo'), { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(1024 * 1024 + 10) }) });
    expect(big.status).toBe(413);
    expect(calls).toEqual([]);
  });
});

function rawRequest(port: number, text: string): Promise<string> {
  return import('node:net').then(
    ({ connect }) =>
      new Promise((resolve, reject) => {
        let out = '';
        const socket = connect(port, '127.0.0.1', () => socket.write(text));
        socket.on('data', (d) => (out += d.toString()));
        socket.on('end', () => resolve(out));
        socket.on('error', reject);
      }),
  );
}
