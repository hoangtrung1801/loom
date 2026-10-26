import { openApp } from '../actions.js';
import { useSync } from '../store/sync.js';
import { Icon } from './Icon.js';

/** Sidebar footer status: opens Settings, where the sync server is configured. */
export function SyncBadge() {
  const state = useSync((s) => s.state);
  const busy = useSync((s) => s.busy);
  const text = !state?.url ? 'Sync off' : busy ? 'Syncing…' : state.pending ? `${state.pending} pending` : 'Synced';
  return (
    <button className="sync-badge grow" onClick={() => openApp('settings')} title="Sync settings">
      <Icon name="sync" size={14} className={busy ? 'spin' : ''} /> <span>{text}</span>
    </button>
  );
}
