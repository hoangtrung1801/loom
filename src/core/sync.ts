import { z } from 'zod';
import { opSchema, type Op } from './entities.js';
import type { Files } from './files.js';
import type { Store } from './store.js';

export interface PullResult {
  ops: Op[];
  cursor: number;
  more: boolean;
}

/** Attachment bytes travel separately from ops, addressed by their SHA-256. */
export interface BlobTransport {
  /** Which of `ids` the server does not have yet. */
  missing(ids: string[]): Promise<string[]>;
  put(id: string, bytes: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array | null>;
}

export interface Transport {
  push(ops: Op[]): Promise<void>;
  pull(since: number, device: string, limit: number): Promise<PullResult>;
  blobs?: BlobTransport;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Attachments uploaded to / downloaded from the server; `failed` ones are retried on the next sync. */
  files: { up: number; down: number; failed: number };
}

const BATCH = 500;

/** Pushes local ops, then pulls and merges everything newer than our cursor. */
export async function runSync(store: Store, transport: Transport, files?: Files): Promise<SyncResult> {
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
  const moved = files && transport.blobs ? await syncBlobs(files, transport.blobs) : { up: 0, down: 0, failed: 0 };
  store.setMeta('last_synced_at', String(Date.now()));
  return { pushed, pulled, files: moved };
}

/** Uploads bytes the server lacks and downloads bytes this device lacks. One bad file never blocks the rest. */
async function syncBlobs(files: Files, blobs: BlobTransport): Promise<SyncResult['files']> {
  const result = { up: 0, down: 0, failed: 0 };
  const local = files.local();
  const wanted = local.length ? await blobs.missing(local).catch(() => null) : [];
  if (wanted === null) result.failed += local.length;
  for (const id of wanted ?? []) {
    try {
      await blobs.put(id, files.read(id));
      result.up++;
    } catch {
      result.failed++;
    }
  }
  for (const id of files.missing()) {
    try {
      const bytes = await blobs.get(id);
      if (!bytes) continue; // the owning device has not uploaded it yet
      files.putVerified(id, bytes);
      result.down++;
    } catch {
      result.failed++;
    }
  }
  return result;
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
  const authOnly: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const blobCall = async (path: string, init: RequestInit): Promise<Response> =>
    fetch(`${root}${path}`, { ...init, headers: { ...authOnly, ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(120_000) });
  return {
    blobs: {
      async missing(ids) {
        const out: string[] = [];
        for (let i = 0; i < ids.length; i += 500) {
          const res = await blobCall('/files/missing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: ids.slice(i, i + 500) }) });
          if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
          out.push(...z.object({ missing: z.array(z.string()) }).parse(await res.json()).missing);
        }
        return out;
      },
      async put(id, bytes) {
        const res = await blobCall(`/files/${id}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: bytes as BodyInit });
        if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
      },
      async get(id) {
        const res = await blobCall(`/files/${id}`, { method: 'GET' });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      },
    },
    async push(ops) {
      await call(`${root}/push`, { method: 'POST', body: JSON.stringify({ ops }) });
    },
    async pull(since, device, limit) {
      const q = new URLSearchParams({ since: String(since), device, limit: String(limit) });
      return pullSchema.parse(await call(`${root}/pull?${q}`));
    },
  };
}
