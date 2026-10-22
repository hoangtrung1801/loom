import { z } from 'zod';
import { opSchema, type Op } from './entities.js';
import type { Files } from './files.js';
import type { Store } from './store.js';

export interface PullResult {
  ops: Op[];
  cursor: number;
  more: boolean;
}

export interface Transport {
  push(ops: Op[]): Promise<void>;
  pull(since: number, device: string, limit: number): Promise<PullResult>;
}

const BATCH = 500;

/** Pushes local ops, then pulls and merges everything newer than our cursor. */
export async function runSync(store: Store, transport: Transport, _files?: Files): Promise<{ pushed: number; pulled: number }> {
  let pushed = 0;
  let pulled = 0;
  for (;;) {
    const batch = store.pendingOps(BATCH);
    if (!batch.length) break;
    await transport.push(batch);
    store.markPushed(batch.map((o) => o.id));
    pushed += batch.length;
  }
  for (;;) {
    const since = Number(store.getMeta('sync_cursor') ?? 0);
    const res = await transport.pull(since, store.deviceId, BATCH);
    pulled += store.applyRemote(res.ops);
    store.setMeta('sync_cursor', String(res.cursor));
    if (!res.more) break;
  }
  store.setMeta('last_synced_at', String(Date.now()));
  return { pushed, pulled };
}

const pullSchema = z.object({ ops: z.array(opSchema), cursor: z.number().int().nonnegative(), more: z.boolean() });

export function httpTransport(baseUrl: string, token?: string): Transport {
  const root = baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const call = async (url: string, init?: RequestInit): Promise<unknown> => {
    const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
    return res.json();
  };
  return {
    async push(ops) {
      await call(`${root}/push`, { method: 'POST', body: JSON.stringify({ ops }) });
    },
    async pull(since, device, limit) {
      const q = new URLSearchParams({ since: String(since), device, limit: String(limit) });
      return pullSchema.parse(await call(`${root}/pull?${q}`));
    },
  };
}
