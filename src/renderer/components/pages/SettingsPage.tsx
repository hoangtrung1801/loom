import { useEffect, useState } from 'react';
import type { AiConfig } from '../../../core/ai/config.js';
import { api, errorMessage } from '../../api.js';
import { toast } from '../../store/data.js';
import { useSync } from '../../store/sync.js';
import { timeAgo } from '../ui/bits.js';

export function SettingsPage() {
  return (
    <div className="page settings">
      <div className="page-head"><h2 className="grow">Settings</h2></div>
      <SyncSection />
      <AiSection />
      <ExportSection />
      <p className="hint">Loom keeps everything on this device. Sync and AI are optional and off until you configure them.</p>
    </div>
  );
}

function SyncSection() {
  const { state, busy, message, load, sync, save } = useSync();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setUrl(state?.url ?? ''), [state?.url]);
  return (
    <section aria-label="Sync">
      <h3>Sync</h3>
      <p className="hint">Point Loom at a sync server (<code>bun run sync-server</code>) to share notes across devices. Changes merge field by field, so editing offline is safe.</p>
      <form onSubmit={(e) => { e.preventDefault(); void save(url.trim(), token).then(() => setToken('')); }}>
        <label className="field"><span>Server URL</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8787" /></label>
        <label className="field"><span>Token</span><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={state?.hasToken ? '•••••• (saved)' : 'optional'} autoComplete="off" /></label>
        <div className="row">
          <button className="btn primary" type="submit">Save</button>
          <button className="btn" type="button" disabled={busy || !state?.url} onClick={() => void sync()}>{busy ? 'Syncing…' : 'Sync now'}</button>
          <span className="hint">{message || (state?.lastSyncedAt ? `Last synced ${timeAgo(state.lastSyncedAt)}` : '')}{state?.pending ? ` · ${state.pending} changes waiting` : ''}</span>
        </div>
      </form>
    </section>
  );
}

function AiSection() {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [key, setKey] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    void api.getAiConfig().then(setCfg);
  }, []);
  if (!cfg) return null;
  const save = async (): Promise<void> => {
    try {
      setCfg(await api.setAiConfig({ provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl, apiKey: key || undefined }));
      setKey('');
      setNote('Saved');
    } catch (err) {
      toast(errorMessage(err));
    }
  };
  return (
    <section aria-label="AI">
      <h3>AI</h3>
      <p className="hint">Chat, summaries and mind maps call the model you configure here directly from this device. Your key is stored locally and never leaves the main process.</p>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="field">
          <span>Provider</span>
          <select value={cfg.provider} onChange={(e) => setCfg({ ...cfg, provider: e.target.value as AiConfig['provider'], baseUrl: '' })}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI-compatible</option>
          </select>
        </label>
        <label className="field"><span>Model</span><input value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} placeholder={cfg.provider === 'anthropic' ? 'claude-sonnet-5-5' : 'gpt-4.1'} /></label>
        <label className="field"><span>Base URL</span><input value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} placeholder={cfg.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'} /></label>
        <label className="field"><span>API key</span><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={cfg.hasKey ? '•••••• (saved)' : 'sk-…'} autoComplete="off" /></label>
        <div className="row"><button className="btn primary" type="submit">Save</button><span className="hint">{note}</span></div>
      </form>
    </section>
  );
}

function ExportSection() {
  const [busy, setBusy] = useState(false);
  const run = async (format: 'markdown' | 'json'): Promise<void> => {
    setBusy(true);
    try {
      const { name, mime, text } = await api.exportAll(format);
      const url = URL.createObjectURL(new Blob([text], { type: mime }));
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Export">
      <h3>Export</h3>
      <p className="hint">Take your notes with you. Markdown keeps cards as readable text with [[links]]; JSON is a lossless dump.</p>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => void run('markdown')}>Export Markdown</button>
        <button className="btn" disabled={busy} onClick={() => void run('json')}>Export JSON</button>
      </div>
    </section>
  );
}
