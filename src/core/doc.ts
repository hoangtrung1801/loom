/**
 * Pure helpers over card documents (ProseMirror JSON). Nothing here depends on a schema or a DOM, so
 * the store, the AI context engine and the tests can all read the same content.
 */

export interface DocNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: DocNode[];
}

/** One line of markdown and the blocks it came from, outermost first (the last entry is the innermost block). */
export interface MdLine {
  text: string;
  blocks: string[];
}
export interface BlockRange {
  blockId: string;
  startLine: number;
  endLine: number;
}
export interface MarkdownDoc {
  lines: MdLine[];
  /** 1-based inclusive line ranges, one per block that produced at least one line. */
  blocks: BlockRange[];
}

export interface LinkRef {
  blockId: string;
  /** Set for mention nodes; wikilinks only know the title. */
  targetId: string;
  targetTitle: string;
  /** Plain text of the block that contains the link. */
  text: string;
}
export interface TaskRef {
  blockId: string;
  text: string;
  checked: boolean;
  due: string;
}
export interface HeadingRef {
  blockId: string;
  level: number;
  text: string;
}

export const WIKILINK = /\[\[([^\[\]\n]{1,200})\]\]/g;

const CONTAINERS = new Set([
  'doc', 'blockquote', 'bullet_list', 'ordered_list', 'todo_list', 'list_item', 'todo_item', 'toggle', 'callout',
  'table', 'table_row', 'table_cell', 'table_header',
]);

export function parseDoc(content: string): DocNode | null {
  if (!content) return null;
  try {
    const doc = JSON.parse(content) as DocNode;
    return doc && typeof doc === 'object' ? doc : null;
  } catch {
    return null;
  }
}

export function newBlockId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

const idOf = (node: DocNode): string => (typeof node.attrs?.id === 'string' ? node.attrs.id : '');

// ----------------------------------------------------------------- plain text

/** Inline text of one node (no block separators): mentions, dates and math are flattened to readable text. */
export function inlineText(node: DocNode, titleOf?: (cardId: string) => string | undefined): string {
  switch (node.type) {
    case 'text':
      return node.text ?? '';
    case 'hard_break':
      return '\n';
    case 'mention': {
      const id = String(node.attrs?.cardId ?? '');
      return titleOf?.(id) ?? String(node.attrs?.label ?? '');
    }
    case 'date':
      return String(node.attrs?.value ?? '');
    case 'math_inline':
      return String(node.attrs?.latex ?? '');
    default:
      return (node.content ?? []).map((c) => inlineText(c, titleOf)).join('');
  }
}

export function docToText(content: string): string {
  const doc = parseDoc(content);
  if (!doc) return '';
  const out: string[] = [];
  const walk = (node: DocNode): void => {
    if (node.type === 'text' || node.type === 'mention' || node.type === 'date' || node.type === 'math_inline') {
      out.push(inlineText(node));
      return;
    }
    if (node.type === 'table_cell' || node.type === 'table_header') {
      node.content?.forEach(walk);
      out.push(' ');
      return;
    }
    if (node.type === 'math_block') out.push(String(node.attrs?.latex ?? ''), '\n');
    if (node.type === 'hard_break') out.push('\n');
    node.content?.forEach(walk);
    if (node.type && node.type !== 'doc' && (!CONTAINERS.has(node.type) || node.type === 'list_item' || node.type === 'todo_item' || node.type === 'table_row')) {
      out.push('\n');
    }
  };
  walk(doc);
  return out.join('').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

export function wordCount(content: string): number {
  const text = docToText(content);
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const words = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ').match(/[\p{L}\p{N}_'’-]+/gu)?.length ?? 0;
  return cjk + words;
}

// ------------------------------------------------------------------ markdown

function marked(node: DocNode, titleOf?: (id: string) => string | undefined): string {
  let text = inlineText(node, titleOf);
  if (node.type === 'mention') text = `[[${text}]]`;
  if (node.type === 'math_inline') text = `$${text}$`;
  if (!text.trim() || !node.marks?.length) return text;
  const lead = text.match(/^\s*/)![0];
  const trail = text.match(/\s*$/)![0];
  let core = text.trim();
  for (const mark of node.marks) {
    if (mark.type === 'code') core = `\`${core}\``;
    else if (mark.type === 'strong') core = `**${core}**`;
    else if (mark.type === 'em') core = `*${core}*`;
    else if (mark.type === 'strike') core = `~~${core}~~`;
    else if (mark.type === 'highlight') core = `==${core}==`;
    else if (mark.type === 'link' && typeof mark.attrs?.href === 'string') core = `[${core}](${mark.attrs.href})`;
  }
  return lead + core + trail;
}

function inlineMarkdown(node: DocNode, titleOf?: (id: string) => string | undefined): string {
  return (node.content ?? []).map((c) => marked(c, titleOf)).join('');
}

/**
 * Converts a document to markdown lines, remembering which block produced each line. This is the unit the
 * AI context engine reads, budgets and cites: "lines 12-18 of card X" resolves back to exact blocks.
 */
export function docToMarkdown(content: string, titleOf?: (cardId: string) => string | undefined): MarkdownDoc {
  const doc = parseDoc(content);
  const lines: MdLine[] = [];
  if (!doc) return { lines, blocks: [] };
  let counter = 0;
  const chain: string[] = [];

  const blockIdFor = (node: DocNode): string => idOf(node) || `b${++counter}`;
  const push = (text: string, extra: string[] = []): void => {
    lines.push({ text, blocks: [...chain, ...extra] });
  };
  /** Runs `fn` with `node` as the current block; returns the lines it produced. */
  const scoped = (node: DocNode, fn: () => void): MdLine[] => {
    const before = lines.length;
    chain.push(blockIdFor(node));
    fn();
    chain.pop();
    return lines.splice(before);
  };
  const prefixed = (inner: MdLine[], first: string, rest: string): void => {
    inner.forEach((l, i) => lines.push({ text: (i === 0 ? first : rest) + l.text, blocks: l.blocks }));
  };

  const block = (node: DocNode): void => {
    switch (node.type) {
      case 'paragraph':
        scoped(node, () => {
          for (const part of inlineMarkdown(node, titleOf).split('\n')) push(part);
        }).forEach((l) => lines.push(l));
        break;
      case 'heading':
        scoped(node, () => push(`${'#'.repeat(Math.min(6, Math.max(1, Number(node.attrs?.level) || 1)))} ${inlineMarkdown(node, titleOf)}`))
          .forEach((l) => lines.push(l));
        break;
      case 'code_block':
        scoped(node, () => {
          push(`\`\`\`${String(node.attrs?.language ?? '')}`);
          for (const part of (node.content ?? []).map((c) => c.text ?? '').join('').split('\n')) push(part);
          push('```');
        }).forEach((l) => lines.push(l));
        break;
      case 'math_block':
        scoped(node, () => {
          push('$$');
          for (const part of String(node.attrs?.latex ?? '').split('\n')) push(part);
          push('$$');
        }).forEach((l) => lines.push(l));
        break;
      case 'horizontal_rule':
        scoped(node, () => push('---')).forEach((l) => lines.push(l));
        break;
      case 'image':
      case 'audio':
      case 'video':
      case 'file_block': {
        const tag = node.type === 'file_block' ? 'file' : node.type;
        const name = node.attrs?.name ? ` name="${String(node.attrs.name)}"` : '';
        scoped(node, () => push(`<${tag} fileId="${String(node.attrs?.fileId ?? '')}"${name} />`)).forEach((l) => lines.push(l));
        break;
      }
      case 'blockquote':
      case 'callout': {
        const inner = scoped(node, () => blocks(node.content ?? []));
        prefixed(inner.length ? inner : [{ text: '', blocks: [] }], node.type === 'callout' ? '> [!note] ' : '> ', '> ');
        break;
      }
      case 'bullet_list':
      case 'ordered_list':
      case 'todo_list': {
        scoped(node, () => {
          let n = Number(node.attrs?.order) || 1;
          for (const item of node.content ?? []) {
            const inner = scoped(item, () => blocks(item.content ?? [], true));
            const marker =
              node.type === 'ordered_list' ? `${n++}. `
              : node.type === 'todo_list' || item.type === 'todo_item' ? (item.attrs?.checked ? '- [x] ' : '- [ ] ')
              : '- ';
            prefixed(inner.length ? inner : [{ text: '', blocks: [] }], marker, ' '.repeat(marker.length));
          }
        }).forEach((l) => lines.push(l));
        break;
      }
      case 'toggle': {
        const inner = scoped(node, () => blocks(node.content ?? [], true));
        prefixed(inner, '▸ ', '  ');
        break;
      }
      case 'table': {
        scoped(node, () => {
          (node.content ?? []).forEach((row, r) => {
            const cells = (row.content ?? []).map((c) => (c.content ?? []).map((p) => inlineMarkdown(p, titleOf)).join(' ').replace(/\|/g, '\\|'));
            push(`| ${cells.join(' | ')} |`);
            if (r === 0) push(`| ${cells.map(() => '---').join(' | ')} |`);
          });
        }).forEach((l) => lines.push(l));
        break;
      }
      default:
        if (node.content) blocks(node.content);
    }
  };

  /** Siblings are separated by one blank line, which inherits the previous block's id (so citations stay attached). */
  const blocks = (nodes: DocNode[], tight = false): void => {
    nodes.forEach((n, i) => {
      if (i > 0 && !tight) lines.push({ text: '', blocks: lines[lines.length - 1]?.blocks ?? [] });
      block(n);
    });
  };

  blocks(doc.content ?? []);
  while (lines.length && lines[lines.length - 1]!.text === '') lines.pop();

  const ranges = new Map<string, BlockRange>();
  lines.forEach((l, i) => {
    for (const id of l.blocks) {
      const r = ranges.get(id);
      if (r) r.endLine = i + 1;
      else ranges.set(id, { blockId: id, startLine: i + 1, endLine: i + 1 });
    }
  });
  return { lines, blocks: [...ranges.values()] };
}

// ------------------------------------------------------------- derived indexes

/** Mentions (by card id) and [[wikilinks]] (by title), each with the text of the block that contains them. */
export function extractLinks(content: string): LinkRef[] {
  const doc = parseDoc(content);
  const out: LinkRef[] = [];
  if (!doc) return out;
  let counter = 0;
  const visit = (node: DocNode, blockId: string): void => {
    const own = idOf(node);
    const isTextBlock = ['paragraph', 'heading', 'code_block'].includes(node.type ?? '');
    const id = own || (isTextBlock ? `b${++counter}` : blockId);
    if (isTextBlock || node.type === 'math_block') {
      const text = inlineText(node);
      const walk = (n: DocNode): void => {
        if (n.type === 'mention') {
          out.push({ blockId: id, targetId: String(n.attrs?.cardId ?? ''), targetTitle: String(n.attrs?.label ?? ''), text });
        } else if (n.type === 'text' && n.text && !n.marks?.some((m) => m.type === 'code')) {
          for (const m of n.text.matchAll(WIKILINK)) out.push({ blockId: id, targetId: '', targetTitle: m[1]!.trim(), text });
        }
        n.content?.forEach(walk);
      };
      walk(node);
      return;
    }
    node.content?.forEach((c) => visit(c, id));
  };
  visit(doc, '');
  return out;
}

export function extractTasks(content: string): TaskRef[] {
  const doc = parseDoc(content);
  const out: TaskRef[] = [];
  if (!doc) return out;
  let counter = 0;
  const visit = (node: DocNode): void => {
    if (node.type === 'todo_item') {
      const id = idOf(node) || `t${++counter}`;
      const own: string[] = [];
      let due = '';
      const walk = (n: DocNode): void => {
        if (n.type === 'todo_list') return; // nested items are their own tasks
        if (n.type === 'date' && !due) due = String(n.attrs?.value ?? '');
        if (n.type === 'paragraph') own.push(inlineText(n));
        n.content?.forEach(walk);
      };
      node.content?.forEach(walk);
      out.push({ blockId: id, text: own.join(' ').trim(), checked: !!node.attrs?.checked, due });
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  return out;
}

export function extractHeadings(content: string): HeadingRef[] {
  const doc = parseDoc(content);
  const out: HeadingRef[] = [];
  let counter = 0;
  const visit = (node: DocNode): void => {
    if (node.type === 'heading') {
      counter++;
      out.push({ blockId: idOf(node) || `h${counter}`, level: Number(node.attrs?.level) || 1, text: inlineText(node).trim() });
    }
    node.content?.forEach(visit);
  };
  if (doc) visit(doc);
  return out;
}

/** Returns the document with one to-do's checked state changed, or null when the block does not exist. */
export function setTaskChecked(content: string, blockId: string, checked: boolean): string | null {
  const doc = parseDoc(content);
  if (!doc) return null;
  let counter = 0;
  let found = false;
  const visit = (node: DocNode): void => {
    if (node.type === 'todo_item') {
      const id = idOf(node) || `t${++counter}`;
      if (id === blockId) {
        node.attrs = { ...node.attrs, checked };
        found = true;
      }
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  return found ? JSON.stringify(doc) : null;
}

/** Fills in missing block ids so cited blocks stay addressable. Existing ids are kept. */
export function withBlockIds(content: string): string {
  const doc = parseDoc(content);
  if (!doc) return content;
  const ID_TYPES = new Set([
    'paragraph', 'heading', 'blockquote', 'code_block', 'list_item', 'todo_item', 'toggle', 'callout', 'math_block', 'image', 'audio',
    'video', 'file_block', 'table',
  ]);
  const seen = new Set<string>();
  const visit = (node: DocNode): void => {
    if (node.type && ID_TYPES.has(node.type)) {
      let id = idOf(node);
      if (!id || seen.has(id)) id = newBlockId();
      seen.add(id);
      node.attrs = { ...node.attrs, id };
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  return JSON.stringify(doc);
}

export function emptyDocJson(): string {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
}
