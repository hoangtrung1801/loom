---
name: loom-plugin
description: Write, scaffold, debug or review a Loom plugin (manifest.json, main.js, custom database views, commands, settings tabs, data.json). Use when the user asks to create or change a Loom plugin.
---

# Loom Plugin Skill

Loom plugins are Obsidian-style: a folder with `manifest.json`, `main.js` and an optional `styles.css`. They are desktop-only and stored per device. Source of truth for the API: `docs/plugin/README.md`, typings `docs/plugin/loom.d.ts`, working example `docs/plugin/sample/`, implementation `src/ts/lib/plugin/` (overview in `docs/src/ts/lib/plugin/README.md`). Re-read these before writing, the API may have grown.

## Workflow

1. Read `docs/plugin/README.md` and `docs/plugin/sample/main.js`.
2. Create the folder `<plugin-id>/` with the files below. The folder name MUST equal the manifest `id`.
3. Tell the user how to install and reload (see "Install and test").
4. If you changed the plugin system itself (not a plugin), update `docs/plugin/README.md`, `docs/plugin/loom.d.ts` and `src/ts/lib/plugin/loom.d.ts` together, and follow the repo code style in `CLAUDE.md` (tabs, `else` + linebreak + `if`).

## manifest.json

```json
{ "id": "my-plugin", "name": "My Plugin", "version": "1.0.0", "minAppVersion": "0.54.0", "description": "...", "author": "..." }
```

`id` (`/^[a-z0-9-]+$/`), `name` and `version` are required; the rest is optional. `minAppVersion` stops loading on older apps.

## main.js

CommonJS. Export a class extending `Plugin`. The only `require`-able modules are `loom`, `react`, `react-dom`, `mobx`, `mobx-react` (the app's own instances); never bundle React. No other `require`, no Node APIs.

```js
const { Plugin } = require('loom');

module.exports = class extends Plugin {
	async onload () {
		this.addCommand({ id: 'hello', name: 'Say hello', callback: () => this.app.notice('Hello') });
	};
	onunload () {};
};
```

Everything registered via `register*` / `add*` is removed automatically after `onunload()` in reverse order. Use `this.register(disposer)` for your own cleanup (timers, listeners). A throw in `onload`, a command, an event handler or a render disables the plugin for the session and shows the error in Settings > Plugins, so guard risky async work.

## Plugin API (`this`)

- `registerView(type, def)`: custom database view, addressed as `<plugin id>:<type>`.
- `addCommand({ id, name, icon?, hotkey?, callback | checkCallback(checking) })`: palette (`Mod+Shift+P`). `Mod` = Cmd/Ctrl. Built-in hotkeys win on conflict.
- `addSettingTab({ name, render(container) -> cleanup | component })`.
- `registerEvent('theme-change' | 'object-open', cb)`.
- `addStyle(css)`; `styles.css` is injected automatically.
- `loadData()` / `saveData(obj)`: persists to `data.json` in the plugin folder (local to the device, never synced). `loadData()` returns an object; merge before saving: `saveData({ ...data, key })`.

## LoomApi (`this.app`)

`version`, `theme()`, `notice(text)`, `space.id()`, `objects.search({ query, filters, sorts, limit })`, `objects.get(id)` (sync, already loaded or `null`), `objects.getById(id)` (async), `objects.open(id)`, `objects.update(id, key, value)`, `objects.create(details, typeKey)`, `ui.openPopup(id, param)`, `ui.confirm(title, text)`, `React`, `mobx`.

## Custom database views

```js
this.registerView('progress', {
	name: 'Progress',
	settings: [ { id: 'relation', name: 'Property key', type: 'text', default: 'done' } ], // switch | text | select (options: [{id,name}])
	component: (props) => this.app.React.createElement('div', null, props.records.length),
	// or vanilla: render: (el, props) => { ...; return () => {}; }
});
```

Props: `records` (plain detail objects), `relations` (`{ key, name, format }`), `view`, `config` (settings with defaults), `readonly`, `hasMore`, `open(id)`, `update(id, key, value)`, `create(details?)`, `loadMore()`. Respect `readonly`. Handle empty `records`. The user picks the view in the view settings layout picker; the binding syncs with the object, and devices without the plugin show "This view needs plugin". Use `this.app.React.createElement` (or JSX bundled with `jsx: 'transform'`).

## TypeScript / JSX

Copy `docs/plugin/loom.d.ts` next to the source and bundle with esbuild: `format: 'cjs'`, `platform: 'browser'`, `bundle: true`, `external: ['loom','react','react-dom','mobx','mobx-react']`, `jsx: 'transform'`, output `main.js`.

## Styling

Style in `styles.css` using unique class prefixes (e.g. `.myPluginRow`) so you do not collide with app styles. Use the app's CSS variables (`--color-text-*`, `--color-bg-*`, `--color-shape-*`) so dark mode works; do not hardcode colors. Do not use `cursor: pointer`.

## Install and test

1. Settings > Plugins > "Open plugins folder" (macOS `~/Library/Application Support/loom/plugins/`, Windows `%APPDATA%\loom\plugins\`, Linux `~/.config/loom/plugins/`; exact path depends on build channel).
2. Copy the plugin folder in. Changes reload automatically (debounced; `data.json` is ignored), or use "Reload plugins".
3. Turn off restricted mode (on by default, no plugin code runs while on) and enable the plugin.
4. Debug in DevTools (`Alt+Cmd/Ctrl+I`); code appears as `plugin:<id>/main.js`. Errors also show in Settings > Plugins.

## Checklist

- Folder name equals manifest `id`; manifest valid.
- Only allowed `require`s; no leftover `console.log` noise.
- All resources registered through `register*`/`add*` or `this.register`.
- Views handle empty data and `readonly`.
- Works in light and dark theme.
