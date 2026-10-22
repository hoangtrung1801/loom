import { z } from 'zod';
import { httpTransport, runSync } from './sync.js';
import type { Store } from './store.js';

/**
 * The renderer never touches SQLite. It calls these named methods through
 * Electron IPC (or HTTP in dev); anything not listed here is unreachable.
 */
export const STORE_METHODS = [
  'listCards', 'getCard', 'createCard', 'updateCard', 'trashCard', 'findCardByTitle', 'search',
  'addTag', 'removeTag', 'listTags',
  'listWhiteboards', 'createWhiteboard', 'renameWhiteboard', 'trashWhiteboard', 'getWhiteboard',
  'addCardToWhiteboard', 'createCardOnWhiteboard', 'updatePlacements', 'removePlacements',
  'createEdge', 'setEdgeLabel', 'deleteEdge',
] as const;
export const SYNC_METHODS = ['getSyncState', 'setSyncConfig', 'syncNow'] as const;
export const RPC_METHODS = [...STORE_METHODS, ...SYNC_METHODS] as const;

export type StoreMethod = (typeof STORE_METHODS)[number];
export type RpcMethod = (typeof RPC_METHODS)[number];

export interface SyncState {
  url: string;
  hasToken: boolean;
  pending: number;
  lastSyncedAt: number | null;
}

export interface SyncApi {
  getSyncState(): SyncState;
  setSyncConfig(config: { url: string; token?: string }): SyncState;
  syncNow(): Promise<{ pushed: number; pulled: number }>;
}

export type Api = {
  [K in StoreMethod]: (...args: Parameters<Store[K]>) => Promise<Awaited<ReturnType<Store[K]>>>;
} & { [K in keyof SyncApi]: (...args: Parameters<SyncApi[K]>) => Promise<Awaited<ReturnType<SyncApi[K]>>> };

export const rpcRequestSchema = z.object({
  method: z.enum(RPC_METHODS),
  args: z.array(z.unknown()).max(8),
});

export function createRpc(store: Store): (request: unknown) => Promise<unknown> {
  const sync: SyncApi = {
    getSyncState: () => ({
      url: store.getMeta('sync_url') ?? '',
      hasToken: !!store.getMeta('sync_token'),
      pending: store.pendingCount(),
      lastSyncedAt: Number(store.getMeta('last_synced_at')) || null,
    }),
    setSyncConfig: ({ url, token }) => {
      const trimmed = url.trim();
      if (trimmed && !/^https?:\/\//i.test(trimmed)) throw new Error('Sync URL must start with http:// or https://');
      store.setMeta('sync_url', trimmed);
      if (token !== undefined) store.setMeta('sync_token', token);
      return sync.getSyncState();
    },
    syncNow: async () => {
      const url = store.getMeta('sync_url');
      if (!url) throw new Error('Set a sync server URL first.');
      return runSync(store, httpTransport(url, store.getMeta('sync_token') || undefined));
    },
  };

  return async (request) => {
    const { method, args } = rpcRequestSchema.parse(request);
    const target = (STORE_METHODS as readonly string[]).includes(method)
      ? (store as unknown as Record<string, (...a: unknown[]) => unknown>)
      : (sync as unknown as Record<string, (...a: unknown[]) => unknown>);
    return await target[method]!(...args);
  };
}
