import { create } from 'zustand';
import type { SyncState } from '../../core/rpc.js';
import { api, errorMessage } from '../api.js';
import { hasPendingSaves } from './edits.js';
import { refresh } from './data.js';

const AUTO_SYNC_MS = 60_000;

interface SyncStore {
  state: SyncState | null;
  busy: boolean;
  message: string;
  load(): Promise<void>;
  sync(quiet?: boolean): Promise<void>;
  save(url: string, token: string): Promise<void>;
  start(): () => void;
}

export const useSync = create<SyncStore>((set, get) => ({
  state: null,
  busy: false,
  message: '',

  async load() {
    try {
      set({ state: await api.getSyncState() });
    } catch {
      /* the badge simply shows nothing */
    }
  },

  async sync(quiet = false) {
    if (get().busy) return;
    set({ busy: true });
    try {
      const r = await api.syncNow();
      if (r.pulled && !hasPendingSaves()) await refresh();
      set({ message: `Synced · ${r.pushed} sent, ${r.pulled} received${r.files.up + r.files.down ? `, ${r.files.up + r.files.down} files` : ''}${r.files.failed ? `, ${r.files.failed} files will retry` : ''}` });
    } catch (err) {
      set({ message: quiet ? 'Last sync failed' : errorMessage(err) });
    } finally {
      set({ busy: false });
      void get().load();
    }
  },

  async save(url, token) {
    try {
      // An empty token field keeps the stored token; undefined means "don't touch".
      set({ state: await api.setSyncConfig({ url, token: token || undefined }), message: 'Saved' });
      await get().sync();
    } catch (err) {
      set({ message: errorMessage(err) });
    }
  },

  start() {
    void get().load();
    const t = window.setInterval(() => {
      if (get().state?.url) void get().sync(true);
    }, AUTO_SYNC_MS);
    return () => window.clearInterval(t);
  },
}));
