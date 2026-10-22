import { describe, expect, it } from 'vitest';
import {
  docToMarkdown, docToText, extractHeadings, extractLinks, extractTasks, setTaskChecked, withBlockIds, wordCount, type DocNode,
} from '../src/core/doc.js';
import { markdownToContent, markdownToDoc, safeHref } from '../src/core/markdown.js';

const p = (text: string, id: string, marks?: DocNode['marks']): DocNode => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const doc = (...content: DocNode[]): string => JSON.stringify({ type: 'doc', content });

describe('docToMarkdown', () => {
  it('numbers lines and remembers which block produced each one', () => {
    const content = doc(
      { type: 'heading', attrs: { id: 'h1', level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
      p('first', 'p1'),
      { type: 'bullet_list', content: [{ type: 'list_item', attrs: { id: 'li1' }, content: [p('alpha', 'p2')] }, { type: 'list_item', attrs: { id: 'li2' }, content: [p('beta', 'p3')] }] },
    );
    const md = docToMarkdown(content);
    expect(md.lines.map((l) => l.text)).toEqual(['## Plan', '', 'first', '', '- alpha', '- beta']);
    expect(md.lines[2]!.blocks).toEqual(['p1']);
    expect(md.lines[4]!.blocks).toEqual(['b1', 'li1', 'p2']);
    expect(md.blocks.find((b) => b.blockId === 'p3')).toEqual({ blockId: 'p3', startLine: 6, endLine: 6 });
    // a list item covers its own lines, so asking for "li2" returns just that bullet
    expect(md.blocks.find((b) => b.blockId === 'li2')).toMatchObject({ startLine: 6, endLine: 6 });
  });

  it('blank lines inherit the previous block so citations stay attached', () => {
    const md = docToMarkdown(doc(p('one', 'a'), p('two', 'b')));
    expect(md.lines.map((l) => [l.text, l.blocks.at(-1)])).toEqual([['one', 'a'], ['', 'a'], ['two', 'b']]);
  });

  it('renders marks, links, mentions, todos, code, tables and media', () => {
    const content = doc(
      { type: 'paragraph', attrs: { id: 'x' }, content: [
        { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://example.com/' } }] },
        { type: 'text', text: ' ' },
        { type: 'mention', attrs: { cardId: 'c1', label: 'Old title' } },
        { type: 'date', attrs: { value: '2025-01-31' } },
      ] },
      { type: 'todo_list', content: [{ type: 'todo_item', attrs: { id: 't1', checked: true }, content: [p('done', 'tp')] }, { type: 'todo_item', attrs: { id: 't2', checked: false }, content: [p('open', 'tq')] }] },
      { type: 'code_block', attrs: { id: 'c', language: 'ts' }, content: [{ type: 'text', text: 'let a = 1;\nlet b = 2;' }] },
      { type: 'table', attrs: { id: 'tb' }, content: [
        { type: 'table_row', content: [{ type: 'table_header', content: [p('A', 'ta')] }, { type: 'table_header', content: [p('B', 'tb2')] }] },
        { type: 'table_row', content: [{ type: 'table_cell', content: [p('1', 'tc')] }, { type: 'table_cell', content: [p('2', 'td')] }] },
      ] },
      { type: 'image', attrs: { id: 'img', fileId: 'f'.repeat(64) } },
    );
    const text = docToMarkdown(content, (id) => (id === 'c1' ? 'New title' : undefined)).lines.map((l) => l.text);
    expect(text).toEqual([
      '**bold** and [site](https://example.com/) [[New title]]2025-01-31', '',
      '- [x] done', '- [ ] open', '',
      '```ts', 'let a = 1;', 'let b = 2;', '```', '',
      '| A | B |', '| --- | --- |', '| 1 | 2 |', '',
      `<image fileId="${'f'.repeat(64)}" />`,
    ]);
  });

  it('tolerates garbage', () => {
    expect(docToMarkdown('').lines).toEqual([]);
    expect(docToMarkdown('{nope').lines).toEqual([]);
  });
});

describe('derived indexes', () => {
  const content = doc(
    { type: 'heading', attrs: { id: 'h', level: 1 }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'paragraph', attrs: { id: 'pa' }, content: [{ type: 'text', text: 'see ' }, { type: 'mention', attrs: { cardId: 'target', label: 'Target' } }, { type: 'text', text: ' and [[Other card]]' }] },
    { type: 'todo_list', content: [{ type: 'todo_item', attrs: { id: 't1', checked: false }, content: [{ type: 'paragraph', attrs: { id: 'x' }, content: [{ type: 'text', text: 'call ' }, { type: 'date', attrs: { value: '2025-03-02' } }] }] }] },
  );

  it('extracts links with the block that holds them', () => {
    expect(extractLinks(content)).toEqual([
      { blockId: 'pa', targetId: 'target', targetTitle: 'Target', text: 'see Target and [[Other card]]' },
      { blockId: 'pa', targetId: '', targetTitle: 'Other card', text: 'see Target and [[Other card]]' },
    ]);
  });

  it('ignores [[links]] inside inline code', () => {
    const c = doc({ type: 'paragraph', attrs: { id: 'a' }, content: [{ type: 'text', text: '[[nope]]', marks: [{ type: 'code' }] }] });
    expect(extractLinks(c)).toEqual([]);
  });

  it('extracts tasks with due dates, and toggles them by block id', () => {
    expect(extractTasks(content)).toEqual([{ blockId: 't1', text: 'call 2025-03-02', checked: false, due: '2025-03-02' }]);
    const toggled = setTaskChecked(content, 't1', true)!;
    expect(extractTasks(toggled)[0]!.checked).toBe(true);
    expect(setTaskChecked(content, 'missing', true)).toBeNull();
  });

  it('extracts headings and counts words in mixed scripts', () => {
    expect(extractHeadings(content)).toEqual([{ blockId: 'h', level: 1, text: 'Title' }]);
    expect(wordCount(doc(p('hello brave new world', 'a')))).toBe(4);
    expect(wordCount(doc(p('你好世界 hello', 'a')))).toBe(5);
  });

  it('flattens to searchable text', () => {
    expect(docToText(content)).toContain('see Target and [[Other card]]');
    expect(docToText(content)).toContain('call 2025-03-02');
  });

  it('gives every block an id once, and keeps existing ids', () => {
    const raw = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }, { type: 'paragraph', attrs: { id: 'keep' }, content: [{ type: 'text', text: 'b' }] }, { type: 'paragraph', attrs: { id: 'keep' } }] });
    const out = JSON.parse(withBlockIds(raw)) as { content: DocNode[] };
    const ids = out.content.map((n) => n.attrs!.id as string);
    expect(ids[1]).toBe('keep');
    expect(new Set(ids).size).toBe(3);
    const once = withBlockIds(raw);
    expect(withBlockIds(once)).toBe(once);
  });
});

describe('markdownToDoc', () => {
  it('parses headings, lists, todos, quotes, code, math and tables', () => {
    const d = markdownToDoc('# Title\n\nSome **bold** and *it* text with `code` and [a link](https://x.test).\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n- [ ] open\n- [x] done\n\n> quoted\n\n```js\nconst a = 1;\n```\n\n$$\nE=mc^2\n$$\n\n| A | B |\n| - | - |\n| 1 | 2 |\n');
    const types = d.content!.map((n) => n.type);
    expect(types).toEqual(['heading', 'paragraph', 'bullet_list', 'ordered_list', 'todo_list', 'blockquote', 'code_block', 'math_block', 'table']);
    const list = d.content![2]!;
    expect(list.content![1]!.content!.map((c) => c.type)).toEqual(['paragraph', 'bullet_list']);
    expect(d.content![4]!.content!.map((i) => i.attrs!.checked)).toEqual([false, true]);
    expect(d.content![7]!.attrs!.latex).toBe('E=mc^2');
    const para = d.content![1]!.content!;
    expect(para.find((n) => n.marks?.[0]?.type === 'strong')!.text).toBe('bold');
    expect(para.find((n) => n.marks?.[0]?.type === 'link')!.marks![0]!.attrs!.href).toBe('https://x.test/');
  });

  it('round-trips through docToMarkdown', () => {
    const md = '## Heading\n\nA paragraph with **bold** text.\n\n- [ ] task one\n- [x] task two\n\n```ts\nlet x = 1;\n```';
    const back = docToMarkdown(markdownToContent(md)).lines.map((l) => l.text).join('\n');
    expect(back).toBe(md);
  });

  it('drops unsafe link targets but keeps the text', () => {
    const d = markdownToDoc('[click](javascript:alert(1)) and [ok](https://ok.test)');
    const nodes = d.content![0]!.content!;
    expect(nodes.some((n) => n.marks?.some((m) => m.type === 'link' && String(m.attrs?.href).startsWith('javascript')))).toBe(false);
    expect(nodes.map((n) => n.text).join('')).toBe('click and ok');
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('mailto:a@b.test')).toBe('mailto:a@b.test');
  });

  it('never throws on odd input', () => {
    for (const s of ['', '\n\n', '|a|', '```', '$$', '> [!note]', '- ', '#', '[[x]]', '**', '`', '1.']) expect(() => markdownToDoc(s)).not.toThrow();
  });
});
