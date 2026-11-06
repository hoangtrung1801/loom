# Canvas component (`src/ts/component/canvas`)

React and Konva layer for the Canvas object type. Engine logic lives in [`lib/canvas`](../../lib/canvas/README.md).

| File | Role |
|------|------|
| `index.tsx` | `MediaCanvas`: mounts controller, renderer and adapter, pointer/keyboard/wheel/drop wiring, DOM text editor overlay, object search, object details subscription |
| `renderer.ts` | `CanvasRenderer`: Konva (Canvas 2D) renderer on the main thread. Elements with a `roughness` are drawn hand-drawn: rough.js (`RoughGenerator`) produces the strokes, hachure and cross-hatch fills and the renderer draws them as `Konva.Path`, seeded by `el.seed` so they do not change between renders or clients. Elements saved before the style fields existed render as before (crisp, solid). Object cards are read-only live previews (page text, bookmark, image, set header). `exportImage()` draws elements into a standalone canvas for PNG export and library thumbnails. Only visible elements are attached (spatial-index culling, z order from the scene query), one Konva group per element, nothing listens to events (the controller does hit testing). Grid and selection overlay are custom shapes on their own layers |
| `adapter.ts` | `CanvasAdapter`: reads element blocks from `S.Block`, writes with `C.BlockLatexSetText`, creates new elements with `C.BlockCreate` (few) or `C.BlockPaste` (8 or more, one change instead of one per element), debounced, tombstone cleanup. Reads every embed block of the object, because the middleware nests new blocks below other blocks |
| `toolbar.tsx` | Top bar (menu, tool lock, tools with number hints, library button) and the bottom-left zoom and undo controls |
| `panel.tsx` | Properties panel on the left. Shows only the settings that apply to the selected element types (stroke, background, fill style, width, stroke style, sloppiness, edges, arrow type and heads, font, size, alignment, opacity, layers, actions). With a drawing tool active and nothing selected it edits `controller.defaults`, the style new elements start with |
| `library.tsx` | Right sidebar: "My library" (groups of elements saved per user in `localStorage`, thumbnails from `exportImage`) and a "Loom objects" search that drops object cards |
| `export.tsx` | Export dialog (PNG download or copy, background, only selected, scale) |
| `icons.tsx` | Inline SVG icons (colors from `currentColor`) |

Page: `component/page/main/canvas.tsx` (`main/canvas` route, `I.ObjectLayout.Canvas`). It also renders the editable canvas title (top left), because there is no title block.

Object cards (`ElementType.Object`) store only a `targetObjectId`. Name, type, snippet or description, source and image URL come from a `U.Subscription.subscribeIds` subscription and are drawn as a read-only preview. Double-clicking a card opens the object in the side panel (`U.Object.openPopup` with the `popupPageSidebar` class, whatever the global open mode is). The popup closes itself on a mousedown outside it (`popup/page.tsx`), so a click on the board closes the panel and double-clicking another card swaps it. The card of the open object is outlined (`setHighlightObject`, driven by `S.Popup`). Dropping from the sidebar uses the drag payload ids, the toolbar button opens the object search menu, key `9` does the same.

Menus: the main menu (top left) and the right-click menu use the `select` menu. The right-click menu selects the element under the pointer first (`controller.contextAt`).

Known gaps: cards are not yet real links (no backlinks or graph edges), no image upload tool, no SVG export, no laser pointer, no remote cursors, no mobile layout.
