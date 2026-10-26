import { useEffect, useState } from 'react';
import type { LinkView } from '../../../core/work.js';
import { api, errorMessage, fileUrl } from '../../api.js';
import { openCard, trashCard } from '../../actions.js';
import { isFileId } from '../../../core/fileid.js';
import { refresh, toast, useData } from '../../store/data.js';
import { Icon } from '../Icon.js';
import { menuFor } from '../ui/ContextMenu.js';
import { Empty, useDebounced } from '../ui/bits.js';

/** Saves a link from the app, the palette or the menu: fetches the title, description and image, then tags it. */
export async function saveLinkFrom(url: string, note = ''): Promise<{ id: string; existed: boolean } | undefined> {
  try {
    const res = await api.saveLink(url, { note: note.trim() || undefined });
    await refresh();
    if (res.existed) toast('Already saved — added your note to the existing link.');
    else if (res.fetchError) toast(`Saved, but the page could not be read: ${res.fetchError}`);
    return res;
  } catch (err) {
    toast(errorMessage(err));
    return undefined;
  }
}

/** Saved links as a searchable grid of previews. */
export function LinksApp() {
  const version = useData((s) => s.version);
  const [links, setLinks] = useState<LinkView[]>([]);
  const [text, setText] = useState('');
  const [tag, setTag] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useDebounced(text);

  useEffect(() => {
    let live = true;
    void api.listLinks({ query: q.trim() || undefined, tag: tag || undefined }).then((l) => live && setLinks(l));
    return () => {
      live = false;
    };
  }, [q, tag, version]);

  const [allTags, setAllTags] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void api.listLinks({}).then((l) => live && setAllTags([...new Set(l.flatMap((x) => x.tags))].sort()));
    return () => {
      live = false;
    };
  }, [version]);

  const add = async (): Promise<void> => {
    if (!url.trim() || busy) return;
    setBusy(true);
    const res = await saveLinkFrom(url, note);
    setBusy(false);
    if (res) {
      setUrl('');
      setNote('');
    }
  };

  return (
    <div className="page wide links-app">
      <div className="page-head"><h2 className="grow">Links</h2></div>
      <form className="link-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link to save…" aria-label="Link address" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it matters (optional)" aria-label="Note about the link" />
        <button className="btn primary" type="submit" disabled={!url.trim() || busy}>{busy ? 'Saving…' : 'Save link'}</button>
      </form>
      <div className="filters">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search saved links…" aria-label="Search links" />
        <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter links by tag">
          <option value="">All tags</option>
          {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
        </select>
      </div>
      {links.length === 0 ? (
        <Empty title={text || tag ? 'No links match' : 'No saved links yet'}>{text || tag ? 'Try different words.' : 'Paste an address above. Loom reads the title, description and image, and suggests tags.'}</Empty>
      ) : (
        <ul className="link-grid">
          {links.map((l) => <LinkCard key={l.id} link={l} />)}
        </ul>
      )}
    </div>
  );
}

function LinkCard({ link }: { link: LinkView }) {
  return (
    <li
      className="link-card"
      onContextMenu={menuFor(() => [
        { label: 'Open details', onClick: () => openCard(link.id) },
        { label: 'Open original', onClick: () => window.open(link.url, '_blank', 'noopener,noreferrer') },
        { separator: true, label: '' },
        { label: 'Move to trash', danger: true, onClick: () => void trashCard(link.id) },
      ])}
    >
      {isFileId(link.fileId) && <img className="link-thumb" src={fileUrl(link.fileId)} alt="" loading="lazy" />}
      <div className="link-body">
        <button className="link-title" onClick={(e) => openCard(link.id, e.metaKey || e.ctrlKey)}>{link.title}</button>
        <a className="link-host" href={link.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${link.host}`}><Icon name="globe" size={12} /> {link.host}</a>
        {link.description && <p className="link-desc">{link.description}</p>}
        {link.note && <p className="link-note">{link.note}</p>}
        {link.tags.length > 0 && <div className="task-meta">{link.tags.map((t) => <em key={t} className="label">#{t}</em>)}</div>}
      </div>
    </li>
  );
}

