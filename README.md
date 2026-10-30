<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/loom-wordmark-dark.svg">
    <img src="assets/brand/loom-wordmark.svg" alt="Loom" height="56">
  </picture>
</h1>

A local-first visual note-taking app in the spirit of Heptabase: write **cards**, arrange them on infinite **whiteboards**, link them, tag them into **databases**, and ask an **AI** that reads your own notes and cites what it used. Everything lives on your machine as plain JSON files, one per card, whiteboard and object; syncing between devices through a small self-hosted server is optional.

Loom is an original implementation. It follows the *concepts* described in Heptabase's public documentation (fundamental elements, user-interface logic, use cases) and applies the same ideas to its AI context handling, but shares no code, assets or branding with it.

## What's in it

| Area | What you get |
|---|---|
| **Cards** | Twelve kinds: note, journal, PDF, image, video, audio, file, highlight, web (clipped pages), and the three below. Every block has a stable id. `/` block menu (headings, lists, to-dos, toggles, tables, callouts, code, math, dates, media), `@` to link a card or a single block, `[[wikilinks]]`, backlinks with the linking block, version history, tasks collected from every card. |
| **Tasks, links, memos** | Three more kinds of knowledge, modelled on [Know-Me](https://github.com/hoangtrung1801/know-me). They are cards, so they sit on whiteboards, take tags, show backlinks, appear in search, export, sync and reach the AI like any other card. **Tasks**: status (to do / in progress / in review / done / blocked / on hold), priority, assignee, due date, labels (tags), subtasks, acceptance criteria and plan as to-do lists; a Kanban board (drag between columns) and a list view with filters. **Links**: paste an address and Loom reads the title, description and preview image from a public page (SSRF-guarded), suggests tags when AI is configured (reusing your existing tags), and treats tracking-parameter variants of a URL as the same link. **Memos**: type, Enter, saved; later turn one into a note or a task. |
| **Whiteboards** | Infinite canvas with pan/zoom, cards placed on many boards at once, sub-whiteboards, **sections** that carry what's inside them, text, **mind maps** (Tab adds a child), colours, connections with labels/styles/arrows, box select, duplicate (`Ctrl/⌘ D`), arrow-key nudging, undo/redo, in-board search (`Ctrl/⌘ F`), paste or drop images and files to create cards. |
| **Apps** (left sidebar) | Inbox · Journal · Whiteboards · Card Library · Tag Database · Tasks · Links · Memos · Highlights · Chat · Trash · Settings. |
| **Tabs** | A tab strip above the page; pinned tabs and their folders stay in the sidebar; tab groups, drag to reorder, state restored on launch. |
| **Look** | "Ink & Thread": near-monochrome ink on warm paper, one teal accent for selection, AI and sync, colour-coded card kinds, Geist and Geist Mono bundled locally, light and dark themes that follow the system. |
| **Side panels** | Chat · Card Library · Related cards · Journal · Highlights · Table of contents · Info · Whiteboard location · Insight · To-dos (the checkbox items from every card). |
| **Search** | `Ctrl/⌘ O` searches cards, whiteboards, text on whiteboards, chats and tags with filters by kind/scope and sorting. `Ctrl/⌘ K` is the command palette. |
| **Tags & databases** | `#tags` with typed properties (text, number, date, select, multi-select, checkbox, URL), table view per tag, values edited on the card. |
| **PDF & media** | PDF reader with text selection → **highlight cards** that link back to the page; image/video/audio cards; content-addressed file storage. |
| **Import / export** | Import Markdown, text, **Word (.docx)**, PDF, images, audio, video; clip a public **web page**. Export everything as Markdown or JSON from Settings. |
| **AI** | Chat panel/app with citations that open the cited block, built-in actions (translate, summarize, mind map) and custom ones, **Research a topic**, per-card Insight suggestions. Anthropic and any OpenAI-compatible endpoint. |
| **Sync** (optional) | Op-log replication with per-field last-write-wins; attachments sync as hashed blobs. |
| **Your data** | A folder of JSON files (`<data dir>/library/`), written atomically on every change; daily JSON snapshots in `backups/` (last 7 kept, *Back up now* in Settings). |
| **Automation & agents** | An opt-in local API (127.0.0.1, bearer token), a `loom` CLI and an **MCP server** (`loom mcp`): search, read, create, edit and delete every type of object (cards of each kind, whiteboards, board objects, connections, mind maps, tags with their database properties and values, chats) from scripts or AI agents, through the running app or directly on a library folder. `loom://card/<id>` links open a card in the app. |

### How the AI gets context

The chat does not paste your whole library into a prompt. The model works the way you would: it **searches**, then **reads** only what it needs, with a bounded budget.

- Cards are shown as **line-addressable markdown**; the model cites `[c1:12-14]` (card handle, line range) and Loom resolves that to the real block, so a citation opens the exact paragraph.
- Cards, boards and objects get **short run-scoped handles** (`c1`, `w1`, `p1`) instead of UUIDs, which keeps prompts small and prevents the model from inventing ids.
- Reads go through a **three-phase token budget**: guarantee every attached card some coverage, then fill the smallest remainders first, then admit more until the budget is spent. Long cards are paged with `offset`/`limit`.
- Whiteboards are serialized as a **tree** (sections as parents, `a -> b` for connections), with a layout mode (viewport vs. peripheral clusters) and structural truncation when large.
- Tools are executed locally and pulled by the model in an agent loop of up to 8 steps: `search_notes`, `read_card`, `read_backlinks`, `list_whiteboards`, `read_whiteboard`, `list_tags`, `cards_with_tag`, `read_journal`, `list_tasks`, `list_links`, `list_memos`. Mutating tools (`create_card`, `append_to_card`, `create_task`, `update_task`, `save_link`, `add_memo`, `create_whiteboard`, `place_cards`, `create_connection`, `create_mind_map`) only run when **Allow edits** is switched on.
- Your API key is stored locally, never returned to the page and never placed in a prompt.

Configure it in **Settings → AI** (provider, model, optional base URL, key). Nothing is sent anywhere until you do, and then only to the endpoint you chose.

## Run it

Requires [Bun](https://bun.sh). It's the package manager, script runner, dev server and test runner, and it runs the sync server directly from TypeScript. Storage uses the built-in `node:sqlite`, so there are **no native modules** to rebuild.

| Task | Minimum Bun |
|---|---|
| `bun run start`, `bun run build` (the Electron app runs on Electron's own Node) | 1.2 |
| `bun run dev`, `bun run dev:electron`, `bun run test*`, `bun run sync-server` (need `node:sqlite` under Bun) | **1.4** (`bun upgrade`) |

```bash
bun install
bun run start                       # build, then launch the Electron app
bun run dev:electron                # hot-reloading renderer inside Electron
bun run dev:electron --no-sandbox   # extra args go to Electron (needed when running as root, e.g. in a container)
bun run dev                         # renderer only, in a normal browser (talks to a dev DB over HTTP)
bun run package                     # installers via electron-builder (AppImage/deb, dmg, nsis)
bun run icons                       # re-render build/icon*.png after changing assets/brand/loom-mark.svg
```

> **What Bun does not run:** the Electron app itself. Electron's main process always uses the Node.js bundled inside Electron (Electron 45), so the shipped app is unaffected by which runtime you develop with.

Bun skips dependency install scripts unless trusted; `package.json` trusts `electron` (downloads its binary) and `esbuild`.

### Keyboard

`Ctrl/⌘ O` search · `Ctrl/⌘ K` commands · `Ctrl/⌘ N` new card · `Ctrl/⌘ T` new tab · `Ctrl/⌘ W` close tab · `Ctrl/⌘ Tab` or `[` `]` switch tabs · `/` block menu · `@` mention · on a board: `V` select, `T` text, `S` section, `M` mind map, `C` connect, `N` new card, `Ctrl/⌘ Z` undo, `Ctrl/⌘ D` duplicate, `Ctrl/⌘ F` find on the board, `Tab` adds a mind-map child and `Shift+Enter` a sibling, `Space`+drag pan, `Ctrl/⌘`+scroll zoom.

### Sync (optional)

```bash
LOOM_SYNC_TOKEN=choose-a-secret bun run sync-server      # listens on 127.0.0.1:8787 (PORT, LOOM_SYNC_DB to change)
```

Then **Settings → Sync**, enter the URL and token. Put it behind HTTPS (e.g. a reverse proxy) before exposing it beyond localhost. Attachments (images, PDFs, …) upload to the server by SHA-256 and every download is hash-verified before it is stored; a file that fails is retried on the next sync without blocking notes.

### Local API, CLI and MCP server (optional)

Turn it on in **Settings → Local API**. The app then listens on `127.0.0.1` and writes its port and a fresh token to `~/.loom/local-server.json` (only you can read it). The CLI picks that up:

```bash
bun run build && bun link            # or run it in place: bun run loom <command>
loom find "spaced repetition"        # cards, whiteboards, board text, chats and tags
loom get <id>                        # any object by id; a card prints as markdown
loom create task "Draft the outline" --priority high --due 2026-11-02 --tag writing
loom update <card-id> --title "New title" --add-tag draft --prop book.Rating=5
echo "## Notes" | loom append <card-id>
loom board new "Plan" && loom board place <board-id> <card-id>
loom connect <board-id> <object-id> <object-id> --label "leads to"
loom prop add book Rating --type number   # tags are databases: typed properties
loom trash <id> && loom restore <id>
loom ops                             # every operation, with its input schema
loom op updateWhiteboardObject '{"id":"…","x":100,"y":40}'   # run any of them
```

Every command accepts `--json`. Without the app, point the CLI at a library folder with `--data-dir <dir>` (the app's data directory, e.g. `~/.config/Loom`; `--init` creates a new one). Loom refuses to open a library the running app has open, since two writers would overwrite each other's files. `loom serve --data-dir <dir>` runs the local API without the app.

**AI agents (MCP).** `loom mcp` speaks the [Model Context Protocol](https://modelcontextprotocol.io) on stdio and offers each operation as a tool (50 of them), with read-only and destructive hints and instructions that explain Loom's data model. Add `--read-only` to offer only the 16 reading tools. For Claude Code:

```bash
claude mcp add loom -- loom mcp                          # through the running app
claude mcp add loom -- loom mcp --data-dir ~/.config/Loom   # straight to the library, app closed
```

Other clients (Claude Desktop, Cursor, …) take the same command in their MCP config: `{"command": "loom", "args": ["mcp"]}`.

Browsers can't use the local API: requests with an `Origin` header or a non-local `Host` are refused. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the protocol.

## Troubleshooting

- **`Electron failed to install correctly`**: the Electron binary wasn't downloaded. Bun doesn't run dependency install scripts unless they're trusted, and even when it does it runs them with your system `node`; on Node 26 Electron's downloader silently does nothing and exits 0. `bun run start` (and `dev:electron`) detect a missing binary and fetch it with Bun instead, falling back to Node, and only trust the result if the binary exists afterwards. By hand: `rm -rf node_modules/electron && bun install`.
- **`ResolveMessage {}` / `No such built-in module: node:sqlite`**: your Bun is older than 1.4. Run `bun upgrade`. (`build` and `start` don't need it.)
- **`Running as root without --no-sandbox`** (containers): `bun run dev:electron --no-sandbox`.

## Architecture

The full write-up, including what was taken from Heptabase's design and what was deliberately left out, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
src/core      pure TypeScript, no Electron: the whole data model, fully unit-tested
  store.ts      repository + op log; an in-memory SQLite (node:sqlite) for queries and FTS5 search
  json-storage.ts  the JSON files on disk: atomic writes, load, snapshots   library.ts  open + one-time SQLite import
  backup.ts     daily JSON snapshots   local-api.ts  named, zod-validated operations for the local API
  entities.ts   allow-list of synced tables/fields + zod schema for ops
  tagdb.ts      tag definitions, typed properties, table view
  chats.ts      chat history and saved AI actions
  files.ts      content-addressed attachment storage
  sync.ts       push/pull engine + attachment blobs + HTTP transport
  work.ts       tasks, saved links, memos   url.ts  link normalisation
  clip.ts       web clipper + link previews (SSRF-guarded)   docx.ts  Word → markdown
  ai/           context budget, handles, whiteboard serializer, tools, agent loop, providers
  rpc.ts        the only surface the UI can call (named, whitelisted methods)
src/main      Electron main + sandboxed preload + menu; core-worker.ts runs the core in a worker thread;
              local-server.ts is the loopback HTTP server for the local API
src/cli       the `loom` command-line client; mcp.ts is the MCP server, backend.ts picks the app or a library folder
src/renderer  React + Zustand + ProseMirror; whiteboard is DOM + SVG; pdf.js viewer
server        reference sync server (append-only op log + blob store); `bun server/main.ts`
```

**Data & sync.** Every change is an *op*: `{entity, entityId, fields, hlc timestamp, device}`. Ops are applied with per-field last-write-wins ordered by a hybrid logical clock, so merging is idempotent, commutative and needs no coordination. Each record is a JSON file with its per-field clocks; at startup they are loaded into an in-memory SQLite so queries are plain SQL, and every committed change is written straight back. `ops.jsonl` is the replication log. Deletes are soft (`deleted_at`). Backlinks, tasks and the search indexes are derived locally and never synced. The server never interprets ops.

**Search.** FTS5 over card title and body (and whiteboard names, board text, chats), prefix matching so results update as you type.

**Security.** Context isolation and sandbox on; the page has no Node access, only `rpc`, `upload`, `onEvent`, `ready` and `localApi`; every IPC handler checks the sender's origin, and `rpc` is a method whitelist; the data core runs in a worker thread and restarts after a crash; navigation is locked and links open in the OS browser; strict CSP. Attachments are served from `loom-file://` with range support, `nosniff` and a MIME allow-list (anything else downloads as opaque bytes). Because content can arrive from other devices it is treated as untrusted: ops are validated against the field allow-list before touching SQL, link `href`s are limited to http/https/mailto, and content that can't be parsed opens read-only and is never overwritten. The web clipper only fetches public http(s) addresses: it resolves DNS itself, refuses loopback/private/link-local/metadata ranges (re-checked on every redirect), caps size and time, and never runs scripts.

## Tests

```bash
bun run typecheck
bun run test            # 136 unit tests: store, search, merge/convergence, sync + attachments, AI engine against a mock LLM (Anthropic and OpenAI protocols), clipper, docx, tasks/links/memos, RPC, JSON library (reopen, rollback, corrupt files, SQLite import), backups, local API + server, MCP
bun run test:e2e        # 42 browser tests (Playwright + Chromium): cards/editor, whiteboards, tabs/search/commands/export, AI chat, tasks/links/memos; fails on any console error
bun run test:electron   # 11 tests in real Electron under xvfb: isolation, JSON files on disk, CSP + loom-file:// + PDF rendering through the worker, local API driven by the CLI, deep links, menu, restart persistence with window size, two devices syncing
```

The browser tests need a Chromium for Playwright (`/opt/pw-browsers/chromium-*` or `CHROME` in `e2e/harness.ts`).

## Not included (on purpose)

Loom covers the single-user, local-first core. These parts of Heptabase are **not** implemented:

- Real-time collaboration, shared whiteboards, teams and permissions
- Mobile apps
- Zotero / Readwise / other third-party integrations
- Accounts, billing and hosted AI (bring your own key instead)
- YouTube transcripts and an embedded browser tab; web pages are clipped as text cards instead (no scripts, no login-gated pages)
- OCR, and importing `.doc`/Pages/Notion/Evernote archives (Markdown, text and `.docx` are supported)

## Known limitations

- **Concurrent edits to the *same card body* are last-writer-wins for the whole document** (title, position, tags, properties etc. merge per field). A text CRDT (e.g. Yjs) would merge typing from two devices; this does not.
- Sync has no history compaction, no end-to-end encryption, and a single shared token stored unencrypted (in `meta.json`, readable only by you). The reference server keeps attachment bytes in SQLite, which is fine for personal use but not for large libraries.
- Renaming a card doesn't rewrite `[[links]]` that point at it (`@` mentions follow the card id and stay correct).
- The AI quality depends on the model you configure; with tools that mutate notes, review what it did (Undo on boards, History on cards, Trash).
- The whole library is loaded into memory at startup and indexes are rebuilt each time; that is quick for a personal library but grows with it.
- `node:sqlite` is still flagged experimental by Node and Electron; the API surface used here is small and covered by tests.
- Installers other than the unpacked Linux build were configured but not built here (the Linux build was verified to start from its `app.asar`).
