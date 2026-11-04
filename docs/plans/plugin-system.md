# Plugin System (Obsidian-style) — Implementation Plan

Goal: let users customize Loom with code, the way Obsidian plugins do. A plugin is a folder with
`manifest.json`, `main.js`, optional `styles.css`. Plugins can register **custom database views**,
commands, settings tabs, event handlers and styles.

Desktop only (Electron). In web mode the plugin system is a no-op.

---

## 0. Ground rules

- Follow `CLAUDE.md`: tabs, `else\nif`, parenthesised compound conditions, `cn` arrays, `U.Dom.*` helpers,
  no jQuery, no `cursor: pointer`, all UI text through `translate()` with keys added to `src/json/text.json`.
- Do not change existing colors/sizes. New SCSS uses existing CSS variables only.
- Every new React component gets a `*.stories.tsx`.
- `node_modules` may be missing: run `bun install` first. `bun run typecheck`, `bun run lint`, and
  `bunx vitest run src/ts/lib/plugin` must pass at the end. `src/ts/lib/api/service.ts` is generated and
  git-ignored; if typecheck fails only because of that missing file, note it and continue
  (`SKIP_HEART_BUILD=1 bun run generate:protos` needs `protoc`, which may be unavailable).
- **No middleware / proto changes.** (See §3 for how plugin views persist without them.)

## 1. Trust model

- Plugins run in the renderer with access to the `loom` API object only (window already has
  `contextIsolation: true`, `nodeIntegration: false`). CSP already allows `'unsafe-eval'`
  (`electron/json/cors.json`), so `new Function` works.
- **Restricted mode** (default ON): no plugin code is loaded. User must turn it off in
  Settings → Plugins, with a confirm popup warning that plugins run with full access to their data.
- Plugins live in `<userData>/plugins/<id>/` on the device. They are **not synced**.
- Every plugin call into user code is wrapped in try/catch; a throwing plugin is disabled for the session
  and an error is shown in Settings → Plugins. A plugin's view that throws renders an error box, not a
  crash (React error boundary).

## 2. Phase 1 — Core plugin system

### 2.1 Electron main: `electron/ts/plugin.ts` (new)
Class `PluginManager` (singleton default export):
- `dir()` → `path.join(app.getPath('userData'), 'plugins')`, created on demand.
- `list()` → `[{ manifest, dir, hasStyles, error? }]`: reads each sub-folder's `manifest.json`, validates
  (`id` matches `/^[a-z0-9-]+$/` and equals folder name, `name`, `version`, `minAppVersion?`,
  `description?`, `author?`). Invalid ones are returned with `error`.
- `read(id)` → `{ main: string, styles: string }` (UTF-8). Reject ids that fail the regex (path traversal).
- `dataLoad(id)` / `dataSave(id, obj)` → `<dir>/<id>/data.json` (JSON, write atomically: tmp + rename).
- `openFolder()` → `shell.openPath(dir())`.
- `watch(win)`: `fs.watch(dir, { recursive: true })` debounced 300 ms → `Util.send(win, 'plugins-changed')`
  (use the same send helper other main→renderer events use, e.g. look at how `power-state` or
  `link-approval-decision` events are sent via `WindowManager`). Stop on window close.

Expose in `electron/ts/api.ts` as methods on the `Api` object (they get `win` as first arg, same as
existing methods): `pluginList`, `pluginRead`, `pluginDataLoad`, `pluginDataSave`, `pluginOpenFolder`,
`pluginWatch`. Register the `plugins-changed` channel wherever other renderer-bound channels are
whitelisted in `electron/js/preload.cjs` (check how existing `on(...)` channels are allowed).

### 2.2 Renderer: `src/ts/lib/plugin/` (new)
- `types.ts` — public types: `PluginManifest`, `Command`, `ViewDefinition`, `ViewRenderProps`,
  `SettingTab`, `EventName`, `LoomApi`.
- `plugin.ts` — `export class Plugin` (base class users extend):
  - `app: LoomApi`, `manifest: PluginManifest`
  - lifecycle: `onload(): void | Promise<void>`, `onunload(): void`
  - `registerView(type: string, def: ViewDefinition)`
  - `addCommand(cmd: Command)` — `{ id, name, icon?, hotkey?: string, callback?(), checkCallback?(checking: boolean): boolean }`
  - `addSettingTab(tab: SettingTab)` — `{ name?, render(container: HTMLElement): void | (() => void) }` or
    `{ component: React.FC<{ plugin }> }`
  - `registerEvent(name: EventName, cb)` and `register(disposer: () => void)`
  - `addStyle(css: string)` (injects `<style data-plugin="id">`)
  - `loadData()` / `saveData(obj)`
  - All `register*`/`add*` push disposers into an internal list; `unloadInternal()` runs `onunload()` then
    every disposer in reverse order.
- `api.ts` — builds the `LoomApi` object handed to plugins (thin wrappers over existing code; reuse
  `C.*` commands, `S.*` stores, `U.Object`, `U.Data`, `U.Subscription` helpers — do not duplicate logic):
  - `app.version`, `app.theme()` (`'light'|'dark'`), `app.notice(text)` (use existing toast/notification util)
  - `app.space.id()` (current space id from `S.Common.space`)
  - `app.objects.search({ query?, filters?, sorts?, limit? })` → plain detail objects
    (use the existing `U.Subscription.search`/`C.ObjectSearch` helper)
  - `app.objects.get(id)` → details from `S.Detail`
  - `app.objects.open(id)` → `U.Object.openAuto({ id, layout })`
  - `app.objects.update(id, key, value)` → `C.ObjectListSetDetails` (or existing set-detail helper)
  - `app.objects.create(details, typeKey?)` → existing object-create helper
  - `app.ui.openPopup`/`app.ui.confirm(title, text): Promise<boolean>` (use the existing `confirm` popup)
  - `app.React` and `app.mobx` (the app's instances, so plugin JSX shares React)
- `events.ts` — tiny emitter. Emit from existing code: `theme-change` (where theme is set in
  `S.Common`), `object-open` (in the router/page open path), `records-change` (not global — views get
  live props instead). Keep it minimal: only emit where a single obvious hook point exists.
- `loader.ts` — `evaluate(id, code)`:
  ```ts
  const module = { exports: {} };
  const require = (name) => {
  	switch (name) {
  		case 'loom': return sdk;          // { Plugin, ...types-runtime }
  		case 'react': return React;
  		case 'react-dom': return ReactDOM;
  		case 'mobx': return mobx;
  		case 'mobx-react': return mobxReact;
  	};
  	throw new Error(`Plugin ${id}: cannot require "${name}"`);
  };
  new Function('module', 'exports', 'require', `${code}\n//# sourceURL=plugin:${id}/main.js`)(module, module.exports, require);
  const Ctor = module.exports.default || module.exports;
  ```
  Validate `Ctor.prototype instanceof Plugin`.
- `registry.ts` — MobX store `PluginRegistry` (export singleton, also add to `S` as `S.Plugin` if the store
  index pattern allows — see `src/ts/store/index.ts`):
  - observable `plugins: Map<id, { manifest, enabled, loaded, error }>`, `views`, `commands`, `settingTabs`
  - `init()` — called once after login/space load (find where other post-auth services start, e.g.
    in `app.tsx` or `U.Data.onAuth`). If restricted mode is off, load every enabled plugin.
  - `enable(id)`, `disable(id)`, `reload(id)`, `reloadAll()`; listens to `plugins-changed` and reloads.
  - `getView(key)` where key = `${pluginId}:${type}`; `getViews()` for menus.
  - persisted settings in `Storage` (`src/ts/lib/storage.ts`): `pluginsRestricted` (default `true`),
    `pluginsEnabled: string[]`.
- `index.ts` — re-exports; `sdk` object = `{ Plugin }`.

### 2.3 Settings → Plugins page
- Sidebar: add `{ id: 'plugins', iconParam: { name: 'settings/api' } }` next to `'api'` in
  `src/ts/component/sidebar/page/settings/index.tsx` (reuse an existing icon; do not create new art).
- Page `src/ts/component/page/main/settings/plugins.tsx` (+ stories), registered in
  `page/main/settings/index.tsx` `Components` as `plugins`:
  - Restricted mode switch (turning off → confirm popup).
  - List of installed plugins: name, version, author, description, enable switch, error text,
    "Options" button when the plugin registered a setting tab.
  - Buttons: "Open plugins folder", "Reload plugins".
  - Empty state text explaining where to put plugins, linking to the docs.
- Plugin settings tab: page `settings/pluginSettings.tsx` with `pluginId` param, rendering the tab
  (`render(container)` into a ref'd div with cleanup, or the `component`).
- SCSS in `src/scss/page/main/settings/plugins.scss` (or matching existing settings scss location) using
  existing setting row classes as much as possible.

## 3. Phase 2 — Custom database views

### 3.1 Persistence without proto changes
- Add `Custom = 7` to `I.ViewType` (`src/ts/interface/block/dataview.ts`). Middleware enums are open
  `int32` (Timeline=6 already works this way), so the value round-trips. Old clients fall back to Grid
  via the existing `default:` branch.
- Which plugin view a dataview view uses is stored in the **dataview block's `fields`** (synced Struct):
  `fields.pluginViews = { [viewId]: 'pluginId:viewType' }`, written with `C.BlockSetFields` (merge with
  existing fields, never overwrite other keys). Add helpers in `src/ts/lib/plugin/viewBinding.ts`:
  `getBinding(rootId, blockId, viewId)`, `setBinding(rootId, blockId, viewId, key)`, `clearBinding(...)`.
  Clear the binding when the view type changes away from Custom or the view is removed.

### 3.2 Rendering
- `src/ts/component/block/dataview/view/custom.tsx` (+ stories), `forwardRef<I.ViewRef, I.ViewComponent>`:
  - Resolves the binding → registry view definition (observer, so it updates when plugins load).
  - Missing plugin → empty state: "This view needs plugin “{key}”" + button to Settings → Plugins.
  - Renders inside an error boundary. Definition shape:
    ```ts
    interface ViewDefinition {
    	name: string;
    	icon?: string;                 // existing icon name, optional
    	component?: React.FC<ViewRenderProps>;
    	render?(el: HTMLElement, props: ViewRenderProps): void | (() => void);   // vanilla alternative
    	settings?: { id: string; name: string; type: 'switch' | 'text' | 'select'; options?: { id: string; name: string }[]; default?: any }[];
    };
    interface ViewRenderProps {
    	records: any[];                // plain detail objects for current records (from getRecords + S.Detail)
    	relations: { key: string; name: string; format: number }[];   // visible relations
    	view: { id: string; name: string };
    	config: Record<string, any>;   // plugin view settings, see below
    	readonly: boolean;
    	open(id: string): void;
    	update(id: string, key: string, value: any): void;   // via props.onCellChange
    	create(details?: any): void;                         // via props.onRecordAdd
    	loadMore(): void;                                    // via props.loadData
    	hasMore: boolean;
    };
    ```
  - Plugin view settings stored alongside the binding: `fields.pluginViewConfig = { [viewId]: {...} }`.
- `dataview.tsx` switch (~line 1727): `case I.ViewType.Custom: ViewComponent = ViewCustom;`.
  Add Custom to any `[ Calendar, Timeline, Graph, Board ].includes(view.type)` lists only if behaviour
  requires it (check `dataview.tsx:257` — custom views should load records like Grid/List).
- Empty-records handling: let the plugin decide (pass empty `records`).

### 3.3 Menus
- `U.Menu.getViews()` (`src/ts/lib/util/menu.ts:436`): append one entry per registered plugin view:
  `{ id: I.ViewType.Custom, pluginViewKey, name: def.name }` (only when restricted mode is off).
  Find every consumer of `getViews()` (view-type picker in `menu/dataview/view/layout.tsx`, view create
  menus) and make selecting a plugin entry set `type = Custom` **and** write the binding. Selected state
  compares both type and binding key.
- `menu/dataview/view/layout.tsx` `getSections()`: when `isCustom`, render the definition's `settings`
  as switch/input/select rows writing to `pluginViewConfig`.
- Translation keys: `viewName7` = "Custom", plus all new strings.

## 4. Phase 3 — Commands, hotkeys, events, styles

- **Command palette**: new popup `src/ts/component/popup/command.tsx` (+ stories, register in
  `popup/index.tsx`) — filter input + list of commands (plugin commands now; designed so core commands
  can be added later). Arrow keys/Enter/Escape. `checkCallback(true)` hides unavailable commands.
  Shortcut: add `commandPalette` to `src/json/shortcut.ts` using `Mod+P` if free (grep shortcut.ts for
  conflicts; else `Mod+Shift+P`) and handle it in `lib/keyboard.ts` next to the `search` shortcut.
- **Plugin hotkeys**: `Command.hotkey` like `'Mod+Shift+K'`; registry keeps a map, `keyboard.ts` checks it
  after built-in shortcuts (built-ins win, conflicts logged once).
- **Styles**: `styles.css` injected on load, removed on unload; `addStyle` same mechanism.
- **Events**: as in §2.2.

## 5. Phase 4 — Developer experience, docs, tests

- `src/ts/lib/plugin/loom.d.ts` — standalone public typings (`declare module 'loom' { ... }`) mirroring
  `types.ts`; also copied to `docs/plugin/loom.d.ts` for plugin authors.
- Sample plugin `docs/plugin/sample/` with `manifest.json`, `main.js` (plain CommonJS, no build step,
  uses `app.React.createElement`) implementing a **"Progress" view** (one bar per record from a
  number/checkbox relation chosen in view settings), a command "Sample: say hello", a settings tab and
  `styles.css`. Plus `docs/plugin/README.md`: install path per OS, manifest fields, API reference,
  lifecycle, restricted mode, debugging (DevTools, `sourceURL=plugin:<id>/main.js`), esbuild recipe for
  TS/JSX plugins (`external: ['loom','react','mobx','mobx-react','react-dom']`, `format: 'cjs'`).
- `docs/src/ts/lib/plugin/README.md` for the internal architecture; link from `CLAUDE.md`'s directory
  documentation list and from `docs/src/ts/lib/README.md`.
- Vitest tests (`src/ts/lib/plugin/*.test.ts`, follow `src/ts/test/setup.ts`):
  loader (exports default / module.exports, unknown require throws, non-Plugin rejected),
  Plugin disposers run in reverse on unload, registry enable/disable/reload, command `checkCallback`,
  view binding merge does not clobber other block fields, error in `onload` marks plugin errored.
- Electron `plugin.ts`: id validation and manifest validation unit tests if there's an existing electron
  test setup; otherwise keep validation in a pure function and test that.

## 6. Order of work / commits

1. Phase 1 (main + preload + lib/plugin core + settings page) → commit.
2. Phase 2 (Custom view type, binding, ViewCustom, menus) → commit.
3. Phase 3 (palette, hotkeys, styles, events) → commit.
4. Phase 4 (typings, sample, docs, tests) → commit.
Run `bun run typecheck` and `bun run lint` before each commit; fix what you introduced.
