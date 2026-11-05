# Canvas component (`src/ts/component/canvas`)

React and PixiJS layer for the Canvas object type. Engine logic lives in [`lib/canvas`](../../lib/canvas/README.md).

| File | Role |
|------|------|
| `index.tsx` | `MediaCanvas`: mounts controller, renderer and adapter, pointer/keyboard/wheel/drop wiring, DOM text editor overlay, object search, object details subscription |
| `renderer.ts` | `CanvasRenderer`: PixiJS 8 WebGL renderer on the main thread. One display object per visible element, culling via spatial index, overlay for selection, handles, guides |
| `adapter.ts` | `CanvasAdapter`: reads element blocks from `S.Block`, writes with `C.BlockCreate` / `C.BlockLatexSetText`, debounced, tombstone cleanup |
| `toolbar.tsx`, `stylebar.tsx`, `icons.tsx` | Tool bar, zoom and undo controls, style bar for the selection (inline SVG icons, colors from `J.Theme`) |

Page: `component/page/main/canvas.tsx` (`main/canvas` route, `I.ObjectLayout.Canvas`).

Object cards (`ElementType.Object`) store only a `targetObjectId`. Name and type come from a `U.Subscription.subscribeIds` subscription. Dropping from the sidebar uses the drag payload ids, the toolbar button opens the object search menu.

Known gaps: cards are not yet real links (no backlinks or graph edges), no live object preview, no remote cursors, no mobile layout.
