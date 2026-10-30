import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importKnowMe, parseFrontMatter } from '../src/core/import-knowme.js';
import { Store } from '../src/core/store.js';
import { Work } from '../src/core/work.js';

const dirs: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'knowme-'));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const task = (id: string, extra = '', body = '') =>
  `---\nid: ${id}\nprojectId: p1\ntitle: 'Task ${id}'\nstatus: done\npriority: high\nlabels:\n  - bug\ncreatedAt: '2026-01-01T00:00:00.000Z'\nupdatedAt: '2026-01-03T00:00:00.000Z'\ncompletedAt: '2026-01-02T00:00:00.000Z'\n${extra}---\n# Task ${id}\n\n## Description\n\n<!-- SECTION:DESCRIPTION:BEGIN -->\nDo it.\n<!-- SECTION:DESCRIPTION:END -->\n\n## Acceptance Criteria\n<!-- AC:BEGIN -->\n- [x] #1 First\n- [ ] #2 Second\n<!-- AC:END -->\n${body}`;

describe('Know-Me import', () => {
  it('parses the front matter Know-Me writes', () => {
    const { data, body } = parseFrontMatter("---\ntitle: 'It''s here'\nlabels: []\ntags:\n  - a\n  - b\ndescription: ''\n---\n\nHello");
    expect(data).toEqual({ title: "It's here", labels: [], tags: ['a', 'b'], description: '' });
    expect(body.trim()).toBe('Hello');
  });

  it('imports tasks, links, memos and docs with their original times, and a second run adds nothing', () => {
    const root = workspace({
      'registry.json': JSON.stringify([{ id: 'p1', name: 'My Project' }]),
      'tasks/task-p1--a - one.md': task('a'),
      'archive/task-p1--b - two.md': task('b', 'parent: a\n', '\n## Implementation Plan\n\n<!-- SECTION:PLAN:BEGIN -->\nStep 1\n<!-- SECTION:PLAN:END -->\n').replace('status: done', 'status: urgent'),
      'links/x.json': JSON.stringify({ id: 'x', url: 'https://example.com/a?utm_source=z', title: 'Example', description: 'D', note: 'Why', tags: ['ref'], createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-02T00:00:00Z' }),
      'links/y.json': JSON.stringify({ id: 'y', url: 'https://example.com/a', title: 'Dup', tags: [] }),
      'links/bad.json': JSON.stringify({ id: 'bad', url: 'not a url' }),
      'memos/m.md': '---\ncreatedAt: 2026-03-01T00:00:00.000Z\nupdatedAt: 2026-03-01T00:00:00.000Z\n---\n\nIdea: ship it',
      'docs/p1--research/deep-dive.md': "---\ntitle: Deep dive\ncreatedAt: '2026-04-01T00:00:00.000Z'\nupdatedAt: '2026-04-02T00:00:00.000Z'\ntags:\n  - canvas\n---\n\n# Heading\n\nBody text.",
    });
    const store = new Store(':memory:');
    stores.push(store);
    const report = importKnowMe(store, root);
    expect(report).toMatchObject({ tasks: 2, links: 1, memos: 1, docs: 1, skipped: 1 });
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('links/bad.json');

    const work = new Work(store);
    const [a, b] = ['Task a', 'Task b'].map((t) => work.listTasks({ includeDone: true }).find((x) => x.title === t)!);
    expect(a).toMatchObject({ status: 'done', priority: 'high', labels: ['bug', 'my-project'], progress: { done: 1, total: 2 }, createdAt: Date.parse('2026-01-01T00:00:00Z'), completedAt: Date.parse('2026-01-02T00:00:00Z') });
    expect(b).toMatchObject({ status: 'todo', priority: 'high', parentId: a!.id });
    expect(store.search('Step').map((h) => h.id)).toContain(b!.id);

    const [link] = work.listLinks();
    expect(link).toMatchObject({ title: 'Example', description: 'D', note: 'Why', tags: ['ref'], createdAt: Date.parse('2026-02-01T00:00:00Z') });
    expect(store.listCards({ kinds: ['memo'] })).toHaveLength(1);
    const doc = store.listCards({ kinds: ['note'] })[0]!;
    expect(doc).toMatchObject({ title: 'Deep dive', updatedAt: Date.parse('2026-04-02T00:00:00Z') });
    expect(doc.tags.sort()).toEqual(['canvas', 'my-project', 'research']);

    expect(importKnowMe(store, root)).toMatchObject({ tasks: 0, links: 0, memos: 0, docs: 0 });
  });
});
