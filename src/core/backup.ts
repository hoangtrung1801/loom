import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './json-storage.js';
import type { Store } from './store.js';

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
}

const NAME = /^loom-(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})\.json$/;
const DAY = 86_400_000;

/**
 * Local safety net, separate from sync: once a day the whole library is written to a single
 * JSON file (every record with its merge clock, settings without secrets), keeping the most
 * recent few. Attachments are content-addressed and never rewritten, so they need no copies.
 */
export class Backups {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly store: Store,
    readonly dir: string,
    private readonly keep = 7,
  ) {}

  list(): BackupInfo[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((n) => NAME.test(n))
      .map((name) => ({ name, size: statSync(join(this.dir, name)).size, createdAt: parseName(name) }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Takes a snapshot now and prunes old ones. Returns the new backup. */
  run(now = Date.now()): BackupInfo {
    mkdirSync(this.dir, { recursive: true });
    const name = `loom-${new Date(now).toISOString().slice(0, 19).replace(/:/g, '')}.json`;
    const final = join(this.dir, name);
    writeFileAtomic(final, JSON.stringify(this.store.snapshot()), 0o600);
    for (const old of this.list().slice(this.keep)) rmSync(join(this.dir, old.name), { force: true });
    return { name, size: statSync(final).size, createdAt: parseName(name) };
  }

  /** Backs up when the newest snapshot is a day old, now and then hourly while the app runs. */
  schedule(): void {
    const tick = (): void => {
      const latest = this.list()[0];
      if (!latest || Date.now() - latest.createdAt >= DAY) {
        try {
          this.run();
        } catch {
          /* a full disk must not take the app down; the next tick tries again */
        }
      }
    };
    tick();
    this.timer = setInterval(tick, DAY / 24);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

function parseName(name: string): number {
  const m = NAME.exec(name)!;
  return Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
}
