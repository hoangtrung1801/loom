import type { BoardData, PlacementView, Store } from '../store.js';
import type { Handles } from './handles.js';
import { estimateTokens } from './tokens.js';

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface BoardTextOptions {
  mode?: 'content' | 'layout';
  viewport?: Viewport;
  tokenBudget?: number;
}

const CLUSTER_W = 4000;
const CLUSTER_H = 3000;
const BOARD_BUDGET = 16_000;

const clip = (s: string, n: number): string => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

function label(p: PlacementView): string {
  switch (p.kind) {
    case 'card': return `card "${clip(p.title || 'Untitled', 80)}"`;
    case 'section': return `section "${clip(p.title || p.text || 'Untitled', 80)}"`;
    case 'board': return `whiteboard "${clip(p.title || 'Untitled', 80)}"`;
    default: return `text "${clip(p.text, 100)}"`;
  }
}

function count(items: string[]): string {
  const by = new Map<string, number>();
  for (const i of items) by.set(i, (by.get(i) ?? 0) + 1);
  return [...by].map(([k, v]) => `${k} ${v}`).join(', ');
}

/**
 * Serializes a whiteboard as a tree the model can read: sections are parents, mind-map nodes nest under their
 * parent, and connections are listed as `a -> b`. Layout mode adds coordinates and groups far-away objects
 * into coarse clusters so a huge board still fits.
 */
export function serializeBoard(store: Store, handles: Handles, boardId: string, options: BoardTextOptions = {}): string | null {
  const board = store.getWhiteboard(boardId);
  if (!board) return null;
  const budget = options.tokenBudget ?? BOARD_BUDGET;
  // Shrink how many children each parent shows until the whole thing fits.
  for (const perParent of [60, 30, 15, 8, 4, 2]) {
    const out = render(store, handles, board, options, perParent);
    if (estimateTokens(out.text) <= budget || perParent === 2) return out.truncated ? `${out.text}\n(Output truncated)` : out.text;
  }
  return null;
}

function render(store: Store, handles: Handles, board: BoardData, options: BoardTextOptions, perParent: number): { text: string; truncated: boolean } {
  const layout = options.mode === 'layout';
  const handle = (p: PlacementView): string => handles.short('p', p.id);
  const objs = board.placements;
  const cards = objs.filter((p) => p.kind === 'card');
  const others = objs.filter((p) => p.kind !== 'card');
  const parent = board.whiteboard.parentId ? store.getWhiteboard(board.whiteboard.parentId)?.whiteboard : undefined;

  const lines: string[] = [];
  lines.push(`whiteboard "${board.whiteboard.name || 'Untitled'}" ${handles.short('w', board.whiteboard.id)}`);
  lines.push(`cards: ${cards.length}${cards.length ? ` (${count(cards.map((c) => c.cardKind))})` : ''}; other objects: ${others.length}${others.length ? ` (${count(others.map((o) => o.kind))})` : ''}`);
  if (parent) lines.push(`parent whiteboard: "${parent.name}" ${handles.short('w', parent.id)}`);
  if (!objs.length) {
    lines.push('(empty whiteboard)');
    return { text: lines.join('\n'), truncated: false };
  }

  const vp = options.viewport;
  const inViewport = (p: PlacementView): boolean => !vp || (p.x < vp.x + vp.w && p.x + p.w > vp.x && p.y < vp.y + vp.h && p.y + p.h > vp.y);
  const visible = layout && vp ? objs.filter(inViewport) : objs;
  const peripheral = layout && vp ? objs.filter((p) => !inViewport(p)) : [];
  if (layout && vp) lines.push(`viewport: x=${Math.round(vp.x)} y=${Math.round(vp.y)} w=${Math.round(vp.w)} h=${Math.round(vp.h)}; in viewport: ${visible.length}, peripheral: ${peripheral.length}`);

  let truncated = false;
  const describe = (p: PlacementView): string => {
    const geometry = layout ? ` @(${Math.round(p.x)},${Math.round(p.y)}) ${Math.round(p.w)}x${Math.round(p.h)}` : '';
    const color = p.color ? ` ${p.color}` : '';
    const ref = p.kind === 'card' ? `${handles.short('c', p.cardId)}/${handle(p)}` : handle(p);
    return `${label(p)} ${ref}${color}${geometry}`;
  };

  const inTree = new Set(visible.map((p) => p.id));
  const childrenOf = (id: string): PlacementView[] => visible.filter((p) => p.parentId === id && inTree.has(p.id));
  const walk = (p: PlacementView, depth: number, out: string[]): void => {
    out.push(`${'  '.repeat(depth)}- ${describe(p)}`);
    const kids = childrenOf(p.id);
    for (const k of kids.slice(0, perParent)) walk(k, depth + 1, out);
    if (kids.length > perParent) {
      truncated = true;
      out.push(`${'  '.repeat(depth + 1)}- … ${kids.length - perParent} more`);
    }
  };

  const sections = visible.filter((p) => p.kind === 'section');
  const roots = (list: PlacementView[]): PlacementView[] => list.filter((p) => p.kind !== 'section' && !p.parentId);
  for (const s of sections) {
    const members = roots(visible.filter((p) => p.sectionId === s.id));
    lines.push(`${describe(s)} (${members.length} objects)`);
    for (const m of members.slice(0, perParent)) walk(m, 1, lines);
    if (members.length > perParent) {
      truncated = true;
      lines.push(`  - … ${members.length - perParent} more`);
    }
  }
  const loose = roots(visible.filter((p) => !p.sectionId || !sections.some((s) => s.id === p.sectionId)));
  if (loose.length) {
    lines.push(sections.length ? '(unsectioned)' : 'objects:');
    for (const m of loose.slice(0, perParent * 2)) walk(m, 1, lines);
    if (loose.length > perParent * 2) {
      truncated = true;
      lines.push(`  - … ${loose.length - perParent * 2} more`);
    }
  }

  if (peripheral.length) {
    const cells = new Map<string, PlacementView[]>();
    for (const p of peripheral) {
      const key = `${Math.floor(p.x / CLUSTER_W)},${Math.floor(p.y / CLUSTER_H)}`;
      cells.set(key, [...(cells.get(key) ?? []), p]);
    }
    lines.push('Peripheral clusters (outside the viewport):');
    for (const [key, list] of cells) {
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      lines.push(`  cell x=${cx * CLUSTER_W}..${(cx + 1) * CLUSTER_W} y=${cy * CLUSTER_H}..${(cy + 1) * CLUSTER_H}: ${list.length} objects, e.g. ${list.slice(0, 4).map(label).join('; ')}`);
    }
  }

  const byId = new Map(objs.map((p) => [p.id, p]));
  const edges = board.edges.filter((e) => byId.has(e.from) && byId.has(e.to));
  if (edges.length) {
    lines.push('Connections:');
    for (const e of edges.slice(0, 200)) {
      const arrow = e.arrow === 'both' ? '<->' : e.arrow === 'none' ? '--' : e.arrow === 'start' ? '<-' : '->';
      const style = [e.color, e.style && e.style !== 'solid' ? e.style : ''].filter(Boolean).join(', ');
      lines.push(`  ${handle(byId.get(e.from)!)} ${arrow} ${handle(byId.get(e.to)!)}${style ? ` (${style})` : ''}${e.label ? ` "${clip(e.label, 80)}"` : ''}`);
    }
    if (edges.length > 200) truncated = true;
  }
  return { text: lines.join('\n'), truncated };
}
