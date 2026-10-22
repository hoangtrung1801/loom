import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncState } from '../../core/rpc.js';
import { api, errorMessage } from '../api.js';
import { hasPendingSaves, useApp } from '../state.js';

const AUTO_SYNC_MS = 60_000;

export function SyncPanel() {
  const [state, setState] = useState<SyncState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const busyRef = useRef(false);

  const refresh = useCallback(() => api.getSyncState().then(setState).catch(() => undefined), []);

  const sync = useCallback(async (quiet = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await api.syncNow();
      if (r.pulled && !hasPendingSaves()) await useApp.getState().reload();
      setMessage(`Synced · ${r.pushed} sent, ${r.pulled} received`);
    } catch (err) {
      if (!quiet) setMessage(errorMessage(err));
      else setMessage('Last sync failed');
    } finally {
      busyRef.current = false;
      setBusy(false);
      void refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!state?.url) return;
    const t = window.setInterval(() => void sync(true), AUTO_SYNC_MS);
    return () => window.clearInterval(t);
  }, [state?.url, sync]);

  const save = async (): Promise<void> => {
    try {
      // An empty token field keeps the stored token; undefined means "don't touch".
      setState(await api.setSyncConfig({ url, token: token || undefined }));
      setToken('');
      setMessage('Saved');
      await sync();
    } catch (err) {
      setMessage(errorMessage(err));
    }
  };

  return (
    <footer className="sync">
      <button className="row" onClick={() => { setOpen(!open); setUrl(state?.url ?? ''); }} aria-expanded={open}>
        <span className="grow">{state?.url ? 'Sync' : 'Sync (off)'}</span>
        <span className="count">{state?.url ? (state.pending ? `${state.pending} pending` : 'up to date') : ''}</span>
      </button>
      {open && (
        <div className="sync-form">
          <label>Server URL<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8787" /></label>
          <label>
            Access token{state?.hasToken ? ' (saved)' : ''}
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={state?.hasToken ? '••••••••' : 'optional'} autoComplete="off" />
          </label>
          <div className="actions">
            <button onClick={() => void save()}>Save</button>
            <button disabled={!state?.url || busy} onClick={() => void sync()}>{busy ? 'Syncing…' : 'Sync now'}</button>
          </div>
          {message && <p className="msg" role="status">{message}</p>}
        </div>
      )}
    </footer>
  );
}
