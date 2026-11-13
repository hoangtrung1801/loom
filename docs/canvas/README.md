# Loom UI screens on a canvas

Wireframes of every Loom screen (68 screens), drawn as canvas elements so they can be dropped onto a Loom Canvas object.

| File | Screens | Elements |
|------|---------|----------|
| `ui-screens/1-auth.json` | Select, Login, Onboarding (Key, Email, Use case), Setup, Pin check, Deleted, Migration | 91 |
| `ui-screens/2-main.json` | Editor, Set (grid, board, gallery, calendar), Type page, Canvas, Graph, Chat, 1:1 chat, All Objects, Media, Date, Relation, History, Bin, Navigation, Invite, Import, Blank, Vault | 1572 |
| `ui-screens/3-settings.json` | App settings (Account … Plugins) and space settings (General … Delete) | 1070 |
| `ui-screens/4-popups.json` | Search, Gallery, Confirm, Export, Share, Add property, Shortcuts, What's new, About, Logout, Key, Preview, Cover picker | 1037 |
| `ui-screens/5-menus.json` | Block menus, object and dataview menus, widget menu | 325 |

One file per section keeps each canvas well under the soft limit of 2500 elements.

## Use

1. Create a Canvas object in Loom (one per file).
2. Copy the whole content of a JSON file.
3. Click the canvas and paste (Ctrl/Cmd+V). The elements are inserted at the center of the view, selected, and the view zooms to them.

## Regenerate

```bash
node scripts/generate-canvas-ui-screens.js
```

The generator draws with a few primitives (`box`, `label`, `circle`, `line`, `button`, `input`, `menu`) and shared parts (left sidebar, header, right sidebar, popup over a dimmed app). Each screen is a `frame` named after the screen.
