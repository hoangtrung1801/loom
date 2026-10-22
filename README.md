# Loom

A local-first visual note-taking app: write **cards**, arrange them on infinite **whiteboards**, connect them, link them with `[[wikilinks]]`, and search everything instantly. Optional sync between devices through a small self-hosted server.

Loom is an original implementation. It was inspired by the general shape of tools like Heptabase (cards + whiteboards, local SQLite, Electron), but shares no code, assets or branding with any of them.

## Run it

Requires [Bun](https://bun.sh) 1.2+. It's used as package manager, script runner, dev-server and test runner, and it runs the sync server directly from TypeScript. Storage uses the built-in `node:sqlite` (also available in Bun), so there are **no native modules** to rebuild.

```bash
bun install
bun run start                       # build, then launch the Electron app
bun run dev:electron                # hot-reloading renderer inside Electron
bun run dev:electron --no-sandbox   # extra args go to Electron (needed when running as root, e.g. in a container)
bun run dev                         # renderer only, in a normal browser (talks to a dev DB over HTTP)
bun run package                     # installers via electron-builder (AppImage/deb, dmg, nsis)
```

> **What Bun does not run:** the Electron app itself. Electron's main process always uses the Node.js bundled inside Electron, so the shipped app is unaffected by which runtime you develop with.

Bun skips dependency install scripts unless trusted; `package.json` trusts `electron` (downloads its binary) and `esbuild`. `electron-winstaller` (Windows Squirrel installers, unused here) stays blocked.

Using it: double-click empty canvas to make a card · drag a card's header to move it · drag the dot on a card's edge onto another card to connect (double-click a line to label it) · `Ctrl/⌘ K` to search · scroll to pan, `Ctrl/⌘`+scroll to zoom · type `# `, `- `, `> `, `1. `, ` ``` ` for Markdown shortcuts · `[[Card title]]` links to (or creates) a card.

### Sync (optional)

```bash
LOOM_SYNC_TOKEN=choose-a-secret bun run sync-server      # listens on 127.0.0.1:8787 (PORT, LOOM_SYNC_DB to change)
```

Then in the app: sidebar → **Sync**, enter the URL and token. Put it behind HTTPS (e.g. a reverse proxy) before exposing it beyond localhost.

## Architecture

```
src/core      pure TypeScript, no Electron: the whole data model, fully unit-tested
  store.ts      SQLite (node:sqlite) repository + op log + FTS5 search
  entities.ts   allow-list of synced tables/fields + zod schema for ops
  clock.ts      hybrid logical clock
  sync.ts       push/pull engine + HTTP transport
  rpc.ts        the only surface the UI can call (named, whitelisted methods)
src/main      Electron main + sandboxed preload (exposes just `loom.rpc`)
src/renderer  React + Zustand + ProseMirror; whiteboard is DOM + SVG
server        reference sync server (append-only op log over HTTP); run with `bun server/main.ts`
```

**Data & sync.** Every change is an *op*: `{entity, entityId, fields, hlc timestamp, device}`. Ops are applied with per-field last-write-wins ordered by a hybrid logical clock, so merging is idempotent, commutative and needs no coordination. Rows live in ordinary tables (so queries are plain SQL); the `ops` table is the replication log. Deletes are soft (`deleted_at`). The server never interprets ops.

**Search.** FTS5 index of title + body text, rebuilt on every card change (local or remote). Prefix matching so results update as you type.

**Security.** Context isolation + sandbox on; renderer has no Node access; IPC checks the sender's origin and a method whitelist; navigation is locked and links open in the OS browser; strict CSP. Because card content can come from other devices it is treated as untrusted: ops are validated against the field allow-list before touching SQL, link `href`s are limited to http/https/mailto, and the editor schema has no images. Content that can't be parsed opens read-only and is never overwritten.

## Tests

```bash
bun run typecheck
bun run test            # 24 unit tests: store, search, merge/convergence, sync server, RPC
bun run test:e2e        # 11 browser tests (Playwright + Chromium) against the dev server
bun run test:electron   # real Electron under xvfb, incl. two devices syncing via the server
```

## Known limitations

- **Concurrent edits to the *same card body* are last-writer-wins for the whole document** (title, position, tags etc. merge per field). A text CRDT (e.g. Yjs) would merge typing from two devices; this does not.
- Sync has no history compaction, no end-to-end encryption, and a single shared token. The token is stored unencrypted in the local database.
- Renaming a card doesn't rewrite `[[links]]` that point at it.
- No trash/restore UI yet (deletes are soft, so it's possible to add), and no images, PDFs, web cards, mind maps or AI features.
- `node:sqlite` is still flagged experimental by Node/Electron 37; the API surface used here is small and covered by tests.
- Installers other than the unpacked Linux build were configured but not built here.
