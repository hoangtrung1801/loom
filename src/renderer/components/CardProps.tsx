import { useEffect, useState } from 'react';
import type { CardPropGroup } from '../../core/tagdb.js';
import { api, errorMessage } from '../api.js';
import { openTag } from '../actions.js';
import { toast, useData } from '../store/data.js';

/** Values of the properties defined by a card's tags (the "properties" of Heptabase's tag databases). */
export function CardProps({ cardId }: { cardId: string }) {
  const version = useData((s) => s.version);
  const [groups, setGroups] = useState<CardPropGroup[]>([]);
  useEffect(() => {
    let live = true;
    void api.getCardProps(cardId).then((g) => live && setGroups(g));
    return () => {
      live = false;
    };
  }, [cardId, version]);

  const set = async (propId: string, value: string): Promise<void> => {
    try {
      await api.setCardProp(cardId, propId, value);
      setGroups(await api.getCardProps(cardId));
    } catch (err) {
      toast(errorMessage(err));
    }
  };
  if (!groups.length) return null;
  return (
    <div className="props" aria-label="Properties">
      {groups.map((g) => (
        <div key={g.tag} className="prop-group">
          <button className="link" onClick={() => openTag(g.tag)}>#{g.tag}</button>
          {g.props.map((p) => (
            <label key={p.id} className="prop">
              <span>{p.name}</span>
              <PropInput type={p.type} options={p.options} value={p.value} onCommit={(v) => void set(p.id, v)} />
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

export function PropInput({ type, options, value, onCommit }: { type: string; options: string[]; value: string; onCommit(value: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (v: string): void => {
    if (v !== value) onCommit(v);
  };
  switch (type) {
    case 'checkbox':
      return <input type="checkbox" checked={value === '1'} onChange={(e) => onCommit(e.target.checked ? '1' : '')} />;
    case 'select':
      return (
        <select value={value} onChange={(e) => onCommit(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => <option key={o}>{o}</option>)}
        </select>
      );
    case 'multiselect': {
      const picked: string[] = value ? (JSON.parse(value) as string[]) : [];
      return (
        <span className="multi">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              className={`pill${picked.includes(o) ? ' on' : ''}`}
              aria-pressed={picked.includes(o)}
              onClick={() => onCommit(JSON.stringify(picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o]))}
            >
              {o}
            </button>
          ))}
        </span>
      );
    }
    default:
      return (
        <input
          type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
          value={draft}
          placeholder={type === 'url' ? 'https://' : ''}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      );
  }
}
