# electron/ - Electron Main Process

Electron main process files for desktop app integration. TypeScript source in `ts/` is bundled into `electron.js` at the project root via `scripts/build-electron.js`.

## TypeScript Source (`ts/`)

- `main.ts` - Main entry point: app lifecycle, window creation, IPC handlers, signal handling, publishes `global.serverAddress` and `global.localApiSecret` for renderers
- `api.ts` - IPC API handlers for renderer-to-main communication
- `config.ts` - App configuration management
- `menu.ts` - Native application menu (File, Edit, View, etc.)
- `server.ts` - Local gRPC server management (loomHelper): spawn, stdin parent lifeline (`secret <base64url>` first, then `shutdown`), graceful stop
- `update.ts` - Auto-update logic (`electron-updater`, GitHub provider: `build.*.publish` in `package.json` points at the repo's releases). Releases are published as GitHub pre-releases, so `allowPrerelease` is on and the default channel is passed as `null` (`lib/updateChannel.ts`): with an explicit `latest` channel the provider would match no release. The installed app's version must equal the release tag, which `loom-app.yml` sets from `inputs.tag` (`npm pkg set version`); `release.yml` publishes `latest*.yml` and `*.blockmap` with the installers and merges the two per-arch macOS files into one `latest-mac.yml` (`scripts/merge-update-metadata.js`). macOS cannot install an update from an unsigned app, so there the feed is published but unused until builds are signed
- `util.ts` - Utility functions (paths, platform detection, logging)
- `window.ts` - Window management (create, close, focus, tabs, local-link approval window)
- `download.ts` - Gateway file downloads: queues transfers one at a time (electron-dl reports concurrent ones over each other), broadcasts per-file progress and one terminal event, cancels a running or queued transfer by id, and reuses a copy already on disk instead of transferring again. A `temporary` request — a file being opened rather than saved — is given a folder of its own under `openedRoot()` (`<temp>/anytype/open/<objectId>`) and overwritten there, so its path is the same on every open; `prune()` sweeps folders untouched for a week and runs on app ready
- `checksum.ts` - Reproduces the middleware's file checksum (`sha256` + an encrypted/plain marker byte, base32 hex-alphabet, unpadded) so a local file can be proven to be an object's own content
- `downloadLedger.ts` - Remembers where each object was last downloaded (`electron-json-storage`, bounded to 500 entries), so recognising an untouched copy costs a `stat` rather than a hash
- `linkApproval.ts` - Local-link pairing prompts: deduplicates requests, queues prompts, validates user-chosen space grants, updates the space catalog, and keeps BAD_INPUT responses open for correction
- `agent/` - The in-app AI agent, run in the main process so provider keys and requests never reach the renderer. Built as its own bundle, `electron-agent.js` (second target in `scripts/build-electron.js`, listed in `package.deps.json` and the builder `files`), and `require`d by `api.ts` on first use so pi and its provider SDKs (~1.9 MB) cost nothing at startup; a dynamic `import()` would not defer them, because esbuild hoists the ESM packages into the main bundle. `AgentService` (`index.ts`) keeps one `AgentSession` per chat; a session wraps a pi `Agent` (`@earendil-works/pi-agent-core`, models via `pi-ai`: Anthropic or one OpenAI-compatible endpoint) and adds the approval gate for non-read-only tools (`beforeToolCall`), a 25-turn cap, result truncation and history trimming (`policy.ts`). Tools come from Loom's own MCP endpoint (`POST /mcp/{large|small}` on the local API) through `pi-mcp` (`mcp.ts`; reconnects once when the server drops the session), plus two app tools answered by the renderer (`appTools.ts`: `loom_get_context`, `loom_open_object`). Settings in safe storage (`config.ts`); the provider key and the agent's local API key sit in the OS keychain. `api.ts` exposes `agentStatus`, `agentSetConfig`, `agentSetProviderKey`, `agentSetLocalKey`, `agentRun`, `agentStop`, `agentSteer`, `agentApprove`, `agentAppToolResult`, `agentReset`; events reach the starting tab as `agentEvent`
- `safeStorage.ts` - Electron safe storage wrapper
- `types.ts` - TypeScript type definitions
- `userData.ts` / `userDataInit.ts` - The user-data folder is `<app data>/loom` (`~/.config/loom`, `~/Library/Application Support/loom`, `%APPDATA%\loom`; account data under `data/`). `userDataInit.ts` is `main.ts`'s first import, because modules read `userData` while loading; on first launch it moves an older `anytype` folder's contents across, entry by entry, never over an existing entry, and keeps using the old folder if the account data could not be moved

### Libraries (`ts/lib/`)
- `installNativeMessagingHost.ts` - Installs native messaging host manifest for the Chrome/Firefox Web Clipper extension. Registers `com.anytype.desktop` on macOS, Linux, and Windows.

## JavaScript (`js/`)
- `preload.cjs` - Preload script for renderer process security

## JSON Configuration (`json/`)
- `constant.json` - Enabled languages list (26 locales)
- `cors.json` - CORS whitelist for allowed domains

## Images (`img/`)
- `icon.icns` - macOS app icon bundle
- `icons/` - App icons at multiple resolutions (16x16 through 1024x1024 PNG, 256x256 ICO)
- `iconTrayBlack.png` - Black tray icon
- `iconTrayWhite.png` - White tray icon
- `iconTrayTemplate.png` - macOS template tray icon (1x)
- `iconTrayTemplate@2x.png` - macOS template tray icon (2x)

## Build Hooks (`hook/`)
- `afterpack.js` - Post-packaging hook
- `aftersign.js` - Post-signing hook
- `beforebuild.js` - Pre-build hook
- `locale.js` - Locale generation
- `sign.js` - Code signing
- `switch-manifest.js` - Switch extension manifest between Firefox and Chromium
- `util.js` - Shared hook utilities

## macOS
- `entitlements.mac.plist` - macOS code signing entitlements (JIT, unsigned memory, dyld, library validation)

## Important: `__dirname` in Bundled Code

Since all `ts/` files are bundled into `electron.js` (and the agent into `electron-agent.js`) at the project root, `__dirname` resolves to the project root at runtime -- not to the original source file location. All path references must account for this (e.g., `path.join(__dirname, 'dist', ...)` not `path.join(__dirname, '..', '..', 'dist', ...)`).
