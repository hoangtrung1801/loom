# Web Mode

Run anytype-ts in a browser without Electron for development and testing.

## Quick Start

```bash
# Start web mode (automatically starts loomHelper and opens browser)
bun run start:web
```

That's it! The script will:
1. Start `loomHelper` with gRPC-web proxy (auto-assigned ports)
2. Start the Vite dev server
3. Open your browser with the correct URL

## Cloud / fresh Linux container

`update.sh` downloads prebuilt middleware from anyproto/anytype-heart, which cloud sandboxes may block. Instead run:

```bash
bash scripts/setup-cloud.sh   # builds loom-heart from source + generates protobuf bindings (~5 min cold)
bun run start:web
```

Notes: `bun install` must use `--ignore-scripts` (the electron `keytar` rebuild needs libsecret). A `Prism before initialization` console error in dev is harmless; the auth screen should still render.

## Using External Server

If you're running `loomHelper` separately (e.g., for debugging):

```bash
# Use an external gRPC-web server
LOOM_USE_SIDE_SERVER=http://127.0.0.1:31008 bun run start:web
```

## Environment Variables

| Variable                   | Description                        | Default                           |
|----------------------------|------------------------------------|-----------------------------------|
| `LOOM_USE_SIDE_SERVER`  | External gRPC-web server URL       | (starts loomHelper)            |
| `WEB_PORT`                 | Dev server port                    | `9090`                            |
| `WEB_DATA_PATH`            | Data storage path for backend      | OS app data (see below)           |

**Default data paths by OS:**
- **macOS**: `~/Library/Application Support/loom/data`
- **Windows**: `%APPDATA%/loom/data`
- **Linux**: `~/.config/loom/data`

## Key Files

| File | Purpose |
|------|---------|
| `electronMock.ts` | Mock implementation of Electron API for browser environment |
| `routeSync.ts` | Syncs memory history with browser URL. Skips intermediate routes (`/main/blank`, `/main/void`), handles cross-space navigation with `replaceState`, blocks browser back after logout |

## Architecture

```
Browser (localhost:9090)
    |
    +-- React App (entry.web.tsx)
    |       |
    |       +-- electronMock.ts (mocks Electron API)
    |
    +-- gRPC-web --> loomHelper (auto-assigned port)
```

## URL Parameters

The browser URL accepts these parameters (auto-configured by start script):

| Parameter   | Description                          |
|-------------|--------------------------------------|
| `server`    | gRPC-web proxy address               |
| `dataPath`  | Data storage path for backend        |

## File Uploads

In web mode, file uploads work via the dev server middleware:

1. Browser selects file via `showOpenDialog`
2. File content is read as base64
3. POST to `/api/web-upload` endpoint
4. Dev server writes file to temp directory
5. Real filesystem path returned to app
6. Backend reads file from that path

## AI Agent

The agent normally runs in Electron's main process. In web mode the dev server runs the same
`electron-agent.js` bundle instead (`webAgentPlugin` in `vite.web.config.ts`; build it first with
`node scripts/build-electron.js`):

1. `electronMock` forwards `agent*` API calls to `POST /api/agent` (same-origin JSON only)
2. Agent events stream back over `GET /api/agent/events?tab=<tabId>` (server-sent events)
3. Config and keys are kept in the dev server's memory and are lost when it stops

## Limitations

- Some Electron-specific features are mocked/no-op
- File system operations go through temp directory proxy
- No native OS integrations (tray, menu bar, etc.)
