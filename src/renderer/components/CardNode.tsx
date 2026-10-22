import { memo, useCallback } from 'react';
import type { PlacementView } from '../../core/store.js';
import { useApp } from '../state.js';
import { Editor } from './Editor.js';

interface Props {
  placement: PlacementView;
  selected: boolean;
  zoom: number;
  onStartConnect(placementId: string, event: React.PointerEvent): void;
}

/** Tracks a pointer drag in screen space until release; `onMove` receives the delta in board units. */
function trackDrag(event: React.PointerEvent, zoom: number, onMove: (dx: number, dy: number) => void, onEnd: (moved: boolean) => void): void {
  const sx = event.clientX;
  const sy = event.clientY;
  let moved = false;
  const move = (e: PointerEvent): void => {
    const dx = (e.clientX - sx) / zoom;
    const dy = (e.clientY - sy) / zoom;
    if (!moved && Math.hypot(dx, dy) * zoom < 3) return;
    if (!moved) window.getSelection()?.removeAllRanges(); // dragging from the title shouldn't select text
    moved = true;
    onMove(dx, dy);
  };
  const up = (): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onEnd(moved);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

export const CardNode = memo(function CardNode({ placement: p, selected, zoom, onStartConnect }: Props) {
  const editCard = useApp((s) => s.editCard);
  const openCard = useApp((s) => s.openCard);
  const openByTitle = useApp((s) => s.openByTitle);

  const onContent = useCallback((json: string) => editCard(p.cardId, { content: json }), [editCard, p.cardId]);

  const onSelect = (event: React.PointerEvent): void => {
    const st = useApp.getState();
    if (event.shiftKey) st.select([p.id], true);
    else if (!st.selection.includes(p.id)) st.select([p.id]);
    st.bringToFront(p.id);
  };

  const removeFromBoard = (): void => {
    const st = useApp.getState();
    st.select([p.id]);
    void st.removeSelected();
  };

  const startMove = (event: React.PointerEvent): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const st = useApp.getState();
    const ids = st.selection.includes(p.id) ? st.selection : [p.id];
    const origin = new Map((st.board?.placements ?? []).filter((q) => ids.includes(q.id)).map((q) => [q.id, { x: q.x, y: q.y }]));
    trackDrag(
      event,
      zoom,
      (dx, dy) => st.moveLocal([...origin].map(([id, o]) => ({ id, x: o.x + dx, y: o.y + dy }))),
      (moved) => moved && void st.commitPlacements(ids),
    );
  };

  const startResize = (event: React.PointerEvent): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const st = useApp.getState();
    const { w, h } = p;
    trackDrag(
      event,
      zoom,
      (dx, dy) => st.moveLocal([{ id: p.id, w: Math.max(160, w + dx), h: Math.max(100, h + dy) }]),
      (moved) => moved && void st.commitPlacements([p.id]),
    );
  };

  return (
    <div
      className={`node${selected ? ' selected' : ''}`}
      data-pid={p.id}
      style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: p.w, height: p.h, zIndex: p.z }}
      onPointerDownCapture={onSelect}
    >
      <div className="node-head" onPointerDown={startMove}>
        <input
          className="node-title"
          value={p.title}
          placeholder="Untitled"
          aria-label="Card title"
          onChange={(e) => editCard(p.cardId, { title: e.target.value })}
        />
        <button className="icon-btn" title="Open in side panel" aria-label="Open in side panel" onClick={() => void openCard(p.cardId)}>⤢</button>
        <button className="icon-btn" title="Remove from whiteboard" aria-label="Remove from whiteboard" onClick={removeFromBoard}>×</button>
      </div>
      <div className="node-body">
        <Editor value={p.content} onChange={onContent} onOpenLink={(t) => void openByTitle(t)} />
      </div>
      <div className="port" title="Drag to another card to connect" onPointerDown={(e) => onStartConnect(p.id, e)} />
      <div className="resize" onPointerDown={startResize} />
    </div>
  );
});
