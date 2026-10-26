import { useState } from 'react';
import { openTag } from '../actions.js';
import { api } from '../api.js';
import { mutate, useData } from '../store/data.js';
import { Icon } from './Icon.js';

/** Tag chips for one card with an add field that suggests existing tags. */
export function TagEditor({ cardId, tags }: { cardId: string; tags: string[] }) {
  const all = useData((s) => s.tags);
  const [draft, setDraft] = useState('');
  const listId = `tags-${cardId}`;
  const add = (): void => {
    const value = draft.trim();
    setDraft('');
    if (value) void mutate(() => api.addTag(cardId, value));
  };
  return (
    <div className="chips" aria-label="Tags">
      {tags.map((t) => (
        <span className="chip" key={t}>
          <button className="chip-label" onClick={() => openTag(t)} title={`Open #${t}`}>#{t}</button>
          <button aria-label={`Remove tag ${t}`} onClick={() => void mutate(() => api.removeTag(cardId, t))}><Icon name="close" size={11} /></button>
        </span>
      ))}
      <form onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={draft} list={listId} onChange={(e) => setDraft(e.target.value)} placeholder="Add tag" aria-label="Add tag" />
        <datalist id={listId}>{all.filter((t) => !tags.includes(t.tag)).map((t) => <option key={t.tag} value={t.tag} />)}</datalist>
      </form>
    </div>
  );
}
