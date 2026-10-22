import { newBlockId, type DocNode } from './doc.js';

/** Only these schemes may appear in links; content can come from imports, the web and the model. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

type Mark = { type: string; attrs?: Record<string, unknown> };

const INLINE: { re: RegExp; make(m: RegExpExecArray): { text: string; mark?: Mark; raw?: DocNode; recurse?: boolean } }[] = [
  { re: /`([^`\n]+)`/, make: (m) => ({ text: m[1]!, mark: { type: 'code' } }) },
  {
    re: /\[([^\[\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/,
    make: (m) => {
      const href = safeHref(m[2]);
      return { text: m[1]!, recurse: true, mark: href ? { type: 'link', attrs: { href, title: null } } : undefined };
    },
  },
  { re: /\*\*([^*\n]+?)\*\*/, make: (m) => ({ text: m[1]!, mark: { type: 'strong' }, recurse: true }) },
  { re: /~~([^~\n]+?)~~/, make: (m) => ({ text: m[1]!, mark: { type: 'strike' }, recurse: true }) },
  { re: /==([^=\n]+?)==/, make: (m) => ({ text: m[1]!, mark: { type: 'highlight', attrs: { color: 'yellow' } }, recurse: true }) },
  { re: /(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])/, make: (m) => ({ text: m[1]!, mark: { type: 'em' }, recurse: true }) },
  { re: /(?<![\w_])_([^_\s][^_\n]*?)_(?![\w_])/, make: (m) => ({ text: m[1]!, mark: { type: 'em' }, recurse: true }) },
  { re: /\$([^$\s][^$\n]*?)\$/, make: (m) => ({ text: '', raw: { type: 'math_inline', attrs: { latex: m[1]! } } }) },
];

export function inlineToNodes(src: string, marks: Mark[] = []): DocNode[] {
  const out: DocNode[] = [];
  let rest = src;
  const emit = (text: string): void => {
    if (text) out.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text });
  };
  while (rest) {
    let best: { index: number; length: number; i: number; m: RegExpExecArray } | null = null;
    INLINE.forEach((p, i) => {
      const m = p.re.exec(rest);
      if (m && (!best || m.index < best.index)) best = { index: m.index, length: m[0].length, i, m };
    });
    if (!best) {
      emit(rest);
      break;
    }
    const b = best as { index: number; length: number; i: number; m: RegExpExecArray };
    emit(rest.slice(0, b.index));
    const made = INLINE[b.i]!.make(b.m);
    if (made.raw) out.push(made.raw);
    else if (made.recurse) out.push(...inlineToNodes(made.text, made.mark ? [...marks, made.mark] : marks));
    else if (made.text) out.push({ type: 'text', text: made.text, marks: made.mark ? [...marks, made.mark] : marks });
    rest = rest.slice(b.index + b.length);
  }
  return out;
}

const para = (text: string): DocNode => {
  const content = inlineToNodes(text);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
};

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TODO_RE = /^\[( |x|X)\]\s+(.*)$/;

/** Parses the markdown subset Loom stores. Unknown syntax degrades to paragraphs rather than failing. */
export function markdownToDoc(markdown: string): DocNode {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const parseBlocks = (ls: string[]): DocNode[] => {
    const out: DocNode[] = [];
    let i = 0;
    while (i < ls.length) {
      const line = ls[i]!;
      if (!line.trim()) {
        i++;
        continue;
      }

      const fence = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/.exec(line);
      if (fence) {
        const body: string[] = [];
        i++;
        while (i < ls.length && !ls[i]!.trim().startsWith(fence[1]!)) body.push(ls[i++]!);
        i++;
        out.push({
          type: 'code_block',
          attrs: { language: fence[2] ?? '' },
          ...(body.length ? { content: [{ type: 'text', text: body.join('\n') }] } : {}),
        });
        continue;
      }

      if (line.trim() === '$$') {
        const body: string[] = [];
        i++;
        while (i < ls.length && ls[i]!.trim() !== '$$') body.push(ls[i++]!);
        i++;
        out.push({ type: 'math_block', attrs: { latex: body.join('\n') } });
        continue;
      }

      const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading) {
        const content = inlineToNodes(heading[2]!);
        out.push({ type: 'heading', attrs: { level: Math.min(3, heading[1]!.length) }, ...(content.length ? { content } : {}) });
        i++;
        continue;
      }

      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        out.push({ type: 'horizontal_rule' });
        i++;
        continue;
      }

      if (/^\s*>/.test(line)) {
        const quoted: string[] = [];
        while (i < ls.length && /^\s*>/.test(ls[i]!)) quoted.push(ls[i++]!.replace(/^\s*> ?/, ''));
        const callout = /^\[!\w+\]\s*(.*)$/.exec(quoted[0] ?? '');
        if (callout) {
          quoted[0] = callout[1] ?? '';
          out.push({ type: 'callout', attrs: { emoji: '💡' }, content: parseBlocks(quoted).length ? parseBlocks(quoted) : [{ type: 'paragraph' }] });
        } else {
          out.push({ type: 'blockquote', content: parseBlocks(quoted).length ? parseBlocks(quoted) : [{ type: 'paragraph' }] });
        }
        continue;
      }

      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < ls.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(ls[i + 1]!)) {
        const rows: string[][] = [];
        const split = (l: string): string[] => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
        rows.push(split(line));
        i += 2;
        while (i < ls.length && /^\s*\|.*\|\s*$/.test(ls[i]!)) rows.push(split(ls[i++]!));
        const width = Math.max(...rows.map((r) => r.length));
        out.push({
          type: 'table',
          content: rows.map((r, ri) => ({
            type: 'table_row',
            content: Array.from({ length: width }, (_, ci) => ({
              type: ri === 0 ? 'table_header' : 'table_cell',
              content: [para(r[ci] ?? '')],
            })),
          })),
        });
        continue;
      }

      if (LIST_RE.test(line)) {
        const start = i;
        const base = LIST_RE.exec(line)![1]!.length;
        while (i < ls.length && (LIST_RE.test(ls[i]!) || (ls[i]!.trim() && /^\s{2,}\S/.test(ls[i]!) && !LIST_RE.test(ls[i]!))) && (LIST_RE.exec(ls[i]!)?.[1]!.length ?? base + 2) >= base) i++;
        out.push(parseList(ls.slice(start, i), base));
        continue;
      }

      const buf: string[] = [line];
      i++;
      while (i < ls.length && ls[i]!.trim() && !/^\s*(```|~~~|#{1,6}\s|>|\$\$|\|)/.test(ls[i]!) && !LIST_RE.test(ls[i]!)) buf.push(ls[i++]!);
      const nodes: DocNode[] = [];
      buf.forEach((l, k) => {
        if (k > 0) nodes.push({ type: 'hard_break' });
        nodes.push(...inlineToNodes(l.trim()));
      });
      out.push(nodes.length ? { type: 'paragraph', content: nodes } : { type: 'paragraph' });
    }
    return out;
  };

  const parseList = (ls: string[], base: number): DocNode => {
    const first = LIST_RE.exec(ls[0]!)!;
    const ordered = /\d/.test(first[2]!);
    const items: { head: string; children: string[] }[] = [];
    for (const l of ls) {
      const m = LIST_RE.exec(l);
      if (m && m[1]!.length <= base) items.push({ head: m[3]!, children: [] });
      else if (items.length) items.at(-1)!.children.push(l);
    }
    const todo = items.every((it) => TODO_RE.test(it.head)) && items.length > 0;
    const nodes = items.map((it): DocNode => {
      const t = todo ? TODO_RE.exec(it.head)! : null;
      const text = t ? t[2]! : it.head;
      const indent = Math.min(...it.children.filter((c) => c.trim()).map((c) => c.match(/^\s*/)![0].length), Infinity);
      const kids = it.children.length && Number.isFinite(indent) ? parseBlocks(it.children.map((c) => c.slice(indent))) : [];
      return {
        type: todo ? 'todo_item' : 'list_item',
        ...(todo ? { attrs: { checked: t![1] !== ' ' } } : {}),
        content: [para(text), ...kids],
      };
    });
    if (todo) return { type: 'todo_list', content: nodes };
    return ordered
      ? { type: 'ordered_list', attrs: { order: parseInt(first[2]!, 10) || 1 }, content: nodes }
      : { type: 'bullet_list', content: nodes };
  };

  const content = parseBlocks(lines);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

/** Markdown straight to the stored JSON string, with block ids assigned. */
export function markdownToContent(markdown: string): string {
  const stamp = (n: DocNode): void => {
    if (['paragraph', 'heading', 'blockquote', 'code_block', 'list_item', 'todo_item', 'callout', 'math_block', 'table'].includes(n.type ?? '')) {
      n.attrs = { ...n.attrs, id: newBlockId() };
    }
    n.content?.forEach(stamp);
  };
  const doc = markdownToDoc(markdown);
  stamp(doc);
  return JSON.stringify(doc);
}
