import { useEffect, useRef, useState } from 'react';
import { openCard } from '../actions.js';
import { api, errorMessage } from '../api.js';
import { refresh } from '../store/data.js';
import { useUi } from '../store/ui.js';
import { Icon } from './Icon.js';

/** "Clip a web page": saves the readable text of a public page as a web card, with a link back to the source. */
export function ClipDialog() {
  const open = useUi((s) => s.clipOpen);
  const setOpen = useUi((s) => s.setClip);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  if (!open) return null;
  const close = (): void => {
    setOpen(false);
    setError('');
  };
  const clip = async (): Promise<void> => {
    const target = url.trim();
    if (!target || busy) return;
    setBusy(true);
    setError('');
    try {
      const id = await api.clipWebPage(/^[a-z][a-z0-9+.-]*:/i.test(target) ? target : `https://${target}`);
      await refresh();
      setUrl('');
      close();
      if (id) openCard(id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form className="dialog research" role="dialog" aria-label="Clip a web page" onSubmit={(e) => { e.preventDefault(); void clip(); }} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h2><Icon name="globe" /> Clip a web page</h2>
        <p className="hint">Saves the readable text of a public page as a card in your inbox, with a link to the original.</p>
        <input ref={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/article" aria-label="Web address" />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row"><button className="btn" type="button" onClick={close}>Cancel</button><button className="btn primary" type="submit" disabled={!url.trim() || busy}>{busy ? 'Clipping…' : 'Clip page'}</button></div>
      </form>
    </div>
  );
}
