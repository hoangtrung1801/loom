import { setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import type { Node as PmNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { insertFiles } from './plugins.js';
import { safeHref, schema } from './schema.js';
import type { IconName } from '../components/Icon.js';

const n = schema.nodes;

export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Opens the OS file picker and resolves with the chosen files (empty when cancelled). */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve([...(input.files ?? [])]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/** Inserts a block after the current one, or in place of it when it is an empty top-level paragraph. */
export function insertBlock(view: EditorView, node: PmNode): void {
  const { state } = view;
  const { $from } = state.selection;
  const emptyPara = $from.depth === 1 && $from.parent.type === n.paragraph && $from.parent.content.size === 0;
  const tr = state.tr;
  if (emptyPara) tr.replaceWith($from.before(), $from.after(), node);
  else tr.insert($from.depth >= 1 ? $from.after(1) : state.doc.content.size, node);
  // A document must not end on an atom: keep a paragraph below so there is always somewhere to type.
  if (tr.doc.lastChild && !tr.doc.lastChild.isTextblock) tr.insert(tr.doc.content.size, n.paragraph!.create());
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

export function insertTable(view: EditorView, rows = 3, cols = 3): void {
  const cell = (header: boolean): PmNode => (header ? n.table_header : n.table_cell)!.createAndFill()!;
  const table = n.table!.create(
    null,
    Array.from({ length: rows }, (_, r) => n.table_row!.create(null, Array.from({ length: cols }, () => cell(r === 0)))),
  );
  insertBlock(view, table);
}

export interface SlashItem {
  id: string;
  title: string;
  hint: string;
  keywords: string;
  icon: IconName;
  run(view: EditorView): void;
}

const block = (id: string, title: string, hint: string, icon: IconName, keywords: string, run: SlashItem['run']): SlashItem => ({ id, title, hint, icon, keywords, run });

export const SLASH_ITEMS: SlashItem[] = [
  block('text', 'Text', 'Plain paragraph', 'paragraph', 'paragraph plain', (v) => setBlockType(n.paragraph!)(v.state, v.dispatch)),
  block('h1', 'Heading 1', 'Big section title', 'h1', 'title header', (v) => setBlockType(n.heading!, { level: 1 })(v.state, v.dispatch)),
  block('h2', 'Heading 2', 'Medium section title', 'h2', 'subtitle header', (v) => setBlockType(n.heading!, { level: 2 })(v.state, v.dispatch)),
  block('h3', 'Heading 3', 'Small section title', 'h3', 'header', (v) => setBlockType(n.heading!, { level: 3 })(v.state, v.dispatch)),
  block('bullet', 'Bulleted list', 'Simple list', 'bullet', 'ul unordered', (v) => wrapInList(n.bullet_list!)(v.state, v.dispatch)),
  block('ordered', 'Numbered list', 'List with numbers', 'ordered', 'ol ordered', (v) => wrapInList(n.ordered_list!)(v.state, v.dispatch)),
  block('todo', 'To-do list', 'Track tasks', 'todo', 'todo task checkbox check', (v) => wrapInList(n.todo_list!)(v.state, v.dispatch)),
  block('toggle', 'Toggle list', 'Collapsible section', 'chevronRight', 'collapse fold details', (v) => {
    const { $from } = v.state.selection;
    if ($from.parent.type === n.paragraph) wrapIn(n.toggle!)(v.state, v.dispatch);
  }),
  block('quote', 'Quote', 'Call out a passage', 'quote', 'blockquote', (v) => wrapIn(n.blockquote!)(v.state, v.dispatch)),
  block('callout', 'Callout', 'Highlighted note', 'lightbulb', 'tip note info', (v) => wrapIn(n.callout!)(v.state, v.dispatch)),
  block('code', 'Code', 'Code snippet', 'code', 'snippet pre', (v) => setBlockType(n.code_block!)(v.state, v.dispatch)),
  block('table', 'Table', '3 × 3 table', 'table', 'grid', (v) => insertTable(v)),
  block('divider', 'Divider', 'Horizontal line', 'minus', 'hr rule line', (v) => insertBlock(v, n.horizontal_rule!.create())),
  block('math', 'Math equation', 'LaTeX block', 'sigma', 'latex katex formula', (v) => insertBlock(v, n.math_block!.create({ latex: '' }))),
  block('date', 'Date', 'Insert today', 'calendar', 'today calendar', (v) => v.dispatch(v.state.tr.replaceSelectionWith(n.date!.create({ value: todayIso() })).scrollIntoView())),
  block('mention', 'Mention card', 'Link to another card', 'atSign', 'link backlink reference', (v) => v.dispatch(v.state.tr.insertText('@'))),
  block('image', 'Image', 'Upload a picture', 'image', 'photo picture', (v) => void pickFiles('image/*').then((f) => insertFiles(v, f))),
  block('audio', 'Audio', 'Upload a recording', 'audio', 'sound music', (v) => void pickFiles('audio/*').then((f) => insertFiles(v, f))),
  block('video', 'Video', 'Upload a video', 'video', 'movie', (v) => void pickFiles('video/*').then((f) => insertFiles(v, f))),
  block('file', 'File', 'Attach any file', 'paperclip', 'attachment upload', (v) => void pickFiles('*/*').then((f) => insertFiles(v, f))),
];

/** Slash-menu filtering: every query word must prefix-match the title or a keyword. */
export function filterSlash(query: string): SlashItem[] {
  const words = query.toLowerCase().replace(/-/g, '').split(/\s+/).filter(Boolean);
  if (!words.length) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((item) => {
    const hay = `${item.title} ${item.keywords}`.toLowerCase().replace(/-/g, '').split(/\s+/);
    return words.every((w) => hay.some((h) => h.startsWith(w)));
  });
}

/** Replaces the typed trigger text, then lets the command act on the now-clean selection. */
export function runSlash(view: EditorView, item: SlashItem, from: number, to: number): void {
  view.dispatch(view.state.tr.delete(from, to));
  view.focus();
  item.run(view);
}

export function insertMention(view: EditorView, from: number, to: number, cardId: string, label: string): void {
  const node = n.mention!.create({ cardId, label });
  view.dispatch(view.state.tr.replaceWith(from, to, [node, schema.text(' ')]).scrollIntoView());
  view.focus();
}

// ----------------------------------------------------------------- toolbar

export function markActive(view: EditorView, name: string): boolean {
  const { from, $from, to, empty } = view.state.selection;
  const type = schema.marks[name]!;
  return empty ? !!type.isInSet(view.state.storedMarks || $from.marks()) : view.state.doc.rangeHasMark(from, to, type);
}

export const toggle = (view: EditorView, name: string, attrs?: Record<string, unknown>): void => {
  toggleMark(schema.marks[name]!, attrs)(view.state, view.dispatch);
  view.focus();
};

export function applyLink(view: EditorView, raw: string): void {
  const type = schema.marks.link!;
  const { from, to } = view.state.selection;
  const text = raw.trim();
  const href = text ? safeHref(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`) : null;
  const tr = view.state.tr.removeMark(from, to, type);
  if (href) tr.addMark(from, to, type.create({ href }));
  view.dispatch(tr);
  view.focus();
}

export function currentLink(view: EditorView): string {
  const { from, $from, empty } = view.state.selection;
  const mark = (empty ? $from.marks() : view.state.doc.resolve(from).marks()).find((m) => m.type === schema.marks.link);
  return (mark?.attrs.href as string | undefined) ?? '';
}

export type BlockChoice = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'todo' | 'quote';

export function currentBlock(view: EditorView): BlockChoice {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === n.heading) return `h${node.attrs.level}` as BlockChoice;
    if (node.type === n.todo_item) return 'todo';
    if (node.type === n.list_item) return $from.node(d - 1).type === n.ordered_list ? 'ordered' : 'bullet';
    if (node.type === n.blockquote) return 'quote';
  }
  return 'paragraph';
}

export function turnInto(view: EditorView, choice: BlockChoice): void {
  const { state, dispatch } = view;
  switch (choice) {
    case 'paragraph': setBlockType(n.paragraph!)(state, dispatch); break;
    case 'h1': setBlockType(n.heading!, { level: 1 })(state, dispatch); break;
    case 'h2': setBlockType(n.heading!, { level: 2 })(state, dispatch); break;
    case 'h3': setBlockType(n.heading!, { level: 3 })(state, dispatch); break;
    case 'bullet': wrapInList(n.bullet_list!)(state, dispatch); break;
    case 'ordered': wrapInList(n.ordered_list!)(state, dispatch); break;
    case 'todo': wrapInList(n.todo_list!)(state, dispatch); break;
    case 'quote': wrapIn(n.blockquote!)(state, dispatch); break;
  }
  view.focus();
}

export { TextSelection };
