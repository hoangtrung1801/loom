import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { Chats } from '../src/core/chats.js';
import { Files } from '../src/core/files.js';
import { MIGRATIONS } from '../src/core/schema.js';
import { Store } from '../src/core/store.js';
import { TagDb } from '../src/core/tagdb.js';
import { textDoc } from '../src/core/text.js';
import { markdownToContent } from '../src/core/markdown.js';

const open: Store[] = [];
const dirs: string[] = [];
const mem = (): Store => {
  const s = new Store(':memory:');
  open.push(s);
  return s;
};
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'loom-model-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  open.splice(0).forEach((s) => s.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const mentionDoc = (cardId: string, label: string): string =>
  JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'about ' }, { type: 'mention', attrs: { cardId, label } }] }] });

describe('cards v2', () => {
  it('assigns block ids on write and keeps them stable', () => {
    const s = mem();
    const id = s.createCard({ title: 'x', content: textDoc(['one', 'two']) });
    const first = JSON.parse(s.getCard(id)!.content) as { content: { attrs: { id: string } }[] };
    expect(first.content.every((n) => typeof n.attrs.id === 'string')).toBe(true);
    s.updateCard(id, { content: s.getCard(id)!.content });
    expect(s.getCard(id)!.content).toBe(JSON.stringify(first));
  });

  it('builds block-level backlinks from @mentions, surviving renames', () => {
    const s = mem();
    const target = s.createCard({ title: 'Target' });
    const src = s.createCard({ title: 'Source', content: mentionDoc(target, 'Target') });
    s.updateCard(target, { title: 'Renamed' });
    const back = s.getCard(target)!.backlinks;
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: src, title: 'Source', text: 'about Target' });
    expect(back[0]!.blockId).toMatch(/^[0-9a-f]{12}$/);
  });

  it('separates kinds, inbox and sorting', () => {
    const s = mem();
    const a = s.createCard({ title: 'b-note' });
    const b = s.createCard({ title: 'a-inbox', inbox: true });
    s.createCard({ title: 'img', kind: 'image' });
    expect(s.listCards({ kinds: ['image'] }).map((c) => c.title)).toEqual(['img']);
    expect(s.listCards({ inbox: true }).map((c) => c.id)).toEqual([b]);
    s.setInbox(b, false);
    expect(s.listCards({ inbox: true })).toEqual([]);
    expect(s.listCards({ sort: 'title', kinds: ['note'] }).map((c) => c.id)).toEqual([b, a]);
    expect(() => s.createCard({ kind: 'bogus' as never })).toThrow(/kind/);
  });

  it('trashes and restores cards', () => {
    const s = mem();
    const id = s.createCard({ title: 'gone' });
    s.trashCard(id);
    expect(s.listTrash().cards.map((c) => c.id)).toEqual([id]);
    s.restoreCard(id);
    expect(s.getCard(id)?.title).toBe('gone');
    expect(() => s.restoreCard(id)).toThrow(/trash/);
  });

  it('keeps every edit in history and restores an old version', () => {
    const s = mem();
    const id = s.createCard({ title: 'v', content: textDoc(['first draft']) });
    s.updateCard(id, { content: textDoc(['second draft']) });
    const history = s.cardHistory(id);
    expect(history.map((h) => h.preview)).toEqual(['second draft', 'first draft']);
    s.restoreCardVersion(id, history[1]!.opId);
    expect(s.getCard(id)!.content).toContain('first draft');
    expect(s.search('first')).toHaveLength(1);
  });
});

describe('journals and tasks', () => {
  it('creates one journal per day with a deterministic id', () => {
    const s = mem();
    const id = s.ensureJournal('2025-03-01');
    expect(s.ensureJournal('2025-03-01')).toBe(id);
    expect(id).toBe('journal-2025-03-01');
    expect(s.getCard(id)).toMatchObject({ kind: 'journal', journalDate: '2025-03-01', title: '2025-03-01' });
    expect(s.journalDays('2025-03')).toEqual([]); // empty journals don't count
    s.updateCard(id, { content: textDoc(['wrote something']) });
    expect(s.journalDays('2025-03')).toEqual(['2025-03-01']);
    expect(s.listJournals().map((j) => j.id)).toEqual([id]);
    expect(() => s.ensureJournal('2025-13-45')).toThrow();
    expect(() => s.ensureJournal('../x')).toThrow();
  });

  it('indexes to-dos, filters them, and checks them off', () => {
    const s = mem();
    const day = s.ensureJournal('2025-03-02');
    s.updateCard(day, { content: markdownToContent('- [ ] buy milk\n- [x] done already') });
    const other = s.createCard({ title: 'Project', content: markdownToContent('- [ ] write report') });
    expect(s.listTasks({ done: false }).map((t) => t.text).sort()).toEqual(['buy milk', 'write report']);
    expect(s.listTasks({ due: '2025-03-02' }).map((t) => t.text)).toEqual(['buy milk', 'done already']);
    const task = s.listTasks({ cardId: other })[0]!;
    s.setTaskChecked(other, task.blockId, true);
    expect(s.listTasks({ done: false }).map((t) => t.text)).toEqual(['buy milk']);
    expect(() => s.setTaskChecked(other, 'nope', true)).toThrow();
  });
});

describe('whiteboard objects', () => {
  it('places text, sections and sub-whiteboard shortcuts', () => {
    const s = mem();
    const board = s.createWhiteboard('Main');
    const text = s.addObject(board, { kind: 'text', x: 10, y: 10, text: 'quick thought' });
    const section = s.addObject(board, { kind: 'section', x: 0, y: 0, text: 'Group', color: 'blue' });
    const shortcut = s.addObject(board, { kind: 'board', x: 600, y: 0, text: 'Sub topic' });
    const data = s.getWhiteboard(board)!;
    const byId = new Map(data.placements.map((p) => [p.id, p]));
    expect(byId.get(text)).toMatchObject({ kind: 'text', text: 'quick thought' });
    expect(byId.get(section)).toMatchObject({ kind: 'section', title: 'Group', color: 'blue' });
    expect(byId.get(section)!.z).toBeLessThan(byId.get(text)!.z); // sections sit behind
    const sub = byId.get(shortcut)!;
    expect(sub.title).toBe('Sub topic');
    expect(s.listWhiteboards().find((w) => w.id === sub.refId)?.parentId).toBe(board);
    expect(() => s.addObject(board, { kind: 'text', x: 0, y: 0, color: 'chartreuse' })).toThrow(/color/);
    expect(s.searchAll({ query: 'quick', whiteboardText: true }).map((h) => [h.type, h.boardId])).toEqual([['text', board]]);
  });

  it('removes a mind-map branch with its root and releases section members', () => {
    const s = mem();
    const board = s.createWhiteboard();
    const root = s.addObject(board, { kind: 'text', x: 0, y: 0, text: 'root' });
    const child = s.addObject(board, { kind: 'text', x: 0, y: 0, text: 'child', parentId: root });
    const grandchild = s.addObject(board, { kind: 'text', x: 0, y: 0, text: 'grand', parentId: child });
    const section = s.addObject(board, { kind: 'section', x: 0, y: 0 });
    const member = s.addObject(board, { kind: 'text', x: 0, y: 0, text: 'member' });
    s.updatePlacements([{ id: member, sectionId: section }]);
    s.removePlacements([root, section]);
    const left = s.getWhiteboard(board)!.placements;
    expect(left.map((p) => p.id)).toEqual([member]);
    expect(left[0]!.sectionId).toBe('');
    s.restorePlacements([root, child, grandchild]);
    expect(s.getWhiteboard(board)!.placements).toHaveLength(4);
  });

  it('styles edges and restores them with their objects', () => {
    const s = mem();
    const board = s.createWhiteboard();
    const a = s.addObject(board, { kind: 'text', x: 0, y: 0, text: 'a' });
    const b = s.addObject(board, { kind: 'text', x: 0, y: 0, text: 'b' });
    const e = s.createEdge(board, a, b, { color: 'red', style: 'dashed', arrow: 'both' });
    expect(s.getWhiteboard(board)!.edges[0]).toMatchObject({ id: e, color: 'red', style: 'dashed', arrow: 'both' });
    expect(() => s.updateEdge(e, { arrow: 'sideways' })).toThrow();
    s.removePlacements([a]);
    expect(s.getWhiteboard(board)!.edges).toEqual([]);
    s.restorePlacements([a]);
    expect(s.getWhiteboard(board)!.edges).toHaveLength(1);
  });

  it('moves objects between whiteboards with the connections among them', () => {
    const s = mem();
    const from = s.createWhiteboard('from');
    const to = s.createWhiteboard('to');
    const { placementId: a } = s.createCardOnWhiteboard(from, 0, 0);
    const { placementId: b } = s.createCardOnWhiteboard(from, 0, 0);
    const { placementId: c } = s.createCardOnWhiteboard(from, 0, 0);
    s.createEdge(from, a, b);
    s.createEdge(from, b, c);
    s.moveToWhiteboard([a, b], to, 100, 0);
    expect(s.getWhiteboard(from)!.placements.map((p) => p.id)).toEqual([c]);
    const moved = s.getWhiteboard(to)!;
    expect(moved.placements.map((p) => p.id).sort()).toEqual([a, b].sort());
    expect(moved.placements.every((p) => p.x === 100)).toBe(true);
    expect(moved.edges).toHaveLength(1);
    expect(s.getWhiteboard(from)!.edges).toHaveLength(0);
  });

  it('keeps the sub-whiteboard tree acyclic and promotes children when a board is trashed', () => {
    const s = mem();
    const root = s.createWhiteboard('root');
    const child = s.createWhiteboard('child', root);
    const grandchild = s.createWhiteboard('grandchild', child);
    expect(() => s.moveWhiteboard(root, grandchild)).toThrow(/itself/);
    s.trashWhiteboard(child);
    expect(s.listWhiteboards().find((w) => w.id === grandchild)?.parentId).toBe(root);
    s.restoreWhiteboard(child);
    expect(s.listWhiteboards().find((w) => w.id === child)?.parentId).toBe('');
  });
});

describe('search', () => {
  it('searches everything with filters and sorting', () => {
    const s = mem();
    s.createCard({ title: 'Quantum notes', content: textDoc(['entanglement basics']) });
    s.createCard({ title: 'Quantum image', kind: 'image' });
    s.createWhiteboard('Quantum board');
    const chats = new Chats(s);
    const chat = chats.createChat({ title: 'Physics chat' });
    chats.addMessage(chat, 'user', 'tell me about quantum tunnelling');
    const all = s.searchAll({ query: 'quantum', chats: true });
    expect(new Set(all.map((h) => h.type))).toEqual(new Set(['card', 'whiteboard', 'chat']));
    expect(s.searchAll({ query: 'quantum', kinds: ['image'], whiteboards: false }).map((h) => h.title)).toEqual(['Quantum image']);
    expect(s.searchAll({ query: 'tunnel', chats: false })).toEqual([]);
  });

  it('suggests related cards from shared vocabulary', () => {
    const s = mem();
    const a = s.createCard({ title: 'Photosynthesis', content: textDoc(['chlorophyll converts sunlight into chemical energy']) });
    const b = s.createCard({ title: 'Plant energy', content: textDoc(['chlorophyll and sunlight drive plant growth']) });
    s.createCard({ title: 'Taxes', content: textDoc(['quarterly filing deadlines']) });
    expect(s.relatedCards([a]).map((h) => h.id)).toEqual([b]);
  });
});

describe('tag databases', () => {
  it('defines typed properties, validates values and builds the table', () => {
    const s = mem();
    const db = new TagDb(s);
    const card = s.createCard({ title: 'Dune' });
    s.addTag(card, 'book');
    db.setTagDef('book', { color: 'orange', collection: 'Reading' });
    const rating = db.addTagProp('book', { name: 'Rating', type: 'number' });
    const status = db.addTagProp('book', { name: 'Status', type: 'select', options: ['to read', 'done'] });
    const read = db.addTagProp('book', { name: 'Finished', type: 'date' });
    db.setCardProp(card, rating, '5');
    db.setCardProp(card, status, 'done');
    expect(() => db.setCardProp(card, status, 'maybe')).toThrow(/options/);
    expect(() => db.setCardProp(card, rating, 'lots')).toThrow(/number/);
    expect(() => db.setCardProp(card, read, '31/01/2025')).toThrow(/Dates/);
    const table = db.getTagTable('book');
    expect(table).toMatchObject({ tag: 'book', color: 'orange', collection: 'Reading' });
    expect(table.props.map((p) => p.name)).toEqual(['Rating', 'Status', 'Finished']);
    expect(table.rows[0]!.values).toEqual({ [rating]: '5', [status]: 'done' });
    expect(db.getCardProps(card)[0]!.props.map((p) => p.value)).toEqual(['5', 'done', '']);
    expect(s.listTags()[0]).toMatchObject({ tag: 'book', collection: 'Reading', count: 1 });
  });

  it('renames and deletes tags without touching cards', () => {
    const s = mem();
    const db = new TagDb(s);
    const card = s.createCard({ title: 'x' });
    s.addTag(card, 'old');
    const prop = db.addTagProp('old', { name: 'P' });
    db.setCardProp(card, prop, 'v');
    db.renameTag('old', 'New Name');
    expect(s.getCard(card)!.tags).toEqual(['new-name']);
    expect(db.getTagTable('new-name').rows[0]!.values[prop]).toBe('v');
    db.deleteTag('new-name');
    expect(s.getCard(card)!.tags).toEqual([]);
    expect(s.getCard(card)).not.toBeNull();
  });
});

describe('chats and actions', () => {
  it('stores chats, messages, context and custom actions', () => {
    const s = mem();
    const chats = new Chats(s);
    const id = chats.createChat({ title: 'T', context: [{ type: 'card', id: 'c1' }, { type: 'card', id: 'c1' }, { type: 'bogus' as never, id: 'x' }] });
    chats.addMessage(id, 'user', 'hi');
    chats.addMessage(id, 'assistant', 'hello [1]', [{ n: 1, cardId: 'c1', title: 'C', blockId: 'b', startLine: 1, endLine: 2, quote: 'q' }]);
    const chat = chats.getChat(id)!;
    expect(chat.context).toEqual([{ type: 'card', id: 'c1' }]);
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(chat.messages[1]!.sources[0]!.blockId).toBe('b');
    expect(chats.listChats()[0]).toMatchObject({ id, messageCount: 2, preview: 'hello [1]' });
    const action = chats.saveAiAction({ name: 'Simplify', prompt: 'Rewrite simply' });
    expect(chats.listAiActions()).toEqual([{ id: action, name: 'Simplify', prompt: 'Rewrite simply', kind: 'action' }]);
    chats.deleteChat(id);
    expect(chats.listChats()).toEqual([]);
  });
});

describe('files', () => {
  it('stores attachments by content hash and verifies synced bytes', () => {
    const s = mem();
    const dir = tmp();
    const files = new Files(s, dir);
    const bytes = new TextEncoder().encode('hello file');
    const id = files.put(bytes, { name: 'a.txt', mime: 'text/plain' });
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(files.put(bytes, { name: 'b.txt', mime: 'text/plain' })).toBe(id);
    expect(files.info(id)).toMatchObject({ name: 'a.txt', mime: 'text/plain', size: 10, local: true });
    expect(files.read(id).toString()).toBe('hello file');
    expect(files.put(new Uint8Array([1]), { name: 'x.html', mime: 'text/html' })).toBeTruthy();
    expect(files.info(files.put(new Uint8Array([2]), { name: 'x.html', mime: 'text/html' }))!.mime).toBe('application/octet-stream');
    expect(() => files.putVerified('0'.repeat(64), bytes)).toThrow(/match/);
    expect(() => files.read('../../etc/passwd')).toThrow(/Invalid/);
  });
});

describe('migration from v1', () => {
  it('upgrades an existing database and rebuilds the derived indexes', () => {
    const dir = tmp();
    const path = join(dir, 'old.db');
    const raw = new DatabaseSync(path);
    for (const stmt of MIGRATIONS[0]!) raw.exec(stmt);
    raw.exec('PRAGMA user_version = 1');
    raw.prepare('INSERT INTO cards(id, title, content, created_at, updated_at) VALUES (?, ?, ?, 1, 1)').run('old', 'Old card', textDoc(['links to [[Other]]']));
    raw.prepare('INSERT INTO cards(id, title, content, created_at, updated_at) VALUES (?, ?, ?, 1, 1)').run('other', 'Other', textDoc(['target']));
    raw.close();

    const s = new Store(path);
    open.push(s);
    expect(s.getCard('old')).toMatchObject({ kind: 'note', inbox: false });
    expect(s.getCard('other')!.backlinks.map((b) => b.id)).toEqual(['old']);
    expect(s.search('links').map((h) => h.id)).toEqual(['old']);
  });
});
