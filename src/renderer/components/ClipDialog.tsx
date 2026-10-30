import { useEffect, useRef, useState } from 'react';
import { openCard } from '../actions.js';
import { api, errorMessage } from '../api.js';
import { parseWebUrl } from '../../core/url.js';
import { refresh, toast } from '../store/data.js';
import { useUi } from '../store/ui.js';
import { Icon } from './Icon.js';



/**
 * "Save a link" keeps a bookmark with a preview (title, description, image) and suggested tags;
 * "Clip a web page" keeps the readable text as a card. Both only fetch public http(s) addresses.
 */
export function ClipDialog() {
  const open = useUi((s) => s.clipOpen);
  const mode = useUi((s) => s.clipMode);
  const setOpen = useUi((s) => s.setClip);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open, mode]);
  if (!open) return null;
  const close = (): void => {
    setOpen(false);
    setError('');
  };
  const submit = async (): Promise<void> => {
    const target = url.trim();
    if (!target || busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'link') {
        const res = await api.saveLink(target, { note: note.trim() || undefined });
        await refresh();
        if (res.existed) toast('Already saved — your note was added to the existing link.');
        else if (res.fetchError) toast(`Saved, but the page could not be read: ${res.fetchError}`);
        setUrl('');
        setNote('');
        close();
        openCard(res.id);
      } else {
        const id = await api.clipWebPage(parseWebUrl(target).href);
        await refresh();
        setUrl('');
        close();
        if (id) openCard(id);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const link = mode === 'link';
  const label = link ? 'Save a link' : 'Clip a web page';
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form className="dialog form-dialog" role="dialog" aria-label={label} onSubmit={(e) => { e.preventDefault(); void submit(); }} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h2><Icon name={link ? 'link' : 'globe'} /> {label}</h2>
        <div className="seg" role="group" aria-label="What to keep">
          <button type="button" className={`pill${link ? ' on' : ''}`} aria-pressed={link} onClick={() => setOpen(true, 'link')}>Save link</button>
          <button type="button" className={`pill${!link ? ' on' : ''}`} aria-pressed={!link} onClick={() => setOpen(true, 'page')}>Clip page text</button>
        </div>
        <p className="hint">
          {link
            ? 'Keeps the address with its title, description and image, and suggests tags when AI is set up. Saving the same page twice updates the first one.'
            : 'Saves the readable text of a public page as a card in your inbox, with a link to the original.'}
        </p>
        <input ref={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/article" aria-label="Web address" />
        {link && <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it matters (optional)" aria-label="Note" />}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row"><button className="btn" type="button" onClick={close}>Cancel</button><button className="btn primary" type="submit" disabled={!url.trim() || busy}>{busy ? 'Working…' : link ? 'Save link' : 'Clip page'}</button></div>
      </form>
    </div>
  );
}
