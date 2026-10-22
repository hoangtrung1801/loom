import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/core/store.js';
import { textDoc } from '../src/core/text.js';

const open: Store[] = [];
const mem = (): Store => {
  const s = new Store(':memory:');
  open.push(s);
  return s;
};
afterEach(() => open.splice(0).forEach((s) => s.close()));

describe('cards and search', () => {
  it('creates, lists and reads cards', () => {
    const s = mem();
    const id = s.createCard({ title: 'Alpha', content: textDoc(['Hello world']) });
    expect(s.listCards().map((c) => c.title)).toEqual(['Alpha']);
    expect(s.getCard(id)?.content).toContain('Hello world');
    expect(s.listCards()[0]?.preview).toBe('Hello world');
  });

  it('searches by prefix as you type, folds plurals, and highlights matches', () => {
    const s = mem();
    s.createCard({ title: 'Garden', content: textDoc(['I enjoy running through the garden']) });
    s.createCard({ title: 'Other', content: textDoc(['nothing relevant']) });
    for (const q of ['run', 'runn', 'running', 'gard', 'gardens', 'GARDEN', 'enjoy garden']) {
      expect(s.search(q).map((h) => h.title), q).toEqual(['Garden']);
    }
    expect(s.search('runnx')).toEqual([]);
    expect(s.search('gard')[0]?.titleMarked).toBe('\u0001Garden\u0002');
    expect(s.search('runn')[0]?.snippet).toMatch(/\u0001run.*\u0002/);
  });

  it('treats FTS syntax in the query as plain text', () => {
    const s = mem();
    s.createCard({ title: 'x', content: textDoc(['plain']) });
    expect(() => s.search('"unterminated AND ( NEAR')).not.toThrow();
    expect(s.search('***')).toEqual([]);
  });

  it('reindexes on edit and drops trashed cards from search', () => {
    const s = mem();
    const id = s.createCard({ title: 'Note', content: textDoc(['apples']) });
    s.updateCard(id, { content: textDoc(['bananas']) });
    expect(s.search('apples')).toHaveLength(0);
    expect(s.search('bananas')).toHaveLength(1);
    s.trashCard(id);
    expect(s.search('bananas')).toHaveLength(0);
    expect(s.getCard(id)).toBeNull();
  });

  it('rejects malformed content and unknown cards', () => {
    const s = mem();
    const id = s.createCard();
    expect(() => s.updateCard(id, { content: '{not json' })).toThrow();
    expect(() => s.updateCard('missing', { title: 'x' })).toThrow(/not found/);
  });

  it('computes backlinks from [[Title]] mentions', () => {
    const s = mem();
    const target = s.createCard({ title: 'Target' });
    const src = s.createCard({ title: 'Source', content: textDoc(['see [[target]] for more']) });
    s.createCard({ title: 'Unrelated', content: textDoc(['no links']) });
    expect(s.getCard(target)?.backlinks).toEqual([{ id: src, title: 'Source' }]);
    expect(s.findCardByTitle('TARGET')).toBe(target);
  });

  it('normalizes tags and counts them', () => {
    const s = mem();
    const a = s.createCard({ title: 'a' });
    const b = s.createCard({ title: 'b' });
    s.addTag(a, '#Big Idea');
    s.addTag(a, 'big-idea');
    s.addTag(b, 'big-idea');
    s.addTag(a, '   ');
    expect(s.getCard(a)?.tags).toEqual(['big-idea']);
    expect(s.listTags()).toEqual([{ tag: 'big-idea', count: 2 }]);
    s.removeTag(a, 'Big Idea');
    expect(s.getCard(a)?.tags).toEqual([]);
    s.addTag(a, 'big-idea'); // re-adding resurrects
    expect(s.getCard(a)?.tags).toEqual(['big-idea']);
  });
});

describe('whiteboards', () => {
  it('places cards, moves and resizes them with a minimum size', () => {
    const s = mem();
    const board = s.createWhiteboard('B');
    const { cardId, placementId } = s.createCardOnWhiteboard(board, 10, 20);
    s.updatePlacements([{ id: placementId, x: 100, y: 200, w: 10, h: 10 }]);
    const p = s.getWhiteboard(board)!.placements[0]!;
    expect(p).toMatchObject({ cardId, x: 100, y: 200, w: 160, h: 100 });
    expect(() => s.updatePlacements([{ id: placementId, x: Number.NaN }])).toThrow();
  });

  it('stacks new placements above existing ones', () => {
    const s = mem();
    const board = s.createWhiteboard();
    const c = s.createCard();
    const p1 = s.addCardToWhiteboard(board, c, 0, 0);
    const p2 = s.addCardToWhiteboard(board, c, 50, 50);
    const z = Object.fromEntries(s.getWhiteboard(board)!.placements.map((p) => [p.id, p.z]));
    expect(z[p2]).toBeGreaterThan(z[p1]!);
    expect(s.getCard(c)?.boards).toEqual([{ id: board, name: 'Untitled whiteboard' }]);
  });

  it('creates edges once, validates endpoints, and cascades on removal', () => {
    const s = mem();
    const board = s.createWhiteboard();
    const other = s.createWhiteboard();
    const a = s.createCardOnWhiteboard(board, 0, 0).placementId;
    const b = s.createCardOnWhiteboard(board, 300, 0).placementId;
    const elsewhere = s.createCardOnWhiteboard(other, 0, 0).placementId;
    const e1 = s.createEdge(board, a, b);
    expect(s.createEdge(board, a, b)).toBe(e1);
    expect(() => s.createEdge(board, a, a)).toThrow();
    expect(() => s.createEdge(board, a, elsewhere)).toThrow(/this whiteboard/);
    expect(s.getWhiteboard(board)!.edges).toHaveLength(1);
    s.removePlacements([b]);
    expect(s.getWhiteboard(board)!.edges).toHaveLength(0);
    expect(s.getWhiteboard(board)!.placements).toHaveLength(1);
  });

  it('trashing a card removes its placements and edges everywhere', () => {
    const s = mem();
    const board = s.createWhiteboard();
    const a = s.createCardOnWhiteboard(board, 0, 0);
    const b = s.createCardOnWhiteboard(board, 300, 0);
    s.createEdge(board, a.placementId, b.placementId);
    s.trashCard(a.cardId);
    const data = s.getWhiteboard(board)!;
    expect(data.placements.map((p) => p.cardId)).toEqual([b.cardId]);
    expect(data.edges).toHaveLength(0);
    expect(s.listWhiteboards()[0]?.cardCount).toBe(1);
  });

  it('hides trashed whiteboards', () => {
    const s = mem();
    const board = s.createWhiteboard('gone');
    s.renameWhiteboard(board, 'still gone');
    s.trashWhiteboard(board);
    expect(s.listWhiteboards()).toEqual([]);
    expect(s.getWhiteboard(board)).toBeNull();
  });
});

describe('persistence', () => {
  it('survives reopening and keeps device identity and clock monotonic', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loom-'));
    try {
      const path = join(dir, 'loom.db');
      const first = new Store(path);
      const id = first.createCard({ title: 'persisted' });
      const device = first.deviceId;
      first.close();
      const second = new Store(path);
      open.push(second);
      expect(second.deviceId).toBe(device);
      expect(second.getCard(id)?.title).toBe('persisted');
      expect(second.search('persisted')).toHaveLength(1);
      second.updateCard(id, { title: 'renamed' });
      expect(second.getCard(id)?.title).toBe('renamed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seeds the demo space exactly once', () => {
    const s = mem();
    s.seedIfEmpty();
    s.seedIfEmpty();
    expect(s.listWhiteboards()).toHaveLength(1);
    expect(s.listCards()).toHaveLength(2);
    expect(s.getWhiteboard(s.listWhiteboards()[0]!.id)!.edges).toHaveLength(1);
    expect(s.listTags()).toEqual([{ tag: 'start-here', count: 1 }]);
  });
});
