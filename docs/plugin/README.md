# Loom plugins

A plugin is a folder with a manifest, a script and optionally a stylesheet. Plugins can register custom
database views, commands (with hotkeys), settings tabs, event handlers and styles. They are desktop-only and are
stored on the device, never synced.

```
<plugins folder>/
	my-plugin/
		manifest.json
		main.js
		styles.css      (optional)
		data.json       (created by loadData/saveData)
```

## Install

1. Open Settings > Plugins and press "Open plugins folder", or use the path for your OS:
   - macOS: `~/Library/Application Support/loom/plugins/`
   - Windows: `%APPDATA%\loom\plugins\`
   - Linux: `~/.config/loom/plugins/`
   The exact location depends on the build channel, the button always opens the right one.
2. Copy the plugin folder in. The folder name must equal the manifest `id`.
3. Turn off restricted mode (see below) and enable the plugin. Changes in the folder reload plugins automatically
   (also available as "Reload plugins").

The folder `docs/plugin/sample/` is a complete working example.

## Restricted mode

Restricted mode is on by default and no plugin code is loaded while it is on. Turning it off asks for confirmation:
plugins run inside the app with full access to your data and everything the `loom` API offers, so only enable
plugins from authors you trust. A plugin that throws is disabled for the session and its error is shown in
Settings > Plugins.

## manifest.json

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Lowercase letters, digits and dashes (`/^[a-z0-9-]+$/`). Must equal the folder name. |
| `name` | yes | Shown in Settings and in the view picker. |
| `version` | yes | Free-form, usually semver. |
| `minAppVersion` | no | The plugin is not loaded on an older app. |
| `description` | no | |
| `author` | no | |

## main.js

`main.js` is a CommonJS module. It exports a class that extends `Plugin`. The only modules it can `require` are
`loom`, `react`, `react-dom`, `mobx` and `mobx-react` (these are the app's own instances).

```js
const { Plugin } = require('loom');

module.exports = class extends Plugin {
	async onload () {
		this.addCommand({ id: 'hello', name: 'Say hello', callback: () => this.app.notice('Hello') });
	};

	onunload () {};
};
```

### Lifecycle

`onload()` runs when the plugin is enabled or the app starts with restricted mode off. `onunload()` runs when it is
disabled, reloaded or restricted mode is turned on. Everything registered through `register*` / `add*` is removed
automatically after `onunload()`, in reverse order of registration. If `onload()` throws, the plugin is marked as
failed and everything it registered is removed.

### Plugin API

| Member | Description |
|--------|-------------|
| `app` | The `LoomApi` object (below). |
| `manifest` | The parsed manifest. |
| `registerView(type, def)` | Adds a database view type. Addressed as `<plugin id>:<type>`. |
| `addCommand(cmd)` | Adds a command to the command palette (`Mod+Shift+P`). |
| `addSettingTab(tab)` | Adds an options page, reachable through "Options" in Settings > Plugins. |
| `registerEvent(name, cb)` | Subscribes to an app event. |
| `register(disposer)` | Runs `disposer` on unload. |
| `addStyle(css)` | Injects CSS (`<style data-plugin="id">`), removed on unload. `styles.css` is injected automatically. |
| `loadData()` / `saveData(obj)` | Reads and writes `data.json` in the plugin folder. |

### LoomApi (`this.app`)

| Member | Description |
|--------|-------------|
| `version` | App version. |
| `theme()` | `'light'` or `'dark'`. |
| `notice(text)` | Shows a toast. |
| `space.id()` | Current space id. |
| `objects.search({ query, filters, sorts, limit, keys })` | Searches objects of the current space, resolves with plain detail objects. `keys` adds detail keys to the default ones. |
| `objects.get(id)` | Details already loaded in the app, or `null`. |
| `objects.getById(id)` | Loads details, resolves `null` after 5 seconds without an answer. |
| `objects.open(id)` | Opens an object. |
| `objects.update(id, key, value)` | Sets one detail (property) of an object. |
| `objects.create(details, typeKey)` | Creates an object, resolves with its details. |
| `ui.openPopup(id, param)` | Opens one of the app popups. |
| `ui.confirm(title, text)` | Confirm popup, resolves with the answer. |
| `React`, `mobx` | The app's instances, so plugin components share React. |

### Commands

```js
this.addCommand({
	id: 'archive-done',
	name: 'Archive done tasks',
	hotkey: 'Mod+Shift+D',
	checkCallback: (checking) => {
		const ok = this.app.objects.get('some-id') !== null;
		if (ok && !checking) { /* do the work */ }
		return ok;
	},
});
```

Use `callback()` for a command that is always available, or `checkCallback(checking)` to hide it when it cannot
run: the palette calls it with `checking = true` and only runs the command by calling it again with `false`.
`hotkey` uses `Mod` for Cmd (macOS) or Ctrl. Built-in shortcuts always win; a conflict is logged once in the console
and the plugin hotkey is ignored.

### Custom views

```js
this.registerView('progress', {
	name: 'Progress',
	icon: 'dataview/view/list',
	settings: [ { id: 'relation', name: 'Property key', type: 'text', default: 'done' } ],
	component: (props) => this.app.React.createElement('div', null, props.records.length),
	// or, without React:
	// render: (el, props) => { el.textContent = props.records.length; return () => {}; },
});
```

The view props are `records`, `relations`, `view`, `config`, `readonly`, `hasMore`, `open(id)`, `update(id, key, value)`,
`create(details?)`, `menu(e, id)` and `loadMore()`. `create()` runs the app's usual "new record" flow; `create(details)`
creates a record of the view's type with those details without opening it and resolves with its details. `menu(e, id)`
opens the app's object context menu for a record. Users pick the view in the layout picker of the view settings; the choice is stored in the
dataview block fields (`pluginViews`, `pluginViewConfig`), so it syncs with the object. A device without the plugin
shows a "This view needs plugin" message instead. A view that throws renders an error box.

### Events

| Name | Arguments |
|------|-----------|
| `theme-change` | `'light' \| 'dark'` |
| `object-open` | `{ id }`, when an object is opened in the editor |

## TypeScript and JSX

`loom.d.ts` (in this folder) declares the `loom` module. Bundle with esbuild; the app provides the shared modules:

```js
require('esbuild').build({
	entryPoints: [ 'src/main.tsx' ],
	outfile: 'main.js',
	bundle: true,
	format: 'cjs',
	platform: 'browser',
	external: [ 'loom', 'react', 'react-dom', 'mobx', 'mobx-react' ],
	jsx: 'transform',
});
```

## Debugging

Open DevTools (the DevTools menu item or `Alt+Cmd/Ctrl+I`). The code is evaluated with `//# sourceURL=plugin:<id>/main.js`, so it
appears under that name in the Sources panel and in stack traces. Errors thrown by `onload`, commands, event handlers
and vanilla renders are also shown in Settings > Plugins.
