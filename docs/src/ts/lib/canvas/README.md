# Canvas engine (`src/ts/lib/canvas`)

Renderer-independent core of the Canvas object type (a whiteboard). Pure TypeScript, no DOM, no stores, so it is fully unit tested (`canvas.test.ts`).

| File | Role |
|------|------|
| `types.ts` | `CanvasElement`, `ElementType`, `Tool`, geometry types, style types and `DEFAULT_STYLE`, limits (`SOFT_ELEMENT_LIMIT` = 2500) |
| `scene.ts` | `Scene`: element map, spatial index, selection, local `upsert` (bumps version), tombstone `remove`, `applyRemote` with `shouldApplyRemote` conflict rule |
| `controller.ts` | `CanvasController`: tools (number-row shortcuts, tool lock, eraser), pointer and keyboard input, move/resize/rotate, snapping, marquee, bindings (an arrow end stores `startId`/`endId` plus `startFocus`/`endFocus`, a 0-1 fraction of the element size on its border, so it stays at that point on move or resize; selected lines get end handles to re-attach), clipboard and style copy, `insertElements`, z-order, undo and redo, commit callbacks. `defaults` is the style new elements start with and follows the last style the user picked |
| `geometry.ts` | Bounds, hit testing (rotation aware, diamond, curved arrows), simplification (Ramer-Douglas-Peucker), arrow anchors, `routePoints` and `applyRoute` (sharp, curved, elbow arrows) |
| `spatial.ts` | Uniform grid index used for culling, marquee and hit candidates |
| `order.ts` | Fractional indexing for z-order (`between`) |
| `viewport.ts` | Screen/world conversion, zoom around a point, fit |
| `history.ts` | Local undo stack of snapshots (other users' changes are never undone) |
| `codec.ts` | Element JSON encode/decode, `ELEMENT_PROCESSOR` (28), `decodeClipboardElements` for pasted canvas data (`{ type: 'loom/canvas', elements }` or a bare array) |
| `library.ts` | Library item type, `toLibraryElements` (group relative to its corner), `localStorage` load and save |

## Element style

Style fields (`fillStyle`, `strokeStyle`, `roughness`, `seed`, `rounded`, `opacity`, `fontFamily`, `textAlign`, `verticalAlign`, `arrowType`, `startHead`, `endHead`) are optional, so elements saved before they existed keep their crisp solid look. Arrows keep their two end points and rebuild the middle points from `arrowType` (`applyRoute`): sharp is a segment, curved adds one control point, elbow adds two bends.

## Data model

Element types: rect, diamond, ellipse, line, arrow, freehand, text, sticky, frame, object (card of a Loom object) and image (`src` holds a data URL, so a picture does not depend on the files of one space).

`color` and `fill` are palette names that follow the theme, or a custom hex color (`#rrggbb`, `#rrggbbaa`, see `isCustomColor`) drawn as is. `radius` sets the corner radius of rects, stickies and images, `fontWeight` the weight of text. A freehand with a `fill` is a closed, filled shape.

Each element is a JSON string in the `text` of one embed block (`BlockContentLatex`, processor `CanvasElement` = 28). A canvas object (layout `canvas`, type key `canvas`) is a regular page whose child blocks are these element blocks. One block per element gives per-element sync and conflict resolution through the existing change tree.

Conflicts: higher `v` wins, equal `v` is decided by the lower `nonce`. Deletes are tombstones (`deleted: true`) and are removed from the object after a minute.

Limits: about 2-3k elements per canvas (middleware loads and normalizes the whole object). The UI shows a warning past `SOFT_ELEMENT_LIMIT`.

## Pasting canvas data

Ctrl/Cmd+V on the canvas lets the native paste event through. `onPaste` (`component/canvas/index.tsx`) inserts pasted canvas JSON with `insertElements` at the view center and fits to it, drops an object card for a Loom object link, and otherwise falls back to the internal clipboard. `scripts/canvas-ui/` uses this format to redraw every app screen from the running app (see `docs/canvas/README.md`).
