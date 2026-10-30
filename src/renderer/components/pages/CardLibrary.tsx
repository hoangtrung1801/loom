import { useEffect, useMemo, useState } from 'react';
import type { CardKind, CardSummary } from '../../../core/store.js';
import { CARD_KINDS } from '../../../core/kinds.js';
import { api } from '../../api.js';
import { importFiles, newCard } from '../../actions.js';
import { pickFiles } from '../../editor/commands.js';
import { useData } from '../../store/data.js';
import { Icon } from '../Icon.js';
import { CardRow, Empty, useDebounced } from '../ui/bits.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

const SORTS = [
  { id: 'updated', label: 'Last edited' },
  { id: 'created', label: 'Created' },
  { id: 'title', label: 'Title' },
] as const;

/** Every card, filterable by kind and tag. The same list backs the Card Library side panel. */
export function CardLibrary() {
  const version = useData((s) => s.version);
  const tags = useData((s) => s.tags);
  const [kinds, setKinds] = useState<CardKind[]>([]);
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('updated');
  const [filter, setFilter] = useState('');
  const [cards, setCards] = useState<CardSummary[]>([]);
  const q = useDebounced(filter);

  useEffect(() => {
    let live = true;
    void api.listCards({ kinds: kinds.length ? kinds : undefined, tag: tag || undefined, sort, limit: 1000 }).then((c) => live && setCards(c));
    return () => {
      live = false;
    };
  }, [kinds, tag, sort, version]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? cards.filter((c) => `${c.title} ${c.preview}`.toLowerCase().includes(needle)) : cards;
  }, [cards, q]);

  const toggleKind = (k: CardKind): void => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  return (
    <div className="page">
      <div className="page-head">
        <h2 className="grow">Card Library</h2>
        <Button variant="outline" onClick={() => void pickFiles('*/*', true).then((files) => importFiles(files))}><Icon name="upload" size={14} /> Import files</Button>
        <Button onClick={() => void newCard()}><Icon name="plus" size={14} /> New card</Button>
      </div>
      <div className="filters">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter cards…" aria-label="Filter cards" />
        <NativeSelect value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
          <NativeSelectOption value="">All tags</NativeSelectOption>
          {tags.map((t) => <NativeSelectOption key={t.tag} value={t.tag}>#{t.tag} ({t.count})</NativeSelectOption>)}
        </NativeSelect>
        <NativeSelect value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort cards">
          {SORTS.map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.label}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="kind-filter" role="group" aria-label="Card types">
        {CARD_KINDS.map((k) => (
          <button key={k} className={`pill${kinds.includes(k) ? ' on' : ''}`} aria-pressed={kinds.includes(k)} onClick={() => toggleKind(k)}>{k}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <Empty title="No cards match">Change the filters or create a card.</Empty>
      ) : (
        <ul className="card-list" aria-label="Cards">
          {shown.map((c) => <CardRow key={c.id} card={c} />)}
        </ul>
      )}
    </div>
  );
}
