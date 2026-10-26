import { useMemo, useState } from 'react';
import { openTag } from '../../actions.js';
import { api } from '../../api.js';
import { mutate, useData } from '../../store/data.js';
import { Empty } from '../ui/bits.js';

/** Every tag, grouped by collection. Tags are created by tagging a card; this is where you organise them. */
export function TagDatabase() {
  const tags = useData((s) => s.tags);
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const by = new Map<string, typeof tags>();
    for (const t of tags) {
      if (needle && !t.tag.includes(needle)) continue;
      by.set(t.collection, [...(by.get(t.collection) ?? []), t]);
    }
    return [...by.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [tags, filter]);

  return (
    <div className="page">
      <div className="page-head">
        <h2 className="grow">Tag Database</h2>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tags…" aria-label="Filter tags" />
      </div>
      {groups.length === 0 ? (
        <Empty title="No tags yet">Add a #tag to any card and it appears here.</Empty>
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
                    defaultValue={t.collection}
                    placeholder="Collection"
                    aria-label={`Collection of ${t.tag}`}
                    onBlur={(e) => e.target.value.trim() !== t.collection && void mutate(() => api.setTagDef(t.tag, { collection: e.target.value }))}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
