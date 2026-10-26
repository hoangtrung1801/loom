import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/core/schema.js';
import { Store } from '../src/core/store.js';
import { buildApp } from '../src/core/rpc.js';
import { normalizeUrl, parseWebUrl } from '../src/core/url.js';
import { splitFirstLine, Work } from '../src/core/work.js';
import { markdownToContent } from '../src/core/markdown.js';

const stores: Store[] = [];
const mem = () => {
  const s = new Store(':memory:');
  stores.push(s);
  return { store: s, work: new Work(s) };
};
afterEach(() => stores.splice(0).forEach((s) => s.close()));

describe('tasks', () => {
  it('creates a task with acceptance criteria, labels and a parent, and reports progress', () => {
    const { store, work } = mem();
    const epic = work.createTask({ title: 'Ship v1', priority: 'high' });
    const id = work.createTask({
      title: 'Add login', description: 'JWT based.', acceptance: ['User can register', 'User can log in'], plan: '1. Endpoints', priority: 'high',
      assignee: ' ana ', due: '2030-01-31', parentId: epic, labels: ['auth', 'Backend'],
    });
    const task = work.getTask(id)!;
    expect(task).toMatchObject({ title: 'Add login', status: 'todo', priority: 'high', assignee: 'ana', due: '2030-01-31', parentId: epic, labels: ['auth', 'backend'] });
    expect(task.progress).toEqual({ done: 0, total: 2 });
    expect(task.parent).toEqual({ id: epic, title: 'Ship v1' });
    expect(work.getTask(epic)!.children.map((c) => c.id)).toEqual([id]);
    expect(work.getTask(epic)!.subtasks).toEqual({ done: 0, total: 1 });

    // checking an acceptance criterion moves progress; the body is an ordinary card
    const [first] = store.listTasks({ cardId: id }) as { blockId: string }[];
    store.setTaskChecked(id, first!.blockId, true);
    expect(work.getTask(id)!.progress).toEqual({ done: 1, total: 2 });
    expect(store.search('JWT').map((h) => h.id)).toContain(id);
  });

  it('tracks completion and keeps the status workflow honest', () => {
    const { work } = mem();
    const id = work.createTask({ title: 'Write docs' });
    expect(work.getTask(id)!.completedAt).toBe(0);
    work.updateTask(id, { status: 'in-progress' });
    work.updateTask(id, { status: 'done' });
    const done = work.getTask(id)!.completedAt;
    expect(done).toBeGreaterThan(0);
    work.updateTask(id, { status: 'done', priority: 'low' });
    expect(work.getTask(id)!.completedAt).toBe(done); // staying done keeps the original time
    work.updateTask(id, { status: 'blocked' });
    expect(work.getTask(id)!.completedAt).toBe(0);
    expect(() => work.updateTask(id, { status: 'finished' })).toThrow(/Unknown status/);
    expect(() => work.updateTask(id, { priority: 'urgent' })).toThrow(/Unknown priority/);
    expect(() => work.updateTask(id, { due: '31/01/2030' })).toThrow(/Due dates/);
    expect(() => work.updateTask(id, { due: '2030-02-31x' })).toThrow(/Due dates/);
    expect(() => work.createTask({ title: '   ' })).toThrow(/title/);
    expect(work.createTask({ title: 'Already done', status: 'done' })).toBeTruthy();
  });

  it('rejects parents that are missing, not tasks, or would form a cycle', () => {
    const { store, work } = mem();
    const a = work.createTask({ title: 'A' });
    const b = work.createTask({ title: 'B', parentId: a });
    const c = work.createTask({ title: 'C', parentId: b });
    expect(() => work.updateTask(a, { parentId: c })).toThrow(/subtask of itself/);
    expect(() => work.updateTask(a, { parentId: a })).toThrow(/subtask of itself/);
    expect(() => work.updateTask(c, { parentId: 'missing' })).toThrow(/no longer exists/);
    const note = store.createCard({ title: 'Just a note' });
    expect(() => work.updateTask(c, { parentId: note })).toThrow(/not a task/);
    expect(() => work.updateTask(note, { status: 'done' })).toThrow(/not a task/);
    work.updateTask(c, { parentId: '' });
    expect(work.getTask(c)!.parentId).toBe('');
  });

  it('filters by status, label, assignee, parent, text and overdue; blank statuses count as to do', () => {
    const { store, work } = mem();
    const legacy = store.createCard({ title: 'Imported task', kind: 'task' }); // no status stored
    const a = work.createTask({ title: 'Fix login bug', labels: ['bug'], assignee: 'Ana', due: '2001-01-01', priority: 'high' });
    const b = work.createTask({ title: 'Plan roadmap', status: 'in-progress', assignee: 'Bo' });
    const c = work.createTask({ title: 'Old thing', status: 'done', due: '2001-01-01', parentId: b });
    const ids = (f = {}) => work.listTasks(f).map((t) => t.id).sort();
    expect(ids({ status: 'todo' })).toEqual([legacy, a].sort());
    expect(ids({ status: 'in-progress' })).toEqual([b]);
    expect(ids({ status: 'done' })).toEqual([c]);
    expect(ids({ includeDone: false })).toEqual([legacy, a, b].sort());
    expect(ids({ label: '#BUG' })).toEqual([a]);
    expect(ids({ assignee: 'ana' })).toEqual([a]);
    expect(ids({ parentId: b })).toEqual([c]);
    expect(ids({ parentId: 'none' })).toEqual([legacy, a, b].sort());
    expect(ids({ query: 'ROAD' })).toEqual([b]);
    expect(ids({ query: '100%' })).toEqual([]);
    expect(ids({ overdue: true })).toEqual([a]); // the done task is not overdue
    expect(ids({ priority: 'high' })).toEqual([a]);
    expect(work.listTasks().find((t) => t.id === legacy)).toMatchObject({ status: 'todo', priority: 'medium' });
    expect(() => work.listTasks({ status: 'nope' })).toThrow();
  });

  it('trashing a task keeps its subtasks and removes it from the board', () => {
    const { store, work } = mem();
    const a = work.createTask({ title: 'Parent' });
    const b = work.createTask({ title: 'Child', parentId: a });
    store.trashCard(a);
    expect(work.listTasks().map((t) => t.id)).toEqual([b]);
    expect(work.getTask(b)!.parent).toBeNull();
  });
});

describe('saved links', () => {
  it('normalizes addresses so one page is never saved twice', () => {
    expect(normalizeUrl('Example.com/post/?utm_source=x&b=2&a=1#intro')).toBe('https://example.com/post?a=1&b=2');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    expect(() => parseWebUrl('javascript:alert(1)')).toThrow(/http/);
    expect(() => parseWebUrl('ftp://example.com')).toThrow(/http/);
    expect(() => parseWebUrl('https://user:pw@example.com')).toThrow(/credentials/);
    expect(() => parseWebUrl('nonsense')).toThrow(/web address/);
    expect(parseWebUrl('localhost:3000/app').port).toBe('3000');
    expect(parseWebUrl('example.com:8080').port).toBe('8080');
    expect(() => parseWebUrl('')).toThrow();
  });

  it('saves, dedupes, merges tags and notes, and finds links by host, tag and description', () => {
    const { store, work } = mem();
    const first = work.saveLink({ url: 'https://www.example.com/post?utm_campaign=a', title: 'A post', description: 'About zebras', note: 'read later', tags: ['Reading'] });
    expect(first.existed).toBe(false);
    const again = work.saveLink({ url: 'https://www.example.com/post/#top', note: 'second thought', tags: ['animals'] });
    expect(again).toEqual({ id: first.id, existed: true });
    const view = work.listLinks()[0]!;
    expect(view).toMatchObject({ id: first.id, title: 'A post', host: 'example.com', description: 'About zebras', tags: ['animals', 'reading'] });
    expect(view.note).toBe('read later second thought');
    expect(work.listLinks()).toHaveLength(1);

    const other = work.saveLink({ url: 'https://news.test/story', title: 'Zebra news', tags: ['news'] }).id;
    expect(work.listLinks({ query: 'zebra' }).map((l) => l.id)).toEqual([other, first.id]); // title match outranks description match
    expect(work.listLinks({ query: 'zebra news' }).map((l) => l.id)).toEqual([other]); // every word must match
    expect(work.listLinks({ query: 'example.com' }).map((l) => l.id)).toEqual([first.id]);
    expect(work.listLinks({ tag: '#Animals' }).map((l) => l.id)).toEqual([first.id]);
    expect(store.search('zebras').map((h) => h.id)).toContain(first.id); // description is in the full-text index
    expect(store.search('news.test').map((h) => h.id)).toContain(other); // so is the address

    work.updateLink(first.id, { title: 'Renamed', description: 'Different', url: 'https://example.org/new?utm_x=1' });
    expect(work.listLinks({ query: 'different' })[0]).toMatchObject({ title: 'Renamed', host: 'example.org' });
    expect(work.saveLink({ url: 'https://example.org/new' }).existed).toBe(true); // the key moved with the url
    expect(() => work.updateLink(first.id, { url: 'file:///etc/passwd' })).toThrow(/http/);
    expect(() => work.updateLink(store.createCard({ title: 'n' }), { title: 'x' })).toThrow(/not a saved link/);
  });
});

describe('memos', () => {
  it('captures text and converts into a note or a task using the first line as the title', () => {
    const { store, work } = mem();
    expect(() => work.addMemo('   ')).toThrow(/Write something/);
    const id = work.addMemo('Call the bank about the card\n\n- [ ] ask about fees\n- [ ] book a time');
    expect(store.getCard(id)).toMatchObject({ kind: 'memo', title: '' });
    expect(store.search('bank').map((h) => h.id)).toContain(id);

    work.convertCard(id, 'task');
    expect(store.getCard(id)).toMatchObject({ kind: 'task', title: 'Call the bank about the card', status: 'todo', priority: 'medium' });
    expect(work.getTask(id)!.progress).toEqual({ done: 0, total: 2 });
    expect(store.getCard(id)!.content).not.toContain('Call the bank'); // the title moved out of the body
    work.convertCard(id, 'note');
    expect(store.getCard(id)!.kind).toBe('note');
    expect(() => work.convertCard(id, 'pdf')).toThrow(/converted/);
    const link = work.saveLink({ url: 'https://example.com/x' }).id;
    expect(() => work.convertCard(link, 'note')).toThrow(/cannot be converted/);
  });

  it('keeps a memo whose first block is not text as it is', () => {
    expect(splitFirstLine(markdownToContent('- a\n- b')).title).toBe('');
    expect(splitFirstLine('not json').title).toBe('');
    expect(splitFirstLine(markdownToContent('# Heading\n\nbody')).title).toBe('Heading');
  });
});

describe('storage and sync', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('upgrades a database created before tasks, links and memos existed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loom-mig-'));
    dirs.push(dir);
    const path = join(dir, 'old.db');
    const old = new DatabaseSync(path);
    for (const stmts of MIGRATIONS.slice(0, 2)) for (const s of stmts) old.exec(s);
    old.exec('PRAGMA user_version = 2');
    old.prepare("INSERT INTO cards(id, title, content, kind, created_at, updated_at) VALUES ('c1', 'Existing card', '', 'note', 1, 1)").run();
    old.close();
    const store = new Store(path);
    stores.push(store);
    expect(store.getCard('c1')).toMatchObject({ title: 'Existing card', status: '', url: '', completedAt: 0 });
    const work = new Work(store);
    const t = work.createTask({ title: 'After upgrade' });
    expect(work.getTask(t)!.status).toBe('todo');
  });

  it('merges concurrent edits to different fields of the same task', () => {
    const a = mem();
    const b = mem();
    const id = a.work.createTask({ title: 'Shared', priority: 'low' });
    b.store.applyRemote(a.store.pendingOps(100));
    a.work.updateTask(id, { status: 'in-progress' });
    b.work.updateTask(id, { assignee: 'Bo', priority: 'high' });
    const fromA = a.store.pendingOps(100);
    const fromB = b.store.pendingOps(100);
    a.store.applyRemote(fromB);
    b.store.applyRemote(fromA);
    for (const side of [a, b]) {
      expect(side.work.getTask(id)).toMatchObject({ status: 'in-progress', assignee: 'Bo', priority: 'high' });
    }
  });

  it('exposes the work methods through the whitelisted RPC and exports the new kinds', async () => {
    const store = new Store(':memory:');
    stores.push(store);
    const app = buildApp(store, { filesDir: null });
    const id = app.methods.createWorkTask({ title: 'Via rpc', labels: ['x'] });
    app.methods.updateWorkTask(id, { status: 'in-review' });
    expect(app.methods.listWorkTasks({ status: 'in-review' }).map((t) => t.title)).toEqual(['Via rpc']);
    app.methods.addMemo('quick thought');
    expect(app.methods.listLinks()).toEqual([]);
    const json = JSON.parse((await app.methods.exportAll('json')).text);
    expect(json.cards.map((c: { kind: string }) => c.kind).sort()).toEqual(['memo', 'task']);
    expect(json.cards.find((c: { kind: string }) => c.kind === 'task')).toMatchObject({ status: 'in-review', priority: 'medium' });
    const md = (await app.methods.exportAll('markdown')).text;
    expect(md).toContain('# Via rpc');
    expect(md).toContain('Status: In review · Priority: medium');
    expect(md).toContain('# quick thought');
  });
});
