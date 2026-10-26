/**
 * Short, run-scoped names for the things the model can see. A UUID costs ~20 tokens every time it appears;
 * `c3` costs one. Only handles minted in this run resolve, so the model cannot address things it was never shown.
 */
export type HandleKind = 'c' | 'w' | 'p';

export class Handles {
  private readonly toId = new Map<string, string>();
  private readonly toHandle = new Map<string, string>();
  private readonly counters: Record<HandleKind, number> = { c: 0, w: 0, p: 0 };

  short(kind: HandleKind, id: string): string {
    const key = `${kind}:${id}`;
    const existing = this.toHandle.get(key);
    if (existing) return existing;
    const handle = `${kind}${++this.counters[kind]}`;
    this.toHandle.set(key, handle);
    this.toId.set(handle, id);
    return handle;
  }

  /** The id behind a handle; undefined when the model invented it. */
  resolve(handle: unknown, kind?: HandleKind): string | undefined {
    if (typeof handle !== 'string') return undefined;
    const h = handle.trim().toLowerCase();
    if (kind && !h.startsWith(kind)) return undefined;
    return this.toId.get(h);
  }
}
