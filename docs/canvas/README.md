# Loom UI on canvases

Every screen of the app (54 screens), redrawn as canvas elements from the running app: the real layout, text, font sizes and weights, colors, borders, shadows, SVG icons and pictures. Each screen is a frame of 1280 × 800.

| File | Canvas | Screens | Elements |
|------|--------|---------|----------|
| `ui-screens/1-auth.json` | Auth | Select, Login | 62 |
| `ui-screens/2-main.json` | Main | Page (Welcome, Playground), Type pages (Pages, Tasks, Collections, Bookmarks, Images), Navigation, Version history, Date, Bin, Canvas | 2185 |
| `ui-screens/3-popups.json` | Popups | Search, Keyboard shortcuts, Experience gallery, Export, Confirm, About, Log out, Login key, Create channel, What's new, Share, Command palette | 2287 |
| `ui-screens/4-menus.json` | Menus | Object menu, Channel menu, Text style, Add block (/) | 814 |
| `ui-screens/5-app-settings.json` | App settings | Account, Preferences, Language, Keyboard shortcuts, Pin code, Login key, Local storage, Channels, Sites, API keys, Plugins, Delete vault | 1273 |
| `ui-screens/6-space-settings.json` | Space settings | General, Members, Notifications, Storage, Import (+ Notion, CSV, Obsidian), Export (+ Markdown, Any-Block), Types | 1347 |

Not included: the graph (drawn by a WebGL worker, its pixels can't be read from the DOM).

## Put them on a canvas

1. Create a Canvas object in Loom (one per file).
2. Copy the whole content of a JSON file.
3. Click the canvas and paste (Ctrl/Cmd+V). The elements land at the center of the view and the view zooms to them.

Pictures are embedded as small WebP data URLs, so the files work in any space.

## Regenerate

The drawings come from the app itself, so they follow UI changes. In a cloud container:

```bash
bash scripts/setup-cloud.sh
bun run start:web
```

Then, with the web URL printed by `start:web` (an account must exist in the browser profile; create one in that profile first):

```bash
node scripts/canvas-ui/run.js --url "<web url>" --profile <browser profile dir> [--out dir] [--only text] [--canvas]
```

- `scripts/canvas-ui/screens.js` lists the screens and how to open each one (routes, settings pages, popups) through `window.Loom.Lib` (dev builds only). `run.js` adds auth screens (separate, signed out profile), menus and the canvas page.
- `scripts/canvas-ui/capture.js` turns the current page into elements: backgrounds and borders become stickies, rects and lines (with the exact hex colors, corner radius and box shadows), text nodes become one text element per rendered line (font size, weight, ellipsis where clipped), SVG icons (inline, `background-image`, `<img>`, CSS masks) are sampled into filled freehand shapes, pictures become image elements. Paint order follows CSS stacking (z-index), not just DOM order.
- `--canvas` also creates one Canvas object per file in the running app and pastes the elements into it.
- Sections over about 2400 elements are split into several files.
