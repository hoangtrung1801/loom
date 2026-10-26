import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlacementView } from '../../../core/store.js';
import { Icon } from '../Icon.js';

export function matchText(p: PlacementView): string {
  return `${p.title} ${p.text} ${p.kind === 'card' ? p.content.replace(/"text":"([^"]*)"/g, ' $1 ') : ''}`.toLowerCase();
}

/** Find-in-whiteboard: highlights matches, Enter jumps to the next one. */
export function BoardSearch({ placements, onMatches, onJump, onClose }: { placements: PlacementView[]; onMatches(ids: Set<string> | null): void; onJump(p: PlacementView): void; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? placements.filter((p) => p.kind !== 'section' || p.text.toLowerCase().includes(q)).filter((p) => matchText(p).includes(q)) : [];
  }, [placements, query]);
  useEffect(() => {
    onMatches(query.trim() ? new Set(found.map((p) => p.id)) : null);
    setAt(0);
    return () => onMatches(null);
    // onMatches is a stable setter from the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, query]);

  const step = (by: number): void => {
    if (!found.length) return;
    const next = (at + by + found.length) % found.length;
    setAt(next);
    onJump(found[next]!);
  };
  return (
    <div className="board-search" role="search" onPointerDown={(e) => e.stopPropagation()}>
      <Icon name="search" size={14} />
      <input
        ref={input}
        value={query}
        placeholder="Search this whiteboard"
        aria-label="Search this whiteboard"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
          e.stopPropagation();
        }}
      />
      <span className="count">{query.trim() ? `${found.length ? at + 1 : 0}/${found.length}` : ''}</span>
      <button className="icon-btn" aria-label="Previous match" onClick={() => step(-1)}><Icon name="chevronDown" className="up" size={14} /></button>
      <button className="icon-btn" aria-label="Next match" onClick={() => step(1)}><Icon name="chevronDown" size={14} /></button>
      <button className="icon-btn" aria-label="Close search" onClick={onClose}><Icon name="close" size={14} /></button>
    </div>
  );
}
