import { useMemo, useState } from 'react';
import { openTag } from '../../actions.js';
import { api } from '../../api.js';
import { errorMessage } from '../../api.js';
import { mutate, toast, useData } from '../../store/data.js';
import { Empty } from '../ui/bits.js';

const COLORS = ['', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'];

/** Every tag, grouped by collection. Create tags here (or by tagging a card) and edit their name, color and collection. */
export function TagDatabase() {
  const tags = useData((s) => s.tags);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState({ name: '', collection: '' });
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const by = new Map<string, typeof tags>();
    for (const t of tags) {
      if (needle && !t.tag.includes(needle)) continue;
      by.set(t.collection, [...(by.get(t.collection) ?? []), t]);
    }
    return [...by.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [tags, filter]);

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await mutate(fn);
      return true;
    } catch (err) {
      toast(errorMessage(err));
      return false;
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2 className="grow">Tag Database</h2>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tags…" aria-label="Filter tags" />
      </div>
      <form
        className="add-prop"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.name.trim()) return;
          const { name, collection } = draft;
          void run(() => api.setTagDef(name, { collection })).then((ok) => ok && setDraft({ name: '', collection: '' }));
        }}
      >
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="New tag" aria-label="New tag name" />
        <input value={draft.collection} onChange={(e) => setDraft({ ...draft, collection: e.target.value })} placeholder="Collection (optional)" aria-label="New tag collection" />
        <button className="btn" type="submit">Create tag</button>
      </form>
      {groups.length === 0 ? (
        <Empty title={filter.trim() ? 'No matching tags' : 'No tags yet'}>{filter.trim() ? 'Try a different filter.' : 'Create a tag above, or add a #tag to any card.'}</Empty>
      ) : (
        groups.map(([collection, list]) => (
          <section key={collection} aria-label={collection || 'Uncollected'}>
            <h3>{collection || 'No collection'}</h3>
            <ul className="tag-grid">
              {list.map((t) => (
                <li key={t.tag}>
                  <button className="tag-card" onClick={() => openTag(t.tag)}>
                    <i className={`dot c-${t.color || 'gray'}`} />
                    <strong>#{t.tag}</strong>
                    <span>{t.count} {t.count === 1 ? 'card' : 'cards'}</span>
                  </button>
                  <input
                    className="collection-input"
                    key={`name:${t.tag}`}
                    defaultValue={t.tag}
                    aria-label={`Name of ${t.tag}`}
                    onBlur={(e) => {
                      const next = e.target.value.trim().replace(/^#/, '');
                      if (next && next !== t.tag) void run(() => api.renameTag(t.tag, next));
                      else e.target.value = t.tag;
                    }}
                  />
                  <input
                    className="collection-input"
                    key={`collection:${t.tag}:${t.collection}`}
                    defaultValue={t.collection}
                    placeholder="Collection"
                    aria-label={`Collection of ${t.tag}`}
                    onBlur={(e) => e.target.value.trim() !== t.collection && void run(() => api.setTagDef(t.tag, { collection: e.target.value }))}
                  />
                  <div className="tag-actions">
                    <select value={t.color} onChange={(e) => void run(() => api.setTagDef(t.tag, { color: e.target.value }))} aria-label={`Color of ${t.tag}`}>
                      {COLORS.map((c) => <option key={c} value={c}>{c || 'no color'}</option>)}
                    </select>
                    <button
                      className="btn"
                      aria-label={`Delete ${t.tag}`}
                      onClick={() => window.confirm(`Delete #${t.tag}? It is removed from ${t.count} ${t.count === 1 ? 'card' : 'cards'}; the cards stay.`) && void run(() => api.deleteTag(t.tag))}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
