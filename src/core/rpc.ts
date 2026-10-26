import { z } from 'zod';
import { Ai } from './ai/service.js';
import type { createLlm } from './ai/provider.js';
import { Chats } from './chats.js';
import { clipUrl, type ClipHost } from './clip.js';
import { exportAll } from './export.js';
import { Files, type FileInfo } from './files.js';
import { markdownToContent } from './markdown.js';
import { httpTransport, runSync, type SyncResult } from './sync.js';
import { TagDb } from './tagdb.js';
import type { Store } from './store.js';

/** Things the host (Electron main process or the dev server) lends to the core. */
export interface Host {
  /** Directory for attachment bytes; null disables attachments (in-memory test databases). */
  filesDir: string | null;
  /** Pushes an event to the renderer (streamed AI output etc.). */
  emit?: (channel: string, payload: unknown) => void;
  /** Test seam: replaces the real model client. */
  llmFactory?: typeof createLlm;
  /** Test seam: replaces the network used by the web clipper. */
  clip?: ClipHost;
}

export interface SyncState {
  url: string;
  hasToken: boolean;
  pending: number;
  lastSyncedAt: number | null;
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = (source[key] as unknown as (...a: unknown[]) => unknown).bind(source) as T[K];
  return out;
}

/**
 * The renderer never touches SQLite or the filesystem. It calls the named methods built here through
 * Electron IPC (or HTTP in dev); anything not listed is unreachable.
 */
export function buildApp(store: Store, host: Host) {
  const tags = new TagDb(store);
  const chats = new Chats(store);
  const files = new Files(store, host.filesDir);
  const ai = new Ai(store, chats, host.emit, host.llmFactory);

  const sync = {
    getSyncState: (): SyncState => ({
      url: store.getMeta('sync_url') ?? '',
      hasToken: !!store.getMeta('sync_token'),
      pending: store.pendingCount(),
      lastSyncedAt: Number(store.getMeta('last_synced_at')) || null,
    }),
    setSyncConfig: ({ url, token }: { url: string; token?: string }): SyncState => {
      const trimmed = url.trim();
      if (trimmed && !/^https?:\/\//i.test(trimmed)) throw new Error('Sync URL must start with http:// or https://');
      store.setMeta('sync_url', trimmed);
      if (token !== undefined) store.setMeta('sync_token', token);
      return sync.getSyncState();
    },
    syncNow: async (): Promise<SyncResult> => {
      const url = store.getMeta('sync_url');
      if (!url) throw new Error('Set a sync server URL first.');
      return runSync(store, httpTransport(url, store.getMeta('sync_token') || undefined), files);
    },
  };

  const methods = {
    ...pick(store, [
      'listCards', 'cardIndex', 'getCard', 'createCard', 'updateCard', 'trashCard', 'restoreCard', 'setInbox', 'findCardByTitle', 'cardsMentioning',
      'titlesById', 'search', 'searchAll', 'relatedCards',
      'addTag', 'removeTag', 'listTags',
      'ensureJournal', 'journalDays', 'listJournals', 'listTasks', 'setTaskChecked',
      'cardHistory', 'restoreCardVersion', 'listTrash',
      'listWhiteboards', 'createWhiteboard', 'renameWhiteboard', 'setWhiteboardColor', 'moveWhiteboard', 'trashWhiteboard', 'restoreWhiteboard',
      'getWhiteboard', 'addCardToWhiteboard', 'createCardOnWhiteboard', 'addObject', 'updatePlacements', 'removePlacements',
      'restorePlacements', 'moveToWhiteboard', 'createEdge', 'updateEdge', 'setEdgeLabel', 'deleteEdge',
    ] as const),
    ...pick(tags, [
      'setTagDef', 'deleteTag', 'renameTag', 'addTagProp', 'updateTagProp', 'removeTagProp', 'setCardProp', 'listTagProps', 'getCardProps', 'getTagTable',
    ] as const),
    ...pick(chats, [
      'createChat', 'listChats', 'getChat', 'renameChat', 'setChatContext', 'deleteChat', 'listAiActions', 'saveAiAction', 'deleteAiAction',
    ] as const),
    /** Fetches a public web page and saves its readable text as a `web` card in the inbox. */
    clipWebPage: async (url: string): Promise<string> => {
      const clip = await clipUrl(String(url), host.clip);
      const intro = `Clipped from [${clip.site}](${clip.url})\n\n`;
      return store.createCard({
        title: clip.title,
        kind: 'web',
        inbox: true,
        content: markdownToContent(intro + clip.markdown),
        meta: JSON.stringify({ url: clip.url, site: clip.site, clippedAt: Date.now() }),
      });
    },
    fileInfo: (id: string): FileInfo | null => files.info(id),
    exportAll: (format: 'markdown' | 'json') => exportAll(store, format === 'json' ? 'json' : 'markdown'),
    getAiConfig: ai.getAiConfig,
    setAiConfig: ai.setAiConfig,
    sendChat: ai.sendChat,
    stopChat: ai.stopChat,
    runAiAction: ai.runAiAction,
    generateMindMap: ai.generateMindMap,
    cardInsights: ai.cardInsights,
    promoteInsight: ai.promoteInsight,
    ...sync,
  };

  return { methods, store, tags, chats, files, ai, host };
}

export type App = ReturnType<typeof buildApp>;
type Methods = App['methods'];
export type RpcMethod = keyof Methods;
export const rpcMethodNames = (app: App): RpcMethod[] => Object.keys(app.methods) as RpcMethod[];

export type Api = { [K in keyof Methods]: (...args: Parameters<Methods[K]>) => Promise<Awaited<ReturnType<Methods[K]>>> };

export const rpcRequestSchema = z.object({
  method: z.string().min(1).max(60),
  args: z.array(z.unknown()).max(8),
});

export function createRpc(app: App): (request: unknown) => Promise<unknown> {
  const table = new Map<string, (...args: unknown[]) => unknown>(Object.entries(app.methods) as [string, (...args: unknown[]) => unknown][]);
  return async (request) => {
    const { method, args } = rpcRequestSchema.parse(request);
    const fn = table.get(method);
    if (!fn) throw new Error(`Unknown method "${method}".`);
    return await fn(...args);
  };
}
