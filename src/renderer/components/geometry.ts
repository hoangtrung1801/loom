export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Where the line from a rect's centre toward `target` leaves the rect's border. */
export function borderPoint(r: Rect, target: Point): Point {
  const c = center(r);
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const scale = Math.min(r.w / 2 / Math.abs(dx || Infinity), r.h / 2 / Math.abs(dy || Infinity));
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

export function bounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
