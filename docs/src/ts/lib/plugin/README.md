# plugin/ - Plugin system

Obsidian-style plugins: a folder with `manifest.json`, `main.js` and an optional `styles.css` in
`<userData>/plugins/<id>/`. Desktop only (in web mode every call is a no-op). Author-facing docs: `docs/plugin/README.md`.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Public types (`PluginManifest`, `Command`, `ViewDefinition`, `ViewRenderProps`, `SettingTab`, `LoomApi`) and the internal `PluginHost` the registry hands each plugin |
| `plugin.ts` | `Plugin` base class. `register*`/`add*` push disposers; `unloadInternal()` runs `onunload()` and then the disposers in reverse order, a failing step never stops the rest |
| `loader.ts` | `evaluate(id, code)`: runs the CommonJS bundle with `new Function` and a `require` limited to `loom`, `react`, `react-dom`, `mobx`, `mobx-react`; the export must extend `Plugin` |
| `registry.ts` | `PluginRegistry` (exposed as `S.Plugin`, see `store/plugin.ts`): installed plugins, enable/disable/reload, restricted mode, registered views/commands/settings tabs, hotkeys, `guard`/`fail` |
| `api.ts` | `createApi(manifest)`: the `LoomApi` handed to plugins; thin wrappers over `U.Subscription`, `S.Detail`, `C.*`, `U.Object`, `S.Popup` |
| `events.ts` | Tiny emitter. Emitted from `S.Common.themeSet` (`theme-change`) and the editor page open path (`object-open`) |
| `viewBinding.ts` | Which plugin view a dataview view uses, stored in the dataview block `fields` (`pluginViews`, `pluginViewConfig`) and always merged into the current fields |
| `hotkey.ts` | `'Mod+Shift+K'` parsing and conflict lookup against built-in shortcuts |
| `style.ts` | `injectStyle(id, css)` -> `<style data-plugin="id">`, returns the remover |
| `version.ts` | `compareVersions` for `minAppVersion` |
| `loom.d.ts` | Standalone typings for plugin authors (also copied to `docs/plugin/loom.d.ts`) |

## Flow

1. Main process (`electron/ts/plugin.ts`, exposed through `Api` methods `pluginList`, `pluginRead`, `pluginDataLoad`, `pluginDataSave`, `pluginOpenFolder`, `pluginWatch`) lists and reads the files. Manifest validation is the pure `electron/ts/lib/pluginManifest.ts`. A recursive `fs.watch` (debounced 300 ms, ignoring `data.json`) sends `plugins-changed` to every tab of the window.
2. `S.Plugin.init()` runs from `U.Data.onAuthOnce`. Settings `pluginsRestricted` (default `true`) and `pluginsEnabled` live in `Storage`. With restricted mode on no code is evaluated.
3. `load(id)` reads the files, evaluates them, constructs the class with `(app, manifest, host)` and awaits `onload()`. Any throw (onload, command callbacks, event handlers, vanilla renders, settings tab renders) goes through `fail(id, error)`: the plugin is unloaded, the error shows in Settings > Plugins, and it stays off until the next reload.
4. Custom views: `I.ViewType.Custom = 7` is frontend-only (the middleware enum is an open int32). `component/block/dataview/view/custom.tsx` resolves the binding of the current view, renders the plugin component inside `PluginErrorBoundary`, or calls the vanilla `render(el, props)`. `U.Menu.getViews()` appends one entry per registered view (`pluginViewKey`), `menu/dataview/view/layout.tsx` writes the binding and shows the view's `settings`; bindings are cleared on view delete and copied on duplicate.
5. Commands: `popup/command.tsx` (shortcut `commandPalette`, Mod+Shift+P). Plugin hotkeys are checked at the end of `keyboard.onKeyDown`.

## Tests

`registry.test.ts`, `loader.test.ts`, `plugin.test.ts`, `viewBinding.test.ts`, `hotkey.test.ts` (run `bunx vitest run src/ts/lib/plugin`), plus `electron/ts/lib/pluginManifest.test.ts`. The registry takes its dependencies in the constructor so tests run without Electron or the app globals.
