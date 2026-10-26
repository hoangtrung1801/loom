import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { openBoard } from '../../actions.js';
import type { Tab } from '../../store/tabs.js';
import { useData } from '../../store/data.js';
import { useCardDetail } from '../../store/edits.js';
import { Empty } from '../ui/bits.js';

/** Card: headings that scroll the editor. Whiteboard: its sections, which focus the board on them. */
export function TocPanel({ tab }: { tab: Tab }) {
  return tab.type === 'card' ? <CardToc id={tab.ref} /> : <BoardToc id={tab.ref} />;
}

function CardToc({ id }: { id: string }) {
  const { card } = useCardDetail(id);
  const headings = card?.headings ?? [];
  if (!headings.length) return <div className="panel"><Empty title="No headings">Use # at the start of a line to add one.</Empty></div>;
  const min = Math.min(...headings.map((h) => h.level));
  return (
    <nav className="panel toc" aria-label="Table of contents">
      {headings.map((h) => (
        <button key={h.blockId} style={{ paddingLeft: 8 + (h.level - min) * 14 }} onClick={() => window.dispatchEvent(new CustomEvent('loom:scroll-block', { detail: h.blockId }))}>
          {h.text || 'Untitled heading'}
        </button>
      ))}
    </nav>
  );
}

function BoardToc({ id }: { id: string }) {
  const version = useData((s) => s.version);
  const [sections, setSections] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    let live = true;
    void api.getWhiteboard(id).then((b) => live && setSections((b?.placements ?? []).filter((p) => p.kind === 'section').map((p) => ({ id: p.id, title: p.title || p.text }))));
    return () => {
      live = false;
    };
  }, [id, version]);
  if (!sections.length) return <div className="panel"><Empty title="No sections">Add a section from the toolbar to outline the board.</Empty></div>;
  return (
    <nav className="panel toc" aria-label="Sections">
      {sections.map((s) => <button key={s.id} onClick={() => openBoard(id, s.id)}>{s.title || 'Untitled section'}</button>)}
    </nav>
  );
}
