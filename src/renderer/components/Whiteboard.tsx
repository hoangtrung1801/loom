import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state.js';
import { CardNode } from './CardNode.js';
import { borderPoint, bounds, center, clamp, type Point } from './geometry.js';

interface View {
  x: number;
  y: number;
  zoom: number;
}
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;
const DRAG_MIME = 'application/x-loom-card';

function loadView(boardId: string): View | null {
  try {
    const raw = localStorage.getItem(`loom.view.${boardId}`);
    const v = raw ? (JSON.parse(raw) as View) : null;
    return v && [v.x, v.y, v.zoom].every(Number.isFinite) ? v : null;
  } catch {
    return null;
  }
}
function saveView(boardId: string, view: View): void {
  try {
    localStorage.setItem(`loom.view.${boardId}`, JSON.stringify(view));
  } catch {
    /* view position just won't be remembered */
  }
}

export function Whiteboard() {
  const board = useApp((s) => s.board);
  const selection = useApp((s) => s.selection);
  const selectedEdge = useApp((s) => s.selectedEdge);
  const store = useApp.getState;

  const canvas = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [link, setLink] = useState<{ from: string; to: Point } | null>(null);
  const [editingEdge, setEditingEdge] = useState<string | null>(null);
  const boardId = board?.whiteboard.id ?? null;

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const r = canvas.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  }, []);

  const fit = useCallback(() => {
    const placements = useApp.getState().board?.placements ?? [];
    const box = bounds(placements);
    const el = canvas.current;
    if (!box || !el) return setView({ x: 40, y: 40, zoom: 1 });
    const pad = 60;
    const zoom = clamp(Math.min((el.clientWidth - pad * 2) / box.w, (el.clientHeight - pad * 2) / box.h), MIN_ZOOM, 1);
    setView({ zoom, x: (el.clientWidth - box.w * zoom) / 2 - box.x * zoom, y: (el.clientHeight - box.h * zoom) / 2 - box.y * zoom });
  }, []);

  // Restore (or fit) the viewport when switching boards.
  useEffect(() => {
    if (!boardId) return;
    const saved = loadView(boardId);
    if (saved) setView(saved);
    else requestAnimationFrame(fit);
  }, [boardId, fit]);
  useEffect(() => {
    if (!boardId) return;
    const t = window.setTimeout(() => saveView(boardId, view), 250);
    return () => window.clearTimeout(t);
  }, [boardId, view]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const k = zoom / v.zoom;
      return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, []);

  // Wheel needs a non-passive listener so Ctrl/pinch zoom can suppress browser page zoom.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      const zoomGesture = e.ctrlKey || e.metaKey;
      if (!zoomGesture && (e.target as HTMLElement).closest('.node-body')) return; // let a card scroll its own text
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (zoomGesture) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, boardId]);

  // Delete removes the selection, unless you're typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      const typing = t.closest('input, textarea, [contenteditable="true"]');
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
        e.preventDefault();
        void store().removeSelected();
      } else if (e.key === 'Escape') {
        setEditingEdge(null);
        setLink(null);
        store().select([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  const startPan = (e: React.PointerEvent): void => {
    if (e.target !== e.currentTarget || (e.button !== 0 && e.button !== 1)) return;
    const start = { x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
    let moved = false;
    const move = (ev: PointerEvent): void => {
      moved ||= Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 3;
      setView((v) => ({ ...v, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) store().select([]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startConnect = useCallback(
    (from: string, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setLink({ from, to: toWorld(e.clientX, e.clientY) });
      const move = (ev: PointerEvent): void => setLink({ from, to: toWorld(ev.clientX, ev.clientY) });
      const up = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setLink(null);
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-pid]');
        if (target?.dataset.pid && target.dataset.pid !== from) void store().connect(from, target.dataset.pid);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [toWorld, store],
  );

  const rects = useMemo(() => new Map((board?.placements ?? []).map((p) => [p.id, { x: p.x, y: p.y, w: p.w, h: p.h }])), [board?.placements]);

  if (!board) return null;

  const onDrop = (e: React.DragEvent): void => {
    const cardId = e.dataTransfer.getData(DRAG_MIME);
    if (!cardId) return;
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    void store().addExistingCard(cardId, at.x - 160, at.y - 20);
  };

  return (
    <div
      className="canvas"
      ref={canvas}
      onPointerDown={startPan}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const at = toWorld(e.clientX, e.clientY);
        void store().createCardAt(at.x - 160, at.y - 20);
      }}
      onDragOver={(e) => e.dataTransfer.types.includes(DRAG_MIME) && e.preventDefault()}
      onDrop={onDrop}
      style={{ backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
    >
      <div className="layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <svg className="edges" width="1" height="1">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,1 L9,5 L0,9 z" fill="context-stroke" />
            </marker>
          </defs>
          {board.edges.map((e) => {
            const a = rects.get(e.from);
            const b = rects.get(e.to);
            if (!a || !b) return null;
            const p1 = borderPoint(a, center(b));
            const p2 = borderPoint(b, center(a));
            const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
            const sel = selectedEdge === e.id;
            return (
              <g key={e.id} className={`edge${sel ? ' selected' : ''}`} data-edge={e.id}>
                <line className="edge-hit" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                  onPointerDown={(ev) => { ev.stopPropagation(); store().selectEdge(e.id); }}
                  onDoubleClick={(ev) => { ev.stopPropagation(); setEditingEdge(e.id); }} />
                <line className="edge-line" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} markerEnd="url(#arrow)" />
                {e.label && editingEdge !== e.id && <text x={mid.x} y={mid.y - 6} textAnchor="middle" className="edge-label">{e.label}</text>}
              </g>
            );
          })}
          {link && rects.get(link.from) && (
            <line className="edge-line draft" {...(() => {
              const p = borderPoint(rects.get(link.from)!, link.to);
              return { x1: p.x, y1: p.y, x2: link.to.x, y2: link.to.y };
            })()} />
          )}
        </svg>

        {board.placements.map((p) => (
          <CardNode key={p.id} placement={p} selected={selection.includes(p.id)} zoom={view.zoom} onStartConnect={startConnect} />
        ))}

        {editingEdge && (() => {
          const e = board.edges.find((x) => x.id === editingEdge);
          const a = e && rects.get(e.from);
          const b = e && rects.get(e.to);
          if (!e || !a || !b) return null;
          const c1 = center(a);
          const c2 = center(b);
          return (
            <input
              className="edge-input"
              autoFocus
              defaultValue={e.label}
              placeholder="Label"
              style={{ left: (c1.x + c2.x) / 2, top: (c1.y + c2.y) / 2 }}
              onBlur={(ev) => { void store().setEdgeLabel(e.id, ev.target.value.trim()); setEditingEdge(null); }}
              onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === 'Escape') (ev.target as HTMLInputElement).blur(); }}
            />
          );
        })()}
      </div>

      {!board.placements.length && (
        <div className="empty-hint">
          <strong>This whiteboard is empty</strong>
          <span>Double-click anywhere to create a card, or drag one in from the sidebar.</span>
        </div>
      )}

      <div className="controls" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button onClick={() => { const r = canvas.current!.getBoundingClientRect(); zoomAt(1 / 1.2, r.width / 2, r.height / 2); }} aria-label="Zoom out">−</button>
        <span aria-label="Zoom level">{Math.round(view.zoom * 100)}%</span>
        <button onClick={() => { const r = canvas.current!.getBoundingClientRect(); zoomAt(1.2, r.width / 2, r.height / 2); }} aria-label="Zoom in">+</button>
        <button onClick={fit} aria-label="Fit to content" title="Fit to content">⤧</button>
        <button
          className="primary"
          onClick={() => { const r = canvas.current!.getBoundingClientRect(); const at = toWorld(r.left + r.width / 2, r.top + r.height / 2); void store().createCardAt(at.x - 160, at.y - 120); }}
        >
          + Card
        </button>
      </div>
    </div>
  );
}

export { DRAG_MIME };
