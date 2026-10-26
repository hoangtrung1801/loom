import { Schema, type DOMOutputSpec, type MarkSpec, type NodeSpec, type Node as PmNode } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';
import { safeHref } from '../../core/markdown.js';
import { isFileId } from '../../core/fileid.js';

export { safeHref };

/** Block types that carry a stable `id` attribute (for citations and block-level backlinks). */
export const ID_BLOCKS = [
  'paragraph', 'heading', 'blockquote', 'code_block', 'list_item', 'todo_item', 'toggle', 'callout', 'math_block', 'image', 'audio',
  'video', 'file_block', 'table',
] as const;

const id = { id: { default: null as string | null } };

const text = (dom: HTMLElement, attr: string): string => dom.getAttribute(attr) ?? '';

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },
  paragraph: {
    content: 'inline*',
    group: 'block',
    attrs: id,
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0],
  },
  heading: {
    content: 'inline*',
    group: 'block',
    defining: true,
    attrs: { ...id, level: { default: 1 } },
    parseDOM: [1, 2, 3].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (n) => [`h${n.attrs.level}`, 0],
  },
  blockquote: { content: 'block+', group: 'block', defining: true, attrs: id, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
  callout: {
    content: 'block+',
    group: 'block',
    defining: true,
    attrs: { ...id, emoji: { default: '💡' } },
    parseDOM: [{ tag: 'div.callout', getAttrs: (d) => ({ emoji: text(d as HTMLElement, 'data-emoji') || '💡' }) }],
    toDOM: (n): DOMOutputSpec => ['div', { class: 'callout', 'data-emoji': n.attrs.emoji }, ['span', { class: 'callout-emoji', contenteditable: 'false' }, n.attrs.emoji], ['div', { class: 'callout-body' }, 0]],
  },
  code_block: {
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    attrs: { ...id, language: { default: '' } },
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full', getAttrs: (d) => ({ language: text(d as HTMLElement, 'data-language') }) }],
    toDOM: (n): DOMOutputSpec => ['pre', { 'data-language': n.attrs.language }, ['code', 0]],
  },
  horizontal_rule: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
  bullet_list: { content: 'list_item+', group: 'block', parseDOM: [{ tag: 'ul:not(.todo)' }], toDOM: () => ['ul', 0] },
  ordered_list: {
    content: 'list_item+',
    group: 'block',
    attrs: { order: { default: 1 } },
    parseDOM: [{ tag: 'ol', getAttrs: (d) => ({ order: +(text(d as HTMLElement, 'start') || 1) }) }],
    toDOM: (n): DOMOutputSpec => (n.attrs.order === 1 ? ['ol', 0] : ['ol', { start: n.attrs.order }, 0]),
  },
  list_item: { content: 'paragraph block*', defining: true, attrs: id, parseDOM: [{ tag: 'li:not(.todo-item)' }], toDOM: () => ['li', 0] },
  todo_list: { content: 'todo_item+', group: 'block', parseDOM: [{ tag: 'ul.todo' }], toDOM: () => ['ul', { class: 'todo' }, 0] },
  todo_item: {
    content: 'paragraph block*',
    defining: true,
    attrs: { ...id, checked: { default: false } },
    parseDOM: [{ tag: 'li.todo-item', getAttrs: (d) => ({ checked: (d as HTMLElement).getAttribute('data-checked') === 'true' }) }],
    toDOM: (n): DOMOutputSpec => ['li', { class: 'todo-item', 'data-checked': String(n.attrs.checked) }, 0],
  },
  toggle: {
    content: 'paragraph block*',
    group: 'block',
    defining: true,
    attrs: { ...id, open: { default: true } },
    parseDOM: [{ tag: 'div.toggle', getAttrs: (d) => ({ open: (d as HTMLElement).getAttribute('data-open') !== 'false' }) }],
    toDOM: (n): DOMOutputSpec => ['div', { class: 'toggle', 'data-open': String(n.attrs.open) }, ['div', { class: 'toggle-body' }, 0]],
  },
  math_block: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { ...id, latex: { default: '' } },
    parseDOM: [{ tag: 'div.math-block', getAttrs: (d) => ({ latex: text(d as HTMLElement, 'data-latex') }) }],
    toDOM: (n): DOMOutputSpec => ['div', { class: 'math-block', 'data-latex': n.attrs.latex }, n.attrs.latex],
  },
  image: {
    group: 'block',
    atom: true,
    draggable: true,
    attrs: { ...id, fileId: { default: '' }, name: { default: '' } },
    parseDOM: [{ tag: 'img[data-file-id]', getAttrs: (d) => (isFileId(text(d as HTMLElement, 'data-file-id')) ? { fileId: text(d as HTMLElement, 'data-file-id'), name: text(d as HTMLElement, 'alt') } : false) }],
    toDOM: (n): DOMOutputSpec => ['img', { 'data-file-id': n.attrs.fileId, alt: n.attrs.name }],
  },
  audio: {
    group: 'block',
    atom: true,
    draggable: true,
    attrs: { ...id, fileId: { default: '' }, name: { default: '' } },
    parseDOM: [{ tag: 'audio[data-file-id]', getAttrs: (d) => ({ fileId: text(d as HTMLElement, 'data-file-id') }) }],
    toDOM: (n): DOMOutputSpec => ['audio', { 'data-file-id': n.attrs.fileId }],
  },
  video: {
    group: 'block',
    atom: true,
    draggable: true,
    attrs: { ...id, fileId: { default: '' }, name: { default: '' } },
    parseDOM: [{ tag: 'video[data-file-id]', getAttrs: (d) => ({ fileId: text(d as HTMLElement, 'data-file-id') }) }],
    toDOM: (n): DOMOutputSpec => ['video', { 'data-file-id': n.attrs.fileId }],
  },
  file_block: {
    group: 'block',
    atom: true,
    draggable: true,
    attrs: { ...id, fileId: { default: '' }, name: { default: '' } },
    parseDOM: [{ tag: 'div.file-block', getAttrs: (d) => ({ fileId: text(d as HTMLElement, 'data-file-id'), name: text(d as HTMLElement, 'data-name') }) }],
    toDOM: (n): DOMOutputSpec => ['div', { class: 'file-block', 'data-file-id': n.attrs.fileId, 'data-name': n.attrs.name }, n.attrs.name || 'File'],
  },
  text: { group: 'inline' },
  hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  mention: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { cardId: { default: '' }, label: { default: '' } },
    parseDOM: [{ tag: 'span.mention', getAttrs: (d) => ({ cardId: text(d as HTMLElement, 'data-card-id'), label: (d as HTMLElement).textContent ?? '' }) }],
    toDOM: (n): DOMOutputSpec => ['span', { class: 'mention', 'data-card-id': n.attrs.cardId }, n.attrs.label],
  },
  date: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { value: { default: '' } },
    parseDOM: [{ tag: 'span.date', getAttrs: (d) => ({ value: text(d as HTMLElement, 'data-value') }) }],
    toDOM: (n): DOMOutputSpec => ['span', { class: 'date', 'data-value': n.attrs.value }, n.attrs.value],
  },
  math_inline: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { latex: { default: '' } },
    parseDOM: [{ tag: 'span.math-inline', getAttrs: (d) => ({ latex: text(d as HTMLElement, 'data-latex') }) }],
    toDOM: (n): DOMOutputSpec => ['span', { class: 'math-inline', 'data-latex': n.attrs.latex }, n.attrs.latex],
  },
};

const cells = tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} });
nodes.table = { ...cells.table!, attrs: id, toDOM: () => ['table', ['tbody', 0]] };
nodes.table_row = cells.table_row!;
nodes.table_cell = cells.table_cell!;
nodes.table_header = cells.table_header!;

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: {}, title: { default: null } },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (dom) => {
          const href = safeHref((dom as HTMLElement).getAttribute('href'));
          return href ? { href } : false;
        },
      },
    ],
    toDOM(mark): DOMOutputSpec {
      const href = safeHref(mark.attrs.href);
      return href ? ['a', { href, rel: 'noopener noreferrer', target: '_blank' }, 0] : ['span', 0];
    },
  },
  em: { parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
  strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight=bold' }], toDOM: () => ['strong', 0] },
  underline: { parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }], toDOM: () => ['u', 0] },
  strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }], toDOM: () => ['s', 0] },
  highlight: {
    attrs: { color: { default: 'yellow' } },
    parseDOM: [{ tag: 'mark', getAttrs: (d) => ({ color: text(d as HTMLElement, 'data-color') || 'yellow' }) }],
    toDOM: (m): DOMOutputSpec => ['mark', { 'data-color': m.attrs.color }, 0],
  },
  code: { excludes: '_', parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
};

export const schema = new Schema({ nodes, marks });

export function emptyDoc(): PmNode {
  return schema.topNodeType.createAndFill()!;
}

/** Parses stored JSON; returns null when the content can't be represented (so we never overwrite it). */
export function parseDoc(json: string): PmNode | null {
  if (!json) return emptyDoc();
  try {
    const node = schema.nodeFromJSON(JSON.parse(json));
    node.check();
    return node;
  } catch {
    return null;
  }
}
