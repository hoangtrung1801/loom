/**
 * Hybrid logical clock. Timestamps are fixed-width strings so plain string
 * comparison orders them: `<wall ms, 13 digits>.<counter, 4 hex>.<device>`.
 */
export class Clock {
  private wall = 0;
  private counter = 0;

  constructor(readonly device: string, last?: string) {
    if (last) this.observe(last);
  }

  next(): string {
    const now = Date.now();
    if (now > this.wall) {
      this.wall = now;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return this.format();
  }

  /** Fold in a remote timestamp so local writes always sort after it. */
  observe(ts: string): void {
    const parsed = parseTs(ts);
    if (!parsed) return;
    if (parsed.wall > this.wall || (parsed.wall === this.wall && parsed.counter > this.counter)) {
      this.wall = parsed.wall;
      this.counter = parsed.counter;
    }
  }

  last(): string {
    return this.format();
  }

  private format(): string {
    return `${String(this.wall).padStart(13, '0')}.${this.counter.toString(16).padStart(4, '0')}.${this.device}`;
  }
}

export function parseTs(ts: string): { wall: number; counter: number; device: string } | null {
  const m = /^(\d{13})\.([0-9a-f]{4})\.(.+)$/.exec(ts);
  if (!m) return null;
  return { wall: Number(m[1]), counter: parseInt(m[2]!, 16), device: m[3]! };
}
