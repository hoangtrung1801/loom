# Canvas component (`src/ts/component/canvas`)

React and Konva layer for the Canvas object type. Engine logic lives in [`lib/canvas`](../../lib/canvas/README.md).

| File | Role |
|------|------|
| `index.tsx` | `MediaCanvas`: mounts controller, renderer and adapter, pointer/keyboard/wheel/drop wiring, DOM text editor overlay, object search, object details subscription |
| `renderer.ts` | `CanvasRenderer`: Konva (Canvas 2D) renderer on the main thread. Only visible elements are attached (spatial-index culling, z order from the scene query), one Konva group per element, nothing listens to events (the controller does hit testing). Grid and selection overlay are custom shapes on their own layers |
| `adapter.ts` | `CanvasAdapter`: reads element blocks from `S.Block`, writes with `C.BlockLatexSetText`, creates new elements with `C.BlockCreate` (few) or `C.BlockPaste` (8 or more, one change instead of one per element), debounced, tombstone cleanup. Reads every embed block of the object, because the middleware nests new blocks below other blocks |
| `toolbar.tsx`, `stylebar.tsx`, `icons.tsx` | Tool bar, zoom and undo controls, style bar for the selection (inline SVG icons, colors from `J.Theme`) |

Page: `component/page/main/canvas.tsx` (`main/canvas` route, `I.ObjectLayout.Canvas`). It also renders the editable canvas title (top left), because there is no title block.

Object cards (`ElementType.Object`) store only a `targetObjectId`. Name and type come from a `U.Subscription.subscribeIds` subscription. Dropping from the sidebar uses the drag payload ids, the toolbar button opens the object search menu.

Known gaps: cards are not yet real links (no backlinks or graph edges), no live object preview, no remote cursors, no mobile layout.
