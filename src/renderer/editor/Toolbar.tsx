import { useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { applyLink, currentBlock, currentLink, markActive, toggle, turnInto, type BlockChoice } from './commands.js';

const BLOCKS: [BlockChoice, string][] = [
  ['paragraph', 'Text'],
  ['h1', 'Heading 1'],
  ['h2', 'Heading 2'],
  ['h3', 'Heading 3'],
  ['bullet', 'Bulleted list'],
  ['ordered', 'Numbered list'],
  ['todo', 'To-do list'],
  ['quote', 'Quote'],
];

/** Floating formatting bar shown above a non-empty text selection. */
export function Toolbar({ view }: { view: EditorView }) {
  const bar = useRef<HTMLDivElement>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const { selection } = view.state;
  const visible = !selection.empty && selection.$from.parent.isTextblock && !selection.$from.parent.type.spec.code && view.hasFocus() || linking !== null;

  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!visible) return setPos(null);
    const a = view.coordsAtPos(selection.from);
    const b = view.coordsAtPos(selection.to);
    const w = bar.current?.offsetWidth ?? 320;
    const h = bar.current?.offsetHeight ?? 36;
    const left = Math.max(8, Math.min((a.left + b.right) / 2 - w / 2, window.innerWidth - w - 8));
    const top = a.top - h - 8 < 8 ? b.bottom + 8 : a.top - h - 8;
    setPos({ left, top });
  });
  useEffect(() => {
    if (selection.empty) setLinking(null);
  }, [selection.empty]);

  if (!visible) return null;
  const btn = (label: string, title: string, name: string, attrs?: Record<string, unknown>) => (
    <button key={name} className={markActive(view, name) ? 'on' : ''} title={title} aria-label={title} aria-pressed={markActive(view, name)} onClick={() => toggle(view, name, attrs)}>
      {label}
    </button>
  );
  return (
    <div className="toolbar" ref={bar} role="toolbar" aria-label="Format" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }} onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault(); }}>
      {linking === null ? (
        <>
          <select aria-label="Turn into" value={currentBlock(view)} onChange={(e) => turnInto(view, e.target.value as BlockChoice)} onMouseDown={(e) => e.stopPropagation()}>
            {BLOCKS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {btn('B', 'Bold (Ctrl/⌘ B)', 'strong')}
          {btn('I', 'Italic (Ctrl/⌘ I)', 'em')}
          {btn('U', 'Underline (Ctrl/⌘ U)', 'underline')}
          {btn('S', 'Strikethrough', 'strike')}
          {btn('</>', 'Code (Ctrl/⌘ E)', 'code')}
          {btn('▍', 'Highlight', 'highlight', { color: 'yellow' })}
          <button className={markActive(view, 'link') ? 'on' : ''} title="Link" aria-label="Link" onClick={() => setLinking(currentLink(view))}>🔗</button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            applyLink(view, linking);
            setLinking(null);
          }}
        >
          <input autoFocus value={linking} onChange={(e) => setLinking(e.target.value)} placeholder="Paste a link, Enter to apply" aria-label="Link address" onKeyDown={(e) => { if (e.key === 'Escape') { setLinking(null); view.focus(); } }} />
        </form>
      )}
    </div>
  );
}
