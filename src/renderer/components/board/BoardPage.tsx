import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ContextRef } from '../../../core/chats.js';
import type { EdgeView, PlacementPatch, PlacementView } from '../../../core/store.js';
import { api } from '../../api.js';
import { DRAG_MIME, importFiles, openBoard, openCard, trashBoard } from '../../actions.js';
import { pickFiles } from '../../editor/commands.js';
import { mutate, useData } from '../../store/data.js';
import { useTabs } from '../../store/tabs.js';
import { useUi, type MenuItem } from '../../store/ui.js';
import { Icon } from '../Icon.js';
import { borderPoint, bounds, center, clamp, type Point, type Rect } from '../geometry.js';
import { BoardSearch } from './BoardSearch.js';
import { ColorPicker, EdgeBar, SelectionBar, ToolBar } from './BoardToolbar.js';
import { ExistingCardPicker } from './ExistingCardPicker.js';
import { BoardObjectView, type ObjectHandlers } from './Objects.js';
import { useBoard, withDependents } from './useBoard.js';

interface View {
  x: number;
  y: number;
  zoom: number;
}
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const COLOR_VAR: Record<string, string> = {
  red: '#e5484d', orange: '#f76b15', yellow: '#d6a100', green: '#30a46c', blue: '#3e63dd', purple: '#8e4ec6', pink: '#d6409f', gray: '#889096',
};
const MIN: Record<string, { w: number; h: number }> = { card: { w: 160, h: 100 }, section: { w: 160, h: 100 }, board: { w: 160, h: 80 }, text: { w: 40, h: 24 } };

const loadView = (id: string): View | null => {
  try {
    const v = JSON.parse(localStorage.getItem(`loom.view.${id}`) ?? 'null') as View | null;
    return v && [v.x, v.y, v.zoom].every(Number.isFinite) ? v : null;
  } catch {
    return null;
  }
};
const saveView = (id: string, view: View): void => {
  try {
    localStorage.setItem(`loom.view.${id}`, JSON.stringify(view));
  } catch {
    /* the position just won't be remembered */
  }
};
const isTyping = (t: EventTarget | null): boolean => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
const rectOf = (p: PlacementView): Rect => ({ x: p.x, y: p.y, w: p.w, h: p.h });
const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Section a point falls in, preferring the smallest one when they overlap. */
function sectionAt(sections: PlacementView[], pt: Point, skip: Set<string>): string {
  let best: PlacementView | undefined;
  for (const s of sections) {
    if (skip.has(s.id) || pt.x < s.x || pt.x > s.x + s.w || pt.y < s.y || pt.y > s.y + s.h) continue;
    if (!best || s.w * s.h < best.w * best.h) best = s;
  }
  return best?.id ?? '';
}

export default function BoardPage({ id, tabId }: { id: string; tabId: string }) {
  const { data, missing, selection, edge: edgeSel, tool, editing, draft } = useBoard();
  const boards = useData((s) => s.boards);
  const version = useData((s) => s.version);
  const canvas = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [box, setBox] = useState<Rect | null>(null);
  const [link, setLink] = useState<{ from: string; to: Point } | null>(null);
  const [drawing, setDrawing] = useState<Rect | null>(null);
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<Set<string> | null>(null);
  const [picker, setPicker] = useState(false);
  const [flash, setFlash] = useState('');
  const space = useRef(false);
  const dragging = useRef(false);
  const act = useBoard.getState;

  useEffect(() => {
    void act().load(id);
  }, [id, act]);
  // Reload when shared data changes (sync, another tab, undo) but never mid-drag.
  useEffect(() => {
    if (!dragging.current) void act().reload();
  }, [version, act]);

  const board = boards.find((b) => b.id === id);
  const placements = useMemo(() => (data?.placements ?? []).map((p) => (draft[p.id] ? { ...p, ...draft[p.id] } : p)), [data, draft]);
  const byId = useMemo(() => new Map(placements.map((p) => [p.id, p])), [placements]);
  const childCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of placements) if (p.parentId) m.set(p.parentId, (m.get(p.parentId) ?? 0) + 1);
    return m;
  }, [placements]);

  const toWorld = useCallback((x: number, y: number): Point => {
    const r = canvas.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (x - r.left - v.x) / v.zoom, y: (y - r.top - v.y) / v.zoom };
  }, []);
  const viewCenter = useCallback((): Point => {
    const r = canvas.current!.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }, [toWorld]);

  const fit = useCallback(
    (list?: PlacementView[]) => {
      const rects = (list ?? useBoard.getState().data?.placements ?? []).map(rectOf);
      const b = bounds(rects);
      const el = canvas.current;
      if (!el) return;
      if (!b) return setView({ x: 60, y: 60, zoom: 1 });
      const pad = 80;
      const zoom = clamp(Math.min((el.clientWidth - pad * 2) / Math.max(b.w, 1), (el.clientHeight - pad * 2) / Math.max(b.h, 1)), MIN_ZOOM, 1);
      setView({ zoom, x: (el.clientWidth - b.w * zoom) / 2 - b.x * zoom, y: (el.clientHeight - b.h * zoom) / 2 - b.y * zoom });
    },
    [],
  );
  const centerOn = useCallback((p: Rect) => {
    const el = canvas.current;
    if (!el) return;
    const zoom = clamp(Math.max(viewRef.current.zoom, 0.6), MIN_ZOOM, MAX_ZOOM);
    setView({ zoom, x: el.clientWidth / 2 - (p.x + p.w / 2) * zoom, y: el.clientHeight / 2 - (p.y + p.h / 2) * zoom });
  }, []);

  // Restore the saved viewport, or fit the content the first time.
  const fitted = useRef('');
  const [readyId, setReadyId] = useState('');
  useEffect(() => {
    if (!data || fitted.current === id) return;
    fitted.current = id;
    const saved = loadView(id);
    if (saved) {
      setView(saved);
      setReadyId(id);
    } else {
      requestAnimationFrame(() => {
        fit(data.placements);
        setReadyId(id);
      });
    }
  }, [data, id, fit]);
  useEffect(() => {
    const t = window.setTimeout(() => fitted.current === id && saveView(id, view), 250);
    return () => window.clearTimeout(t);
  }, [id, view]);

  // "Show on whiteboard" requests from the location panel and search.
  const focus = useTabs((s) => s.focus);
  useEffect(() => {
    if (!focus || focus.tabId !== tabId || !data) return;
    const target = data.placements.find((p) => p.id === focus.target) ?? data.placements.find((p) => p.cardId === focus.target);
    if (target) {
      centerOn(rectOf(target));
      act().select([target.id]);
      setFlash(target.id);
      window.setTimeout(() => setFlash(''), 1600);
    }
    useTabs.getState().clearFocus();
  }, [focus, tabId, data, centerOn, act]);

  const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = canvas.current;
    if (!el) return;
    const x = cx ?? el.clientWidth / 2;
    const y = cy ?? el.clientHeight / 2;
    setView((v) => {
      const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const k = zoom / v.zoom;
      return { zoom, x: x - (x - v.x) * k, y: y - (y - v.y) * k };
    });
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      const zoomGesture = e.ctrlKey || e.metaKey;
      if (!zoomGesture && (e.target as HTMLElement).closest('.obj-body, .obj.editing')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (zoomGesture) zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy, data === null]);

  // ------------------------------------------------------------------ helpers

  const selectedPlacements = placements.filter((p) => selection.includes(p.id));
  const contextFor = (items: PlacementView[]): ContextRef[] =>
    items.flatMap((p): ContextRef[] =>
      p.kind === 'card' ? [{ type: 'card', id: p.cardId, label: p.title || 'Untitled' }]
        : p.kind === 'section' ? [{ type: 'section', id: p.id, boardId: id, label: p.text || 'Section' }]
        : [],
    );
  const askAi = (items: PlacementView[]): void => {
    const ctx = contextFor(items);
    useUi.getState().openChat(ctx.length ? ctx : [{ type: 'whiteboard', id, label: board?.name || 'Whiteboard' }]);
  };

  const place = useCallback(
    async (kind: 'text' | 'section' | 'mind', at: Point, size?: { w: number; h: number }) => {
      const pid = await act().addObject(
        kind === 'section'
          ? { kind: 'section', x: at.x, y: at.y, w: size?.w, h: size?.h, text: 'Section' }
          : { kind: 'text', x: at.x, y: at.y, text: kind === 'mind' ? 'Topic' : '', size: kind === 'mind' ? 22 : 16, w: kind === 'mind' ? 220 : 240 },
      );
      if (pid) {
        act().select([pid]);
        act().setEditing(pid);
      }
      act().setTool('select');
    },
    [act],
  );

  const addMindChild = useCallback(
    async (parent: PlacementView, sibling = false) => {
      const d = useBoard.getState().data;
      if (!d) return;
      const anchor = sibling && parent.parentId ? d.placements.find((p) => p.id === parent.parentId) : parent;
      if (!anchor) return;
      const kids = d.placements.filter((p) => p.parentId === anchor.id);
      const y = kids.length ? Math.max(...kids.map((k) => k.y + k.h)) + 24 : anchor.y;
      const pid = await act().addObject({ kind: 'text', x: anchor.x + anchor.w + 70, y, w: 220, text: '', size: 18, parentId: anchor.id });
      if (pid) {
        act().select([pid]);
        act().setEditing(pid);
      }
    },
    [act],
  );

  const newCardAt = useCallback(
    async (at: Point) => {
      const made = await act().createCard(at.x - 160, at.y - 20);
      if (made) {
        act().select([made.placementId]);
        act().setEditing(made.placementId);
      }
    },
    [act],
  );

  const colorize = (ids: string[], color: string): void => {
    const d = useBoard.getState().data;
    if (d) void act().patch(withDependents(d, ids, { members: false }).map((x) => ({ id: x, color })), 'Color');
  };
  const reorder = (ids: string[], front: boolean): void => {
    const d = useBoard.getState().data;
    if (!d) return;
    const zs = d.placements.map((p) => p.z);
    const base = front ? Math.max(...zs) : Math.min(...zs);
    void act().patch(ids.map((x, i) => ({ id: x, z: front ? base + 1 + i : base - ids.length + i })), front ? 'Bring to front' : 'Send to back');
  };

  // ------------------------------------------------------------------ pointer interactions

  const startPan = (e: React.PointerEvent): void => {
    const start = { x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
    const move = (ev: PointerEvent): void => setView((v) => ({ ...v, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }));
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startDrag = (e: React.PointerEvent, ids: string[]): void => {
    const d = useBoard.getState().data;
    if (!d) return;
    const moving = withDependents(d, ids);
    const origin = new Map(moving.map((x) => [x, d.placements.find((p) => p.id === x)!]));
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const move = (ev: PointerEvent): void => {
      const dx = (ev.clientX - start.x) / viewRef.current.zoom;
      const dy = (ev.clientY - start.y) / viewRef.current.zoom;
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
      moved = true;
      dragging.current = true;
      act().setDraft(Object.fromEntries([...origin].map(([pid, p]) => [pid, { x: p.x + dx, y: p.y + dy }])));
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragging.current = false;
      if (!moved) return;
      const dx = (ev.clientX - start.x) / viewRef.current.zoom;
      const dy = (ev.clientY - start.y) / viewRef.current.zoom;
      // Dropped on a sub-whiteboard tile: move the objects into that whiteboard.
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-pid]');
      const tile = under?.dataset.pid ? d.placements.find((p) => p.id === under.dataset.pid) : undefined;
      if (tile?.kind === 'board' && !moving.includes(tile.id)) {
        act().setDraft({});
        void act().moveToBoard(ids.filter((x) => d.placements.find((p) => p.id === x)?.kind !== 'section'), tile.refId);
        return;
      }
      const sections = d.placements.filter((p) => p.kind === 'section');
      const skip = new Set(moving);
      const patches: PlacementPatch[] = moving.map((pid) => {
        const p = origin.get(pid)!;
        const patch: PlacementPatch = { id: pid, x: p.x + dx, y: p.y + dy };
        // Explicitly dragged objects join (or leave) the section they land in; dependents keep theirs.
        if (ids.includes(pid) && p.kind !== 'section' && !p.parentId) {
          const c = { x: p.x + dx + p.w / 2, y: p.y + dy + p.h / 2 };
          const target = sectionAt(sections, c, skip);
          if (target !== p.sectionId) patch.sectionId = target;
        }
        return patch;
      });
      void act().patch(patches, 'Move');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (e: React.PointerEvent, p: PlacementView): void => {
    e.stopPropagation();
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const min = MIN[p.kind]!;
    let size = { w: p.w, h: p.h };
    dragging.current = true;
    const move = (ev: PointerEvent): void => {
      size = {
        w: Math.max(min.w, p.w + (ev.clientX - start.x) / viewRef.current.zoom),
        h: Math.max(min.h, p.h + (ev.clientY - start.y) / viewRef.current.zoom),
      };
      act().setDraft({ [p.id]: size });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragging.current = false;
      const patches: PlacementPatch[] = [{ id: p.id, ...size }];
      if (p.kind === 'section') {
        // Resizing a section re-decides who is inside it.
        const d = useBoard.getState().data!;
        const resized = { ...p, ...size };
        const sections = d.placements.filter((s) => s.kind === 'section').map((s) => (s.id === p.id ? resized : s));
        for (const o of d.placements) {
          if (o.kind === 'section' || o.parentId) continue;
          const target = sectionAt(sections, { x: o.x + o.w / 2, y: o.y + o.h / 2 }, new Set());
          if (target !== o.sectionId) patches.push({ id: o.id, sectionId: target });
        }
      }
      void act().patch(patches, 'Resize');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startConnect = (e: React.PointerEvent, from: PlacementView): void => {
    e.stopPropagation();
    e.preventDefault();
    setLink({ from: from.id, to: toWorld(e.clientX, e.clientY) });
    const move = (ev: PointerEvent): void => setLink({ from: from.id, to: toWorld(ev.clientX, ev.clientY) });
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setLink(null);
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-pid]');
      if (target?.dataset.pid && target.dataset.pid !== from.id) void act().connect(from.id, target.dataset.pid);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startBox = (e: React.PointerEvent): void => {
    const origin = toWorld(e.clientX, e.clientY);
    const base = e.shiftKey ? act().selection : [];
    let moved = false;
    const move = (ev: PointerEvent): void => {
      const now = toWorld(ev.clientX, ev.clientY);
      const r = { x: Math.min(origin.x, now.x), y: Math.min(origin.y, now.y), w: Math.abs(now.x - origin.x), h: Math.abs(now.y - origin.y) };
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      moved = true;
      setBox(r);
      const hit = (useBoard.getState().data?.placements ?? []).filter((p) => {
        if (p.kind !== 'section') return intersects(r, rectOf(p));
        const covers = r.x <= p.x && r.y <= p.y && r.x + r.w >= p.x + p.w && r.y + r.h >= p.y + p.h;
        return covers || intersects(r, { x: p.x, y: p.y, w: p.w, h: 40 });
      });
      act().select([...new Set([...base, ...hit.map((p) => p.id)])]);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBox(null);
      if (!moved && !e.shiftKey) act().select([]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startDraw = (e: React.PointerEvent): void => {
    const origin = toWorld(e.clientX, e.clientY);
    let rect: Rect = { ...origin, w: 0, h: 0 };
    const move = (ev: PointerEvent): void => {
      const now = toWorld(ev.clientX, ev.clientY);
      rect = { x: Math.min(origin.x, now.x), y: Math.min(origin.y, now.y), w: Math.abs(now.x - origin.x), h: Math.abs(now.y - origin.y) };
      setDrawing(rect);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrawing(null);
      const big = rect.w > 40 && rect.h > 40;
      void place('section', big ? rect : origin, big ? { w: rect.w, h: rect.h } : undefined);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onCanvasDown = (e: React.PointerEvent): void => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.bg) return;
    if (e.button === 1 || space.current) return startPan(e);
    if (e.button !== 0) return;
    if (tool === 'text') return void place('text', toWorld(e.clientX, e.clientY));
    if (tool === 'mindmap') return void place('mind', toWorld(e.clientX, e.clientY));
    if (tool === 'section') return startDraw(e);
    if (editing) act().setEditing(null);
    startBox(e);
  };

  const handlers = useMemo<ObjectHandlers>(
    () => ({
      down(e, p) {
        if (e.button === 2) {
          if (!useBoard.getState().selection.includes(p.id)) act().select([p.id]);
          return;
        }
        if (e.button === 1 || space.current) return startPan(e);
        if (useBoard.getState().editing === p.id) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        if (useBoard.getState().tool === 'connect') return startConnect(e, p);
        const current = useBoard.getState().selection;
        let ids = current;
        if (e.shiftKey) {
          ids = current.includes(p.id) ? current.filter((x) => x !== p.id) : [...current, p.id];
          act().select(ids);
          return;
        }
        if (!current.includes(p.id)) {
          ids = [p.id];
          act().select(ids);
        }
        if (useBoard.getState().editing) act().setEditing(null);
        startDrag(e, ids);
      },
      doubleClick(p) {
        if (p.kind === 'board') return openBoard(p.refId);
        act().select([p.id]);
        act().setEditing(p.id);
      },
      contextMenu(e, p) {
        e.preventDefault();
        e.stopPropagation();
        const ids = useBoard.getState().selection.includes(p.id) ? useBoard.getState().selection : [p.id];
        const items = useBoard.getState().data?.placements.filter((x) => ids.includes(x.id)) ?? [p];
        useUi.getState().showMenu(e.clientX, e.clientY, objectMenu(p, ids, items));
      },
      resize: (e, p) => startResize(e, p),
      connect: (e, p) => startConnect(e, p),
      commitText: (p, text) => void act().patch([{ id: p.id, text }], 'Edit text'),
      stopEditing: () => act().setEditing(null),
      open: (p) => (p.kind === 'card' ? openCard(p.cardId, true) : p.kind === 'board' ? openBoard(p.refId, undefined, true) : undefined),
    }),
    // The handlers read live state through the store and refs, so they stay stable for memoised objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  function objectMenu(p: PlacementView, ids: string[], items: PlacementView[]): MenuItem[] {
    const others = boards.filter((b) => b.id !== id).slice(0, 15);
    return [
      ...(p.kind === 'card' ? [{ label: 'Open card', onClick: () => openCard(p.cardId) }, { label: 'Open in new tab', onClick: () => openCard(p.cardId, true) }] : []),
      ...(p.kind === 'board' ? [{ label: 'Open whiteboard', onClick: () => openBoard(p.refId) }] : []),
      ...(ids.length === 1 && p.kind !== 'board' ? [{ label: 'Edit', onClick: () => { act().select([p.id]); act().setEditing(p.id); } }] : []),
      ...(p.kind === 'text' ? [{ label: 'Add child node', onClick: () => void addMindChild(p) }] : []),
      ...(p.kind === 'card' ? [{ label: 'Place again (copy)', onClick: () => void act().addCard(p.cardId, p.x + 40, p.y + 40) }] : []),
      { label: 'Ask AI about this', onClick: () => askAi(items) },
      { separator: true },
      { label: 'Bring to front', onClick: () => reorder(ids, true) },
      { label: 'Send to back', onClick: () => reorder(ids, false) },
      ...(others.length ? [{ separator: true }, ...others.map((b) => ({ label: `Move to “${b.name || 'Untitled'}”`, onClick: () => void act().moveToBoard(ids.filter((x) => items.find((i) => i.id === x)?.kind !== 'section'), b.id) }))] : []),
      { separator: true },
      { label: ids.length > 1 ? `Remove ${ids.length} objects from whiteboard` : 'Remove from whiteboard', danger: true, onClick: () => void act().remove(ids) },
    ];
  }

  // ------------------------------------------------------------------ keyboard / clipboard

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !isTyping(e.target)) space.current = true;
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const st = useBoard.getState();
      const sel = st.data?.placements.filter((p) => st.selection.includes(p.id)) ?? [];
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void (e.shiftKey ? st.redo() : st.undo());
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        void st.redo();
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        st.select((st.data?.placements ?? []).map((p) => p.id));
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearching(true);
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        for (const p of sel) {
          if (p.kind === 'card') void st.addCard(p.cardId, p.x + 40, p.y + 40);
          else if (p.kind === 'text' || p.kind === 'section') void st.addObject({ kind: p.kind, x: p.x + 40, y: p.y + 40, w: p.w, h: p.h, text: p.text, color: p.color, size: p.size });
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
        e.preventDefault();
        if (st.edge) void st.deleteEdge(st.edge);
        else void st.remove(st.selection);
      } else if (e.key === 'Escape') {
        setSearching(false);
        setPicker(false);
        st.setTool('select');
        st.select([]);
        st.setEditing(null);
      } else if (e.key === 'Tab' && sel.length === 1 && sel[0]!.kind === 'text') {
        e.preventDefault();
        void addMindChild(sel[0]!);
      } else if (e.key === 'Enter' && sel.length === 1) {
        e.preventDefault();
        if (sel[0]!.kind === 'text' && sel[0]!.parentId && e.shiftKey) void addMindChild(sel[0]!, true);
        else if (sel[0]!.kind !== 'board') st.setEditing(sel[0]!.id);
        else openBoard(sel[0]!.refId);
      } else if (e.key.startsWith('Arrow') && sel.length) {
        e.preventDefault();
        const step = e.shiftKey ? 50 : 10;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const d = st.data!;
        void st.patch(withDependents(d, sel.map((p) => p.id)).map((pid) => { const p = d.placements.find((x) => x.id === pid)!; return { id: pid, x: p.x + dx, y: p.y + dy }; }), 'Nudge');
      } else if (!mod && !e.altKey && e.key.length === 1) {
        const tool = ({ v: 'select', t: 'text', s: 'section', c: 'connect', m: 'mindmap' } as const)[e.key.toLowerCase() as 'v'];
        if (tool) st.setTool(tool);
        else if (e.key.toLowerCase() === 'n') void newCardAt(viewCenter());
      }
    };
    const onUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') space.current = false;
    };
    const onPaste = (e: ClipboardEvent): void => {
      if (isTyping(e.target)) return;
      const files = [...(e.clipboardData?.files ?? [])];
      const at = viewCenter();
      if (files.length) {
        e.preventDefault();
        void importFiles(files, { boardId: id, x: at.x - 160, y: at.y - 100 }).then(() => act().reload());
      } else {
        const text = e.clipboardData?.getData('text/plain').trim();
        if (text) {
          e.preventDefault();
          void act().addObject({ kind: 'text', x: at.x - 120, y: at.y - 20, text: text.slice(0, 5000) });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('paste', onPaste);
    };
  }, [id, act, addMindChild, newCardAt, viewCenter]);

  const onDrop = (e: React.DragEvent): void => {
    const at = toWorld(e.clientX, e.clientY);
    const cardId = e.dataTransfer.getData(DRAG_MIME);
    if (cardId) {
      e.preventDefault();
      void act().addCard(cardId, at.x - 160, at.y - 20);
    } else if (e.dataTransfer.files.length) {
      e.preventDefault();
      void importFiles([...e.dataTransfer.files], { boardId: id, x: at.x - 160, y: at.y - 20 }).then(() => act().reload());
    }
  };

  const canvasMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    useUi.getState().showMenu(e.clientX, e.clientY, [
      { label: 'New card here', onClick: () => void newCardAt(at) },
      { label: 'New text here', onClick: () => void place('text', at) },
      { label: 'New section here', onClick: () => void place('section', at) },
      { label: 'New mind map here', onClick: () => void place('mind', at) },
      { label: 'New sub-whiteboard here', onClick: () => void act().addObject({ kind: 'board', x: at.x, y: at.y }) },
      { separator: true },
      { label: 'Select all', onClick: () => act().select(placements.map((p) => p.id)) },
      { label: 'Fit to content', onClick: () => fit() },
      { separator: true },
      { label: 'Ask AI about this whiteboard', onClick: () => askAi([]) },
    ]);
  };

  const moreMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    useUi.getState().showMenu(r.left, r.top - 8 - 200, [
      { label: 'Fit to content', onClick: () => fit() },
      { label: 'Zoom to 100%', onClick: () => setView((v) => ({ ...v, zoom: 1 })) },
      { label: 'Add sub-whiteboard', onClick: () => void act().addObject({ kind: 'board', ...(() => { const c = viewCenter(); return { x: c.x - 120, y: c.y - 60 }; })() }) },
      { label: 'Undo', disabled: !useBoard.getState().undoStack.length, onClick: () => void act().undo() },
      { label: 'Redo', disabled: !useBoard.getState().redoStack.length, onClick: () => void act().redo() },
      { separator: true },
      { label: 'Ask AI about this whiteboard', onClick: () => askAi([]) },
      { label: 'Move whiteboard to trash', danger: true, onClick: () => void trashBoard(id) },
    ]);
  };

  // ------------------------------------------------------------------ render

  if (missing) return <div className="loading">This whiteboard no longer exists.</div>;
  if (!data) return <div className="loading">Loading…</div>;

  const rect = (pid: string): Rect | undefined => byId.get(pid) && rectOf(byId.get(pid)!);
  const edges = data.edges.filter((e) => byId.has(e.from) && byId.has(e.to));
  const selectedEdge = edges.find((e) => e.id === edgeSel);
  const parentBoard = board?.parentId ? boards.find((b) => b.id === board.parentId) : undefined;
  const hasSelection = selectedPlacements.length > 0;
  const dim = (p: PlacementView): boolean => !!matches && !matches.has(p.id);

  const edgeColor = (c: string): string => COLOR_VAR[c] ?? 'var(--edge)';
  const dash = (style: string): string | undefined => (style === 'dashed' ? '8 6' : style === 'dotted' ? '2 6' : undefined);

  return (
    <div className="board" data-tool={tool}>
      <div className="board-head" onPointerDown={(e) => e.stopPropagation()}>
        {parentBoard && <button className="link" onClick={() => openBoard(parentBoard.id)}>{parentBoard.name || 'Untitled'} /</button>}
        <input
          className="board-title"
          key={id + (board?.name ?? '')}
          defaultValue={board?.name ?? ''}
          aria-label="Whiteboard name"
          onBlur={(e) => e.target.value !== board?.name && void mutate(() => api.renameWhiteboard(id, e.target.value.trim() || 'Untitled whiteboard'))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <ColorPicker value={board?.color ?? ''} onPick={(c) => void mutate(() => api.setWhiteboardColor(id, c))} />
      </div>

      <div
        className="canvas"
        data-ready={readyId === id ? '1' : undefined}
        ref={canvas}
        onPointerDown={onCanvasDown}
        onDoubleClick={(e) => (e.target === e.currentTarget || (e.target as HTMLElement).dataset.bg) && void newCardAt(toWorld(e.clientX, e.clientY))}
        onContextMenu={canvasMenu}
        onDragOver={(e) => (e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes('Files')) && e.preventDefault()}
        onDrop={onDrop}
        style={{ backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px`, cursor: tool === 'select' ? undefined : 'crosshair' }}
      >
        <div className="layer" data-bg="1" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          {placements.filter((p) => p.kind === 'section').map((p) => (
            <BoardObjectView key={p.id} p={p} selected={selection.includes(p.id)} editing={editing === p.id} dim={dim(p)} match={flash === p.id || !!matches?.has(p.id)} isMind={false} handlers={handlers} />
          ))}
          <svg className="edges" width="1" height="1" style={{ overflow: 'visible' }}>
            {placements.filter((p) => p.parentId && byId.has(p.parentId)).map((c) => {
              const a = rect(c.parentId)!;
              const b = rectOf(c);
              const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
              const mx = (x1 + x2) / 2;
              return <path key={`m${c.id}`} className="mind-edge" d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} stroke={edgeColor(c.color)} />;
            })}
            {edges.map((e) => <EdgeLine key={e.id} e={e} a={rect(e.from)!} b={rect(e.to)!} selected={edgeSel === e.id} color={edgeColor(e.color)} dash={dash(e.style)} onSelect={() => act().selectEdge(e.id)} />)}
            {link && rect(link.from) && (() => {
              const a = rect(link.from)!;
              const p1 = borderPoint(a, link.to);
              return <line className="edge-line preview" x1={p1.x} y1={p1.y} x2={link.to.x} y2={link.to.y} />;
            })()}
          </svg>
          {placements.filter((p) => p.kind !== 'section').map((p) => (
            <BoardObjectView key={p.id} p={p} selected={selection.includes(p.id)} editing={editing === p.id} dim={dim(p)} match={flash === p.id || !!matches?.has(p.id)} isMind={!!p.parentId || (childCount.get(p.id) ?? 0) > 0} handlers={handlers} />
          ))}
          {box && <div className="marquee" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
          {drawing && <div className="marquee section" style={{ left: drawing.x, top: drawing.y, width: drawing.w, height: drawing.h }} />}
        </div>
        {placements.length === 0 && (
          <div className="board-empty">
            <strong>Empty whiteboard</strong>
            <span>Double-click to add a card, drag cards from the library panel, or drop files here.</span>
          </div>
        )}
      </div>

      {searching && <BoardSearch placements={data.placements} onMatches={setMatches} onJump={(p) => { centerOn(rectOf(p)); act().select([p.id]); setFlash(p.id); window.setTimeout(() => setFlash(''), 1200); }} onClose={() => setSearching(false)} />}
      {hasSelection && !editing && (
        <SelectionBar
          items={selectedPlacements}
          onColor={(c) => colorize(selection, c)}
          onSize={(delta) => void act().patch(selectedPlacements.filter((p) => p.kind === 'text').map((p) => ({ id: p.id, size: clamp(p.size + delta, 8, 96) })), 'Text size')}
          onFront={() => reorder(selection, true)}
          onBack={() => reorder(selection, false)}
          onAsk={() => askAi(selectedPlacements)}
          onRemove={() => void act().remove(selection)}
        />
      )}
      {selectedEdge && (
        <EdgeBar key={selectedEdge.id} edge={selectedEdge} onChange={(patch) => void act().editEdge(selectedEdge.id, patch)} onDelete={() => void act().deleteEdge(selectedEdge.id)} />
      )}

      <div className="zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
        <button className="icon-btn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}><Icon name="minus" /></button>
        <button className="zoom-level" aria-label="Reset zoom" onClick={() => setView((v) => ({ ...v, zoom: 1 }))}>{Math.round(view.zoom * 100)}%</button>
        <button className="icon-btn" aria-label="Zoom in" onClick={() => zoomBy(1.2)}><Icon name="plus" /></button>
        <button className="icon-btn" aria-label="Fit to content" onClick={() => fit()}><Icon name="fit" /></button>
        <button className="icon-btn" aria-label="Undo" disabled={!useBoard.getState().undoStack.length} onClick={() => void act().undo()}><Icon name="undo" /></button>
        <button className="icon-btn" aria-label="Redo" disabled={!useBoard.getState().redoStack.length} onClick={() => void act().redo()}><Icon name="redo" /></button>
      </div>

      {picker && (
        <ExistingCardPicker
          onClose={() => setPicker(false)}
          onPick={(cardId) => {
            const c = viewCenter();
            setPicker(false);
            void act().addCard(cardId, c.x - 160, c.y - 60);
          }}
        />
      )}
      <ToolBar
        tool={tool}
        setTool={(t) => act().setTool(t)}
        onNewCard={() => void newCardAt(viewCenter())}
        onAddExisting={() => setPicker((v) => !v)}
        onUpload={() => void pickFiles('*/*', true).then((files) => { const c = viewCenter(); return importFiles(files, { boardId: id, x: c.x - 160, y: c.y - 100 }); }).then(() => act().reload())}
        onSearch={() => setSearching((v) => !v)}
        searching={searching}
        more={moreMenu}
      />
    </div>
  );
}

function EdgeLine({ e, a, b, selected, color, dash, onSelect }: { e: EdgeView; a: Rect; b: Rect; selected: boolean; color: string; dash?: string; onSelect(): void }) {
  const p1 = borderPoint(a, center(b));
  const p2 = borderPoint(b, center(a));
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const markerEnd = e.arrow === 'end' || e.arrow === 'both';
  const markerStart = e.arrow === 'start' || e.arrow === 'both';
  return (
    <g className={`edge${selected ? ' selected' : ''}`} data-edge={e.id} style={{ color }}>
      <line className="edge-hit" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} onPointerDown={(ev) => { ev.stopPropagation(); onSelect(); }} />
      <line className="edge-line" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color} strokeDasharray={dash} markerEnd={markerEnd ? 'url(#arrow)' : undefined} markerStart={markerStart ? 'url(#arrow)' : undefined} />
      {e.label && <text x={mid.x} y={mid.y - 6} textAnchor="middle" className="edge-label">{e.label}</text>}
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,1 L9,5 L0,9 z" fill="context-stroke" />
        </marker>
      </defs>
    </g>
  );
}
