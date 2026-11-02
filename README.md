# Loom

> **Local‑first, peer‑to‑peer & end‑to‑end‑encrypted knowledge OS for macOS, Windows & Linux — with a CLI and MCP server for AI agents.**

[![License](https://img.shields.io/badge/license-ASAL_1.0-blue.svg)](LICENSE.md)

Loom is a **personal knowledge base**—your digital brain—that lets you gather, connect and remix all kinds of information. Create pages, tasks, wikis, journals—even entire apps—and *define your own data model* while your data stays **offline‑first, private and encrypted** across devices.

Loom is a fork of [Anytype](https://github.com/anyproto/anytype-ts). It keeps Anytype's data model and its [any‑sync](https://github.com/anyproto/any-sync) network, and bundles the desktop client and the middleware in a single repository.


## ✨ Key Features

- **Offline‑first, local storage** with optional peer‑to‑peer sync.
- **Zero‑knowledge encryption** powered by *any‑sync*.
- **Composable blocks**: text, databases, kanban, calendar & custom Types.
- **Cross‑platform desktop client** built with Electron + TypeScript.
- **`loom` CLI** – task‑shaped verbs over the local API, usable from a terminal or a script.
- **MCP server** – `loom mcp` exposes the same tools to AI agents over stdio.
- **Headless mode** – `loom serve` runs the middleware without the app and syncs through any‑sync.
- **Open code** under the Any Source Available License 1.0.

## 📚 Table of Contents

- [Repository Layout](#-repository-layout)
- [Building from Source](#-building-from-source)
- [Development Workflow](#-development-workflow)
  - [Updating Protobuf Bindings](#updating-protobuf-bindings)
- [The `loom` CLI](#-the-loom-cli)
- [CI](#-ci)
- [Contributing](#-contributing)
- [License](#-license)


## 🗂 Repository Layout

| Path          | What it is                                                                              |
|---------------|-----------------------------------------------------------------------------------------|
| `src/`        | Electron renderer: React + MobX UI (`src/ts/`) and styles (`src/scss/`)                 |
| `electron/`   | Electron main process                                                                   |
| `loom-heart/` | Go middleware (the `loomHelper` binary the app talks to over gRPC) and the `loom` CLI   |
| `extension/`  | Web clipper browser extension                                                           |
| `scripts/`    | Build, dev‑server and protobuf generation scripts                                       |
| `docs/`       | Documentation of the frontend modules                                                   |

`loom-heart/` is regular source in this repository, not a submodule, so a change that spans the UI and the middleware goes in a single commit. It started as a copy of [anytype-heart](https://github.com/anyproto/anytype-heart) and keeps its own `LICENSE.md`.


## 🏗 Building from Source

You need [Bun](https://bun.sh), [Node.js](https://nodejs.org), the Go toolchain version in `loom-heart/go.mod`, a C/C++ compiler and `protoc`.

On ARM systems, node package `keytar` needs to be rebuilt during installation, so make sure that your system has a C++ compiler, Python3 and Python package `setuptools`. E.g. on Debian/Ubuntu: `sudo apt install python3-setuptools`. Alternatively, on any system, create a Python virtual environment (venv) and inside the venv: `pip install setuptools`. Then build from source inside the venv.

**Linux** also needs the protobuf compiler **with** the well-known `.proto` files (used to generate the gRPC bindings in step 3):
- **Fedora:** `sudo dnf install protobuf-compiler protobuf-devel jq`
- **Debian / Ubuntu:** `sudo apt install protobuf-compiler libprotobuf-dev jq`

```bash
# 1 – Clone & open this repository
git clone https://github.com/hoangtrung1801/loom.git && cd loom

# 2 – Install JavaScript dependencies
bun install

# 3 – Build the middleware (dist/loomHelper) and generate the protobuf bindings
#     (middleware/) and the service registry (src/ts/lib/api/service.ts)
bun run generate:protos

# 4 – Update locale
bun run update:locale

# 5 – Build the Electron desktop app (see package.json for more options)
bun run dist:<linux|win|mac>
```

> Step 3 produces `dist/loomHelper`, `middleware/` and `src/ts/lib/api/service.ts`, which are git-ignored. Skipping it causes `Failed to resolve import "./service" from src/ts/lib/api/dispatcher.ts`. The middleware needs native libraries (tantivy); see [`loom-heart/docs/Build.md`](loom-heart/docs/Build.md) for its prerequisites, and [Updating Protobuf Bindings](#updating-protobuf-bindings) and [`scripts/README.md`](scripts/README.md#protobuf-generation) for details.

### Environment flags

| Variable                 | Effect                                           |
|--------------------------|--------------------------------------------------|
| `ELECTRON_SKIP_NOTARIZE` | Skip macOS / Windows signing & notarizing         |
| `ELECTRON_SKIP_SENTRY`   | Don’t upload sourcemaps to Sentry                 |


## 🧑‍💻 Development Workflow

You can use [nix](https://nix.dev/install-nix) to install all the required dependencies at once.

```shell
# open a shell with all the required dependencies
nix develop --command $SHELL
```

Start the dev server with hot‑reload (builds Electron bundle, starts Vite, then launches Electron):

```bash
bun run start:dev     # Windows: bun run start:dev-win
# add --user-data-dir=./my_dir to electron(-win) script in package.json if you want to use custom user data directory
```

When you close Electron, the Vite dev server is automatically stopped.

For browser-based development without Electron:

```bash
bun run start:web
```

See [Web Mode](./docs/src/ts/lib/web/README.md) for details.

### Useful commands

```bash
bun run build         # Production build (Vite)
bun run build:dev     # Development build (Vite)
bun run typecheck     # TypeScript type checking
bun run lint          # Run linters (Biome + ESLint)
bun run test          # Unit tests (Vitest)
```

### Environment variables

| Name                  | Purpose                                                              |
|-----------------------|----------------------------------------------------------------------|
| `SERVER_PORT`         | Vite dev server port (default: `8080`)                                |
| `LOOM_USE_SIDE_SERVER`| `start:web` only: use an already running middleware instead of starting `loomHelper` |
| `LOOM_GRPCWEB_ADDR`   | `start:web` only: gRPC‑web address of the middleware (default: `127.0.0.1:31008`) |

### Web Clipper Extension

Build and switch manifest for different browsers:

```bash
bun run build:ext
bun run ext:manifest:firefox
bun run ext:manifest:chromium
```

### Updating Protobuf Bindings

The TypeScript protobuf bindings (`middleware/`) and the gRPC service registry (`src/ts/lib/api/service.ts`) are **generated and git-ignored** — a fresh checkout has neither, and the dev/build will fail with `Failed to resolve import "./service" from src/ts/lib/api/dispatcher.ts` until you generate them.

```bash
bun run generate:protos
```

This builds the bundled `loom-heart/` middleware, installs the helper into `dist/`, and generates the bindings from its `.proto` files. Set `HEART_DIR` (or `LOOM_HEART_PATH`) to use a different middleware checkout, or `SKIP_HEART_BUILD=1` to generate the bindings only.

**Prerequisites:** `bun install` must have been run (for `ts-proto`), and `protoc` **plus the well-known `google/protobuf/*.proto` files** must be installed:

- **Fedora:** `sudo dnf install protobuf-compiler protobuf-devel`
- **Debian / Ubuntu:** `sudo apt install protobuf-compiler libprotobuf-dev`
- **macOS:** `brew install protobuf`

> The `-devel` / `-dev` package is required on Linux — without it `protoc` reports `google/protobuf/struct.proto: File not found`. See [`scripts/README.md`](scripts/README.md#protobuf-generation) for the full Linux first-time setup and troubleshooting.


## 🧵 The `loom` CLI

`loom` is a single binary built from `loom-heart/cmd/loom`. It talks to a running Loom API — the desktop app, or `loom serve` on a server.

```bash
loom auth                 # pair with the running app and save an API key
loom spaces               # list spaces
loom find --space <spaceId> --query "meeting notes"
loom api                  # list every API operation
loom mcp                  # serve the tools over MCP (stdio) for AI agents
loom skill install        # install the Loom skill for Claude Code / Codex
```

Run `loom` with no arguments for the full list of verbs and flags. The API address and key come from `LOOM_API_URL` (default `http://127.0.0.1:31009`) and `LOOM_API_KEY`, or from `loom auth`.

### Running headless

```bash
loom serve --new                        # create an account, print its recovery phrase once
LOOM_MNEMONIC="…" loom serve            # restore it later
```

`loom serve` runs the middleware in‑process, syncs through any‑sync, and serves the API for the other `loom` verbs. Sign in to the same account in the desktop app with the recovery phrase to sync with it.

It can also back up every space to Markdown on a schedule, and commit and push the result to git:

```bash
loom serve --backup-dir ./backup --backup-git --backup-push --backup-remote <git-url>
```

> Use a **private** repository for backups: the export is plain text.

To build the CLI yourself, see [`.github/workflows/loom-cli.yml`](.github/workflows/loom-cli.yml).


## ⚙️ CI

| Workflow                                                      | What it does                                                                                       |
|---------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| [`loom-app.yml`](.github/workflows/loom-app.yml)               | Builds the desktop app for Linux, macOS and Windows. Builds are **unsigned** and not published to any update server. Push a `loom-app-v<version>` tag to attach the installers to a GitHub release. |
| [`loom-cli.yml`](.github/workflows/loom-cli.yml)               | Builds the `loom` CLI for Linux, macOS and Windows. Push a `loom-v<version>` tag to attach the binaries to a GitHub release. |


## 🤝 Contributing

Issues and pull requests are welcome at [hoangtrung1801/loom](https://github.com/hoangtrung1801/loom). Before you open a pull request, run:

```bash
bun run typecheck
bun run lint
```

Please keep Anytype's upstream contribution rules in mind when touching code that originates from there: see the [Contributing Guide](https://github.com/anyproto/.github/blob/main/docs/CONTRIBUTING.md) and the [Code of Conduct](https://github.com/anyproto/.github/blob/main/docs/CODE_OF_CONDUCT.md).


## 📝 License

Loom is a fork of Anytype, made by **Any** — a Swiss association 🇨🇭

Licensed under the **Any Source Available License 1.0** — see [`LICENSE.md`](LICENSE.md).
