import { useEffect, useState } from 'react';
import type { PropType, TagTable } from '../../../core/tagdb.js';
import { PROP_TYPES } from '../../../core/kinds.js';
import { api } from '../../api.js';
import { openCard } from '../../actions.js';
import { mutate, toast, useData } from '../../store/data.js';
import { errorMessage } from '../../api.js';
import { PropInput } from '../CardProps.js';
import { Icon } from '../Icon.js';
import { Empty, timeAgo } from '../ui/bits.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

const COLORS = ['', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'];

/** One tag as a database: a table of the tagged cards with a column per property. */
export function TagPage({ tag }: { tag: string }) {
  const version = useData((s) => s.version);
  const [table, setTable] = useState<TagTable | null>(null);
  const [sortBy, setSortBy] = useState('');
  const [newProp, setNewProp] = useState({ name: '', type: 'text' as PropType });

  useEffect(() => {
    let live = true;
    void api.getTagTable(tag).then((t) => live && setTable(t));
    return () => {
      live = false;
    };
  }, [tag, version]);

  if (!table) return <div className="loading">Loading…</div>;

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      toast(errorMessage(err));
    }
    await mutate(async () => undefined);
  };

  const rows = [...table.rows].sort((a, b) => {
    if (!sortBy) return b.updatedAt - a.updatedAt;
    if (sortBy === 'title') return a.title.localeCompare(b.title);
    return (a.values[sortBy] ?? '').localeCompare(b.values[sortBy] ?? '', undefined, { numeric: true });
  });

  return (
    <div className="page tag-page">
      <div className="page-head">
        <h2 className="grow">#{tag}</h2>
        <NativeSelect value={table.color} onChange={(e) => void run(() => api.setTagDef(tag, { color: e.target.value }))} aria-label="Tag color">
          {COLORS.map((c) => <NativeSelectOption key={c} value={c}>{c || 'no color'}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <textarea
        className="tag-desc"
        defaultValue={table.description}
        placeholder="Describe this tag…"
        aria-label="Tag description"
        onBlur={(e) => e.target.value !== table.description && void run(() => api.setTagDef(tag, { description: e.target.value }))}
      />
      {rows.length === 0 ? (
        <Empty title="No cards have this tag">Add #{tag} to a card to see it here.</Empty>
      ) : (
        <table className="db-table" aria-label={`Cards tagged ${tag}`}>
          <thead>
            <tr>
              <th><button onClick={() => setSortBy('title')}>Title</button></th>
              {table.props.map((p) => (
                <th key={p.id}>
                  <button onClick={() => setSortBy(p.id)}>{p.name}</button>
                  <Button variant="ghost" size="icon" aria-label={`Remove property ${p.name}`} onClick={() => void run(() => api.removeTagProp(p.id))}><Icon name="close" size={11} /></Button>
                </th>
              ))}
              <th><button onClick={() => setSortBy('')}>Edited</button></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cardId}>
                <td><button className="link" onClick={() => openCard(r.cardId)}>{r.title || 'Untitled'}</button></td>
                {table.props.map((p) => (
                  <td key={p.id}>
                    <PropInput type={p.type} options={p.options} value={r.values[p.id] ?? ''} onCommit={(v) => void run(() => api.setCardProp(r.cardId, p.id, v))} />
                  </td>
                ))}
                <td>{timeAgo(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        className="add-prop"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newProp.name.trim()) return;
          void run(() => api.addTagProp(tag, { name: newProp.name.trim(), type: newProp.type, options: newProp.type.includes('select') ? ['Option 1', 'Option 2'] : undefined }));
          setNewProp({ name: '', type: 'text' });
        }}
      >
        <Input value={newProp.name} onChange={(e) => setNewProp({ ...newProp, name: e.target.value })} placeholder="New property" aria-label="New property name" />
        <NativeSelect value={newProp.type} onChange={(e) => setNewProp({ ...newProp, type: e.target.value as PropType })} aria-label="Property type">
          {PROP_TYPES.map((t) => <NativeSelectOption key={t}>{t}</NativeSelectOption>)}
        </NativeSelect>
        <Button variant="outline" type="submit">Add property</Button>
      </form>
      {table.props.some((p) => p.type.includes('select')) && (
        <details>
          <summary>Edit select options</summary>
          {table.props.filter((p) => p.type.includes('select')).map((p) => (
            <label key={p.id} className="prop">
              <span>{p.name}</span>
              <Input
                defaultValue={p.options.join(', ')}
                aria-label={`Options for ${p.name}`}
                onBlur={(e) => void run(() => api.updateTagProp(p.id, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))}
              />
            </label>
          ))}
        </details>
      )}
    </div>
  );
}
