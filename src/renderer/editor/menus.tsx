import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SlashItem } from './commands.js';
import { editorEnv } from './env.js';
import type { SuggestState } from './plugins.js';

export interface MenuHandle {
  key(event: KeyboardEvent): boolean;
}

/** Positions a menu under the caret, flipping above it near the bottom of the window. */
function Floating({ rect, children, label }: { rect: SuggestState['rect']; children: React.ReactNode; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: rect.left, top: rect.bottom + 6 });
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 0;
    const w = box.current?.offsetWidth ?? 0;
    const top = rect.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 6) : rect.bottom + 6;
    setPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)), top });
  }, [rect.left, rect.bottom, rect.top, children]);
  return createPortal(
    <div className="menu" role="listbox" aria-label={label} ref={box} style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  );
}

/** Shared arrow-key / enter handling for both menus. */
function useListNav(count: number, pick: (index: number) => void): [number, (e: KeyboardEvent) => boolean, (i: number) => void] {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
  }, [count]);
  const key = (e: KeyboardEvent): boolean => {
    if (!count) return false;
    if (e.key === 'ArrowDown') setIndex((i) => (i + 1) % count);
    else if (e.key === 'ArrowUp') setIndex((i) => (i - 1 + count) % count);
    else if (e.key === 'Enter' || e.key === 'Tab') pick(Math.min(index, count - 1));
    else return false;
    e.preventDefault();
    return true;
  };
  return [index, key, setIndex];
}

export const SlashMenu = forwardRef<MenuHandle, { state: SuggestState; items: SlashItem[]; onPick(item: SlashItem): void }>(function SlashMenu({ state, items, onPick }, ref) {
  const [index, key, setIndex] = useListNav(items.length, (i) => onPick(items[i]!));
  useImperativeHandle(ref, () => ({ key }));
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  if (!items.length) return null;
  return (
    <Floating rect={state.rect} label="Insert block">
      {items.map((item, i) => (
        <button key={item.id} ref={i === index ? active : undefined} role="option" aria-selected={i === index} className={`menu-item${i === index ? ' active' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => onPick(item)}>
          <span className="menu-icon">{item.icon}</span>
          <span className="menu-text">
            <strong>{item.title}</strong>
            <small>{item.hint}</small>
          </span>
        </button>
      ))}
    </Floating>
  );
});

interface Candidate {
  id: string;
  title: string;
}

export const MentionMenu = forwardRef<MenuHandle, { state: SuggestState; onPick(id: string, title: string): void; onCreate(title: string): void }>(function MentionMenu({ state, onPick, onCreate }, ref) {
  const [found, setFound] = useState<Candidate[]>([]);
  const query = state.query.trim();
  useEffect(() => {
    let current = true;
    void editorEnv.searchCards(query).then((r) => current && setFound(r.slice(0, 8)));
    return () => {
      current = false;
    };
  }, [query]);
  const exact = found.some((c) => c.title.toLowerCase() === query.toLowerCase());
  const rows: ({ create: true; title: string } | (Candidate & { create?: false }))[] = [...found, ...(query && !exact ? [{ create: true as const, title: query }] : [])];
  const choose = (i: number): void => {
    const row = rows[i];
    if (!row) return;
    if (row.create) onCreate(row.title);
    else onPick(row.id, row.title);
  };
  const [index, key, setIndex] = useListNav(rows.length, choose);
  useImperativeHandle(ref, () => ({ key }));
  if (!rows.length) return null;
  return (
    <Floating rect={state.rect} label="Link a card">
      {rows.map((row, i) => (
        <button key={row.create ? '__create' : row.id} role="option" aria-selected={i === index} className={`menu-item${i === index ? ' active' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => choose(i)}>
          <span className="menu-icon">{row.create ? '＋' : '@'}</span>
          <span className="menu-text">
            <strong>{row.create ? `Create “${row.title}”` : row.title || 'Untitled'}</strong>
            {row.create && <small>New card, linked here</small>}
          </span>
        </button>
      ))}
    </Floating>
  );
});
