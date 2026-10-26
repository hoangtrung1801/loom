import { docToMarkdown, type BlockRange, type MdLine } from '../doc.js';
import type { ContextRef, SourceRef } from '../chats.js';
import type { Store } from '../store.js';
import type { Handles } from './handles.js';
import { estimateTokens } from './tokens.js';

/**
 * Line-addressable view of a card. The model reads numbered markdown lines and cites them as `[c3:12-14]`;
 * the client maps line numbers back to the exact block that produced them (Heptabase's citationTarget idea).
 */
export interface CardText {
  id: string;
  handle: string;
  title: string;
  kind: string;
  header: string;
  lines: MdLine[];
  blocks: BlockRange[];
}

export const TOKEN_BUDGET = 25_000;
const COVERAGE_RATIO = 0.4;
const COVERAGE_CAP = 8_000;
const SLICE_MIN = 120;
const SLICE_MAX = 500;

export function loadCardText(store: Store, handles: Handles, id: string, titles?: Map<string, string>): CardText | null {
  const card = store.getCard(id);
  if (!card) return null;
  const lookup = (cardId: string): string | undefined => titles?.get(cardId) ?? store.titlesById([cardId])[cardId];
  const md = docToMarkdown(card.content, lookup);
  const handle = handles.short('c', id);
  const title = card.title || (card.kind === 'journal' ? card.journalDate : '') || 'Untitled';
  const attrs = [card.kind, ...card.tags.map((t) => `#${t}`)];
  if (card.fileId && card.kind !== 'note' && card.kind !== 'journal') attrs.push('attachment not readable as text');
  return { id, handle, title, kind: card.kind, header: `${handle} card "${title}" (${attrs.join(', ')})`, lines: md.lines, blocks: md.blocks };
}

const numbered = (obj: CardText, from: number, to: number): string => {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${String(i).padStart(3)}| ${obj.lines[i - 1]!.text}`);
  return out.join('\n');
};

const lineTokens = (obj: CardText, i: number): number => estimateTokens(obj.lines[i]!.text) + 2;

export interface ReadResult {
  text: string;
  /** Lines actually emitted per object, so the caller can tell which citations are valid. */
  shown: { obj: CardText; from: number; to: number; complete: boolean }[];
  omitted: CardText[];
}

/**
 * Reads many cards into a fixed token budget in three phases:
 *  1. coverage: every card gets a fair slice of its first whole lines,
 *  2. fill: leftover budget goes to partly-read cards, shortest remainder first,
 *  3. admit: cards that got nothing are let in while budget remains.
 */
export function readWithinBudget(objects: CardText[], tokenBudget = TOKEN_BUDGET): ReadResult {
  const taken = new Map<CardText, number>(); // lines emitted from the start
  let used = 0;
  const headerCost = (o: CardText): number => estimateTokens(o.header) + 4;

  const takeLines = (o: CardText, allowance: number): number => {
    let have = taken.get(o) ?? 0;
    let spent = 0;
    while (have < o.lines.length) {
      const cost = lineTokens(o, have);
      // Always make progress on a first line, even a long one, as long as the overall budget holds.
      if (spent + cost > allowance && !(have === 0 && spent === 0 && used + headerCost(o) + cost <= tokenBudget)) break;
      spent += cost;
      have++;
    }
    taken.set(o, have);
    return spent;
  };

  const coverage = Math.min(COVERAGE_CAP, Math.floor(tokenBudget * COVERAGE_RATIO));
  const candidates = objects.slice(0, Math.max(1, Math.floor(coverage / SLICE_MIN)));
  const slice = Math.min(SLICE_MAX, Math.max(SLICE_MIN, Math.floor(coverage / Math.max(1, candidates.length))));

  for (const o of candidates) {
    if (used + headerCost(o) > tokenBudget) break;
    used += headerCost(o);
    used += takeLines(o, Math.min(slice, tokenBudget - used));
  }
  const partial = candidates
    .filter((o) => taken.has(o) && (taken.get(o) ?? 0) < o.lines.length)
    .sort((a, b) => remaining(a, taken) - remaining(b, taken));
  for (const o of partial) {
    if (used >= tokenBudget) break;
    used += takeLines(o, tokenBudget - used);
  }
  for (const o of objects) {
    if (taken.has(o)) continue;
    if (used + headerCost(o) + SLICE_MIN > tokenBudget) continue;
    used += headerCost(o);
    used += takeLines(o, Math.min(slice, tokenBudget - used));
  }

  const shown = objects.filter((o) => taken.has(o)).map((o) => ({ obj: o, from: 1, to: taken.get(o)!, complete: taken.get(o)! >= o.lines.length }));
  const omitted = objects.filter((o) => !taken.has(o));
  const parts = shown.map(({ obj, to, complete }) => {
    const body = to > 0 ? numbered(obj, 1, to) : '';
    const tail = complete ? '' : `\n    … lines 1-${to} of ${obj.lines.length} shown; call read_card with offset=${to + 1} to continue`;
    return `${obj.header}${body ? `\n${body}` : ''}${tail}`;
  });
  const partialCount = shown.filter((s) => !s.complete).length;
  let text = parts.join('\n\n');
  if (partialCount || omitted.length) {
    text += `\n\n(${partialCount} partial, ${omitted.length} omitted${omitted.length ? `: ${omitted.slice(0, 20).map((o) => `${o.handle} "${o.title}"`).join(', ')}` : ''})`;
  }
  return { text, shown, omitted };
}

const remaining = (o: CardText, taken: Map<CardText, number>): number => {
  let tokens = 0;
  for (let i = taken.get(o) ?? 0; i < o.lines.length; i++) tokens += lineTokens(o, i);
  return tokens;
};

export interface ReadCardOptions {
  offset?: number;
  limit?: number;
  blockIds?: string[];
  tokenBudget?: number;
}

/** One card, paginated by line, or just the lines belonging to the given blocks. */
export function readCard(obj: CardText, options: ReadCardOptions = {}): { text: string; from: number; to: number; missing: string[] } {
  const total = obj.lines.length;
  if (options.blockIds?.length) {
    const wanted = new Set<number>();
    const missing: string[] = [];
    for (const id of options.blockIds) {
      const range = obj.blocks.find((b) => b.blockId === id);
      if (!range) missing.push(id);
      else for (let i = range.startLine; i <= range.endLine; i++) wanted.add(i);
    }
    const lines = [...wanted].sort((a, b) => a - b);
    const body = lines.map((i) => `${String(i).padStart(3)}| ${obj.lines[i - 1]!.text}`).join('\n');
    return { text: `${obj.header}\n${body}${missing.length ? `\n(blocks not found: ${missing.join(', ')})` : ''}`, from: lines[0] ?? 0, to: lines.at(-1) ?? 0, missing };
  }
  const paginated = options.offset !== undefined || options.limit !== undefined;
  const budget = options.tokenBudget ?? (paginated ? 30_000 : 15_000);
  const from = Math.min(Math.max(1, Math.trunc(options.offset ?? 1)), Math.max(1, total));
  const cap = Math.min(total, from + Math.max(1, Math.trunc(options.limit ?? total)) - 1);
  let to = from - 1;
  let spent = estimateTokens(obj.header);
  while (to < cap) {
    const cost = lineTokens(obj, to);
    if (spent + cost > budget && to >= from) break;
    spent += cost;
    to++;
  }
  if (total === 0) return { text: `${obj.header}\n(empty)`, from: 0, to: 0, missing: [] };
  let text = `${obj.header}\n${numbered(obj, from, to)}`;
  if (to < total) text += `\n(Showing lines ${from}-${to} of ${total}. Use offset and limit to read more.)`;
  return { text, from, to, missing: [] };
}

/** Resolves `[c3:12-14]` style citations in model output to blocks, renumbering them in order of first use. */
export function resolveCitations(text: string, cards: Map<string, CardText>, handles: Handles): { text: string; sources: SourceRef[] } {
  const sources: SourceRef[] = [];
  const index = new Map<string, number>();
  const out = text.replace(/\[(c\d+):(\d+)(?:\s*[-–]\s*(\d+))?\]/g, (whole, handle: string, a: string, b?: string) => {
    const id = handles.resolve(handle, 'c');
    const obj = id ? cards.get(id) : undefined;
    if (!obj) return '';
    const start = Math.min(Math.max(1, Number(a)), obj.lines.length);
    const end = Math.min(Math.max(start, Number(b ?? a)), obj.lines.length);
    if (!obj.lines.length) return '';
    const block = obj.lines[start - 1]!.blocks.at(-1) ?? '';
    const key = `${obj.id}:${block}`;
    let n = index.get(key);
    if (!n) {
      n = sources.length + 1;
      index.set(key, n);
      const quote = obj.lines.slice(start - 1, end).map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 240);
      sources.push({ n, cardId: obj.id, title: obj.title, blockId: block, startLine: start, endLine: end, quote });
    }
    return `[${n}]`;
  });
  return { text: out, sources };
}

/** What a chat's attached context expands to: the cards it names. */
export function contextCardIds(store: Store, refs: ContextRef[], limit = 200): string[] {
  const ids = new Set<string>();
  const add = (id: string): void => {
    if (id && ids.size < limit) ids.add(id);
  };
  for (const ref of refs) {
    switch (ref.type) {
      case 'card': add(ref.id); break;
      case 'tag': store.listCards({ tag: ref.id, limit }).forEach((c) => add(c.id)); break;
      case 'search': store.search(ref.id, 30).forEach((h) => add(h.id)); break;
      case 'whiteboard':
      case 'section': {
        const board = store.getWhiteboard(ref.type === 'whiteboard' ? ref.id : (ref.boardId ?? ''));
        if (!board) break;
        const members = ref.type === 'section' ? board.placements.filter((p) => p.sectionId === ref.id) : board.placements;
        members.filter((p) => p.kind === 'card').forEach((p) => add(p.cardId));
        break;
      }
    }
  }
  return [...ids];
}
