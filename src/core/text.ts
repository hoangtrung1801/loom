/** Minimal view of a ProseMirror JSON node; we only need to read text out of it. */
interface PmNode {
  type?: string;
  text?: string;
  content?: PmNode[];
}

const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'code_block', 'list_item', 'bullet_list', 'ordered_list']);

export function docToText(content: string): string {
  if (!content) return '';
  let doc: PmNode;
  try {
    doc = JSON.parse(content) as PmNode;
  } catch {
    return '';
  }
  const out: string[] = [];
  const walk = (node: PmNode): void => {
    if (typeof node.text === 'string') out.push(node.text);
    node.content?.forEach(walk);
    if (node.type && BLOCKS.has(node.type)) out.push('\n');
  };
  walk(doc);
  return out.join('').replace(/\n{2,}/g, '\n').trim();
}

export function snippet(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Turns free text into a safe FTS5 query, or null if nothing searchable.
 * Every token is a prefix match so results update as you type; a trailing "s"
 * is also tried without it so "gardens" finds "garden".
 */
export function toMatchQuery(input: string): string | null {
  const tokens = input.match(/[\p{L}\p{N}_]+/gu);
  if (!tokens?.length) return null;
  return tokens
    .slice(0, 12)
    .map((t) => (t.length > 3 && t.endsWith('s') ? `("${t}"* OR "${t.slice(0, -1)}"*)` : `"${t}"*`))
    .join(' ');
}

/** Builds a ProseMirror doc from plain lines; `# ` prefix makes a heading, `- ` a bullet. */
export function textDoc(lines: string[]): string {
  const content: object[] = [];
  let bullets: object[] = [];
  const flush = (): void => {
    if (bullets.length) content.push({ type: 'bullet_list', content: bullets });
    bullets = [];
  };
  for (const line of lines) {
    if (line.startsWith('- ')) {
      bullets.push({ type: 'list_item', content: [para(line.slice(2))] });
      continue;
    }
    flush();
    if (line.startsWith('# ')) {
      content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: line.slice(2) }] });
    } else {
      content.push(para(line));
    }
  }
  flush();
  return JSON.stringify({ type: 'doc', content });
}

function para(text: string): object {
  return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };
}
