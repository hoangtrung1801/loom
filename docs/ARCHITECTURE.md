# Loom architecture

Loom is an Electron app with three layers that never reach around each other:

```
renderer (sandboxed page)  ──IPC──▶  main process  ──messages──▶  core worker thread
React, ProseMirror, boards           windows, menu, protocol,      store (JSON files + in-memory
window.loom: rpc/upload/onEvent      deep links, local API server  SQLite), search, sync, AI, files
```

## Processes and threads

| Piece | File | Job |
|---|---|---|
| Renderer | `src/renderer` | All UI. No Node, no `require`; it sees only `window.loom` from the preload: `rpc`, `upload`, `onEvent`, `ready`, `localApi`. |
| Preload | `src/main/preload.ts` | The bridge above, nothing else. |
| Main | `src/main/main.ts` | Windows, menu, `loom-file://`, `loom://` deep links, settings for this device, the local API server. Holds no data and runs no queries. |
| Core worker | `src/main/core-worker.ts` | Owns the library. Runs `rpc`, uploads, attachment reads, local-API operations, backups and sync. One thread owns the data, so every write is serialized. |
| Core client | `src/main/core-client.ts` | Main's handle on the worker. Calls are matched to replies by id. If the worker dies, pending calls fail with a clear error and a fresh worker starts, up to three times; the page is told through a `core-error` event. |

Keeping the core off the main thread means a long search, an import or an AI loop never stalls window, menu or protocol handling. Attachment bytes are copied once into their own buffer and *transferred* to main, not cloned again.

Every IPC handler is wrapped in `trusted()`, which checks that the call came from the app's own page. `rpc` additionally allows only named methods (`src/core/rpc.ts`).

## Storage: JSON files

Your library is a folder of JSON files, `<data dir>/library/`:

```
loom.json              format marker {format: "loom-json", version, schema}
meta.json              device id, clock, sync and AI settings; mode 0600 (it holds the AI key and sync token)
cards/<id>.json        one file per record, for every synced table, with nested JSON for documents
whiteboards/<id>.json  and a `_clock` map of per-field timestamps that merging needs
placements/…, edges/…, tag_props/…, chats/…, …
ops.jsonl              the change log, one op per line, append-only
outbox.json            ids of ops not yet pushed to the sync server
```

- **Source of truth.** The files are the data. SQLite runs only in memory (`:memory:`), as the query and full-text engine. At startup the files are loaded into it and the derived data (backlinks, to-dos, FTS indexes) is rebuilt; it is never stored.
- **Writes.** All changes go through `Store.tx`. When the outermost transaction commits, every record it touched is rewritten, new ops are appended to `ops.jsonl`, and `meta.json` / `outbox.json` are rewritten if they changed. If the transaction rolls back, nothing is written.
- **Crash safety.** Each file is replaced atomically: written to a temp file, fsynced, then renamed. A crash leaves either the old or the new version. A cut-off last line in `ops.jsonl` is ignored on load. A record file that can't be parsed is skipped (and reported in `store.loaded.skipped`) but left on disk untouched.
- **File names.** Ids that are already safe file names are used as-is. Anything else becomes `x-<sha256>.json`, so an id from another device can never escape its folder.
- **Versioning.** A library whose marker names a newer format or schema is refused with an "update Loom" message instead of being rewritten.
- **Upgrading.** If `<data dir>/loom.db` (the SQLite file older versions used) exists and there is no library yet, it is converted once. The library is built in `library.importing` and renamed into place, so an interrupted import starts over. The database is then renamed to `loom.db.imported`.
- **Cost.** Startup reads every file, and the in-memory database holds the whole library. That is fine for a personal library of tens of thousands of cards. In exchange, the data can be read, diffed, grepped and backed up with ordinary tools.

Attachments are content-addressed blobs in `<data dir>/files/<sha256>`, written once and never rewritten.

## Data model and sync

Every change is an *op*: `{entity, entityId, fields, ts (hybrid logical clock), device}`.

- **Merging.** Ops apply field by field, last write wins by HLC. Merging is idempotent and commutative and needs no coordination; the per-field clocks live in each record's `_clock`.
- **Deletes.** Deletes are soft (`deleted_at`).
- **Validation.** `src/core/entities.ts` is the allow-list of synced tables and fields. Ops from elsewhere are validated against it before they touch anything.
- **Sync.** Sync pushes the outbox and pulls by cursor. Attachments go up and down by SHA-256, and every download is hash-verified before it is stored.

## Backups

The core writes a full snapshot once a day: the newest is checked at startup and then hourly while the app runs.

- **Location.** Each snapshot is one JSON file, `<data dir>/backups/loom-YYYY-MM-DDTHHMMSS.json`, mode 0600.
- **Contents.** Every record with its merge clock, plus settings. The AI key and sync token are left out.
- **Retention.** The newest seven are kept.
- **Manual.** Settings → Backups shows the latest snapshot and has *Back up now*.

## Local automation API and the `loom` CLI

Off by default. Settings → Local API turns it on, and the choice is remembered on this device.

- **Transport.** HTTP on `127.0.0.1` only. It tries port 21345, then the next three, then any free port.
- **Token.** A fresh 32-byte bearer token each time it starts, compared in constant time.
- **Connection file.** Port and token are written to `~/.loom/local-server.json` (or `$LOOM_DATA_DIR/local-server.json`) with mode 0600, and the file is deleted when the server stops.
- **Who it serves.** A request carrying an `Origin` header (a browser page) or a non-local `Host` (DNS rebinding) is refused before the token is even checked.
- **Limits.** 1 MiB bodies, 30 s per request.
- **Routes.** `GET /health`, `GET /operations` (every operation with its JSON Schema), `POST /operations/<name>`.

The server knows nothing about data. Each request becomes a named operation in `src/core/local-api.ts`:

- Input is validated with zod.
- Writes are queued one at a time.
- Operations call the same store and work APIs the UI uses.
- Cards are read and written as markdown.

`src/cli/loom.ts` (built to `dist/cli/loom.cjs`, exposed as the `loom` bin) reads the connection file and calls the operations:

```bash
loom search "spaced repetition"
loom read <card-id>                       # markdown
loom note "Meeting notes" --tag work < notes.md
loom memo "Call the venue tomorrow"
loom task add "Draft the outline" --priority high --due 2026-11-02
loom journal add "Shipped the JSON library"
loom op listTasks '{"overdue": true}'     # any operation, raw JSON in and out
```

## Deep links and window state

- **Deep links.**
  - `loom://card/<id>`, `loom://whiteboard/<id>` and `loom://journal/<YYYY-MM-DD>` open in the running window, or start the app.
  - Ids and dates are checked against strict patterns; anything else is ignored.
  - A link that arrives while the app is starting is held until the page reports `ready`.
  - The scheme is registered for packaged builds, or with `LOOM_REGISTER_PROTOCOL=1`.
- **Window state.** Size, position and maximized state are saved in `<data dir>/settings.json`. A saved position on a display that is no longer attached is dropped, and the window opens at its saved size on the primary screen.

## Comparison with Heptabase's architecture

Heptabase's desktop app taught several of these ideas. Loom adopts these:

- **Data work off the UI.** Heptabase keeps the database out of the renderer. Loom also moves it off the main process, into a worker thread with crash restart.
- **A local automation surface.** Loom has a loopback HTTP API with a CLI for scripts and agents, built around named, schema-described operations rather than raw queries.
- **Deep links and window-state persistence**, with links queued until the page is ready.
- **Regular local snapshots**, kept separate from sync.

Loom deliberately does **not** copy these:

| Heptabase | Loom |
|---|---|
| Strips the page's CSP so arbitrary content can load | A strict CSP on the app page, plus a separate locked-down CSP on every `loom-file://` response |
| Database IPC callable without checking which frame sent it | Every handler checks the sender's origin; `rpc` is a method whitelist |
| Telemetry and device fingerprinting | None. Nothing leaves the machine except sync to your server and AI calls to your endpoint. |
| Data kept inside an application database | Plain JSON files you can read, diff and back up |
