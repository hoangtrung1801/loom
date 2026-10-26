export { docToText } from './doc.js';

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
    .join(' AND ');
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
