---
name: loom
description: Read, search, create and edit Anytype objects through the loom CLI. Use when the user asks to find notes/tasks/pages in Anytype, create objects, tick checkboxes, edit document text, fill tables, or reorganize content. Task-shaped verbs over the local API; results are numbered handles you pass back — never copy long ids.
---

# Anytype task tools

Twelve verbs over the local Anytype API. Everything composes through a
session: `find` numbers its results (1, 2, …) and sets the working space;
every other verb takes `--object <number>`.

Setup: the local Anytype app must be running; `LOOM_API_KEY` holds an
API key from the app's settings, or run `loom auth` to pair and save one
(`LOOM_API_URL` defaults to `http://127.0.0.1:31009`).

## Setup

1. Run `loom auth`. The app shows a 4-digit code; enter it when asked (or
   pass `--code 1234`). The key is saved to `config.json` under the user
   config dir (`LOOM_CONFIG` overrides) and every verb uses it;
   `LOOM_API_KEY`, when set, takes precedence. `loom auth status`
   shows which key is in use, `loom auth logout` removes it.
2. Add the MCP server to your client:

```
claude mcp add loom -- loom mcp --tier full
```

```json
{"command": "loom", "args": ["mcp", "--tier", "full"]}
```

## The loop

```sh
loom spaces                             # space ids, when none is known
# Work — bafyspace1
loom find --space bafyspace1 --type Task --filter 'done = false'
# 1. Prepare the Q3 report (Task)
# 2. Ship the beta (Task)
loom edit-text --object 1 --find "Q3" --replace "Q4"
# --block is optional: the snippet locates the block when it matches
# exactly one; an ambiguous snippet refuses and lists the candidates
loom read --object 1 --mode outline     # block ids + structure
```

1. **spaces** when no space id is known — it lists `name — id`.
2. **find** next — it creates the handles and the working space.
3. **describe** before you create or set properties — it lists the live
   property names and each one's format and options. Address properties by
   the names describe shows (`"Due date"`); select option names must match
   exactly.
4. **read** before you edit blocks — block ids come from read
   (`--mode outline` for structure, full mode for text; table row and
   column ids come from full mode too).

## Intent → verb recipes

| Intent | Verb — not that other thing |
|---|---|
| complete/close a task object | `set-properties --object 1 --set '{"Done":true}'` (or the status option describe shows, e.g. `{"Status":"Done"}`) — NOT check-item, which is for checkbox blocks inside a document |
| tick a checklist line in a note | `check-item --object 1 --block ab3f2 --checked` |
| change one word/phrase | `edit-text` with a short unique snippet — never retype the block; `--block` only when the snippet alone is ambiguous (the error lists the candidates) |
| delete a word/phrase | `edit-text --find "the phrase" --replace ""` — an empty replacement deletes |
| delete several blocks | `delete-block --block "ab3f2,c81d0,e0001"` — ONE call, comma-separated; it removes all of them or none — never one call per block |
| add notes/sections/checklists | `add-blocks --markdown '…'` — write markdown, the server parses it |
| fill one table cell | `set-cell` — never rewrite the table; row/col ids come from full read |
| clear one table cell | `set-cell … --value ""` — an empty value clears |
| assign to the current user | value `"@me"` — e.g. `--set '{"Assignee":"@me"}'` |
| due dates | `today`, `tomorrow`, weekday names, `+3d`, or `2026-08-01` |
| find "my open tasks" | `--filter 'Assignee = "@me" AND Done = false'` |

## Filter strings

`--filter` is a compact expression, not JSON:
`Done = false AND (Due_date < currentWeek() OR Due_date IS EMPTY)` ·
`Status IN ("In progress", "Blocked")` · `Name CONTAINS "report"` ·
`Last_modified_date > daysAgo(7)`. String values take double quotes; date
presets are functions (`today()`, `currentWeek()`, `daysAgo(n)`).
Property names here are written as identifiers — a multi-word name takes
underscores (`Due_date` for "Due date"); a name no identifier can spell
(`C++`, `50% done`) cannot ride a filter string.

## Caveats

- **Text is markdown source.** `edit-text` find/replace operates on the
  block's markup: `**`, `[`, `~~` in a replacement become real formatting.
  Escape with `\` when you mean the literal character.
- **Select options are never created by these verbs.** An unknown option
  name is an error listing the existing names — fix the spelling (option
  names are case-sensitive). `--create-missing` is the deliberate escape.
  Type and property NAMES are more forgiving: case, `_`/`-` and spaces
  fold away, so `due_date`, `dueDate` and `Due date` all address one
  property; if two properties answer to one spelling the error names
  both — it never guesses.
- **Handles expire on the next find.** Re-run `find` and use the new
  numbers. Block ids come from `read` — use them as served, and re-read
  after a structural edit rather than reusing remembered ones. A block id
  always names an EXISTING block: new content is authored without ids
  (`add-blocks` takes none). Every edit receipt names the object it changed
  (`ok — "Groceries": …`) — check it matches your intent.
- **One verb, one intent.** There is no batch; run verbs in sequence.
  Retries are safe: an identical re-run within a minute is deduplicated,
  including after a failed or timed-out attempt.
- Errors are self-describing and name valid alternatives — read them, fix
  the named field, retry once. Do not loop blindly.

## References

- `loom tools` — the machine-readable manifest: per-tool JSON schema,
  worked example, GBNF grammar (constrained decoding), and the filter
  grammar (EBNF + GBNF). `--tier small` narrows it to the 8-tool set for
  ~8B models (`large`, the default, is all twelve).
- `loom mcp --tier small|large|full` — serve the same tools over MCP stdio
  for LOCAL models (Ollama/LM Studio-class hosts). Coding agents reading
  this skill should keep using the verbs directly — the CLI is the
  intended delivery for them; `mcp` exists for hosts that cannot run
  commands. Session state is in-memory for the server's lifetime.
- `loom help` — the verb list; `loom <verb> --help` — its flags.

## Beyond the task verbs: every operation

The verbs above cover finding, reading and editing objects. For anything
else — creating or changing **types**, **properties** and their **options**,
**queries/collections** and their views, **templates**, **chats**,
**widgets**, **spaces**, **files**, members, and **deleting or restoring**
objects — use `api`. It serves the full tool table: one operation per local
API v2 endpoint, derived from the running app's own OpenAPI document, so it
always matches the app you talk to.

```sh
loom api                                   # every operation, [read-only] / [destructive] marked
loom api create_type --help                # one operation's argument schema
loom api list_types space_id=bafyspace1    # key=value; values are JSON when they parse
loom api delete_object space_id=bafyspace1 object_id=bafyobj1
echo '{"space_id":"bafyspace1","name":"Projects","type":"page"}' | loom api create_object -
```

- Arguments are flat: path, query and body members side by side, named as
  the schema names them (`space_id`, `object_id`, …). Ids are full ids,
  not the task verbs' numbered handles.
- `patch_object` and `update_type` take `ops`, a list of `{op, …}` entries;
  `loom api get_op_schema op=<name>` serves each op's shape and example.
- Any write accepts `dry_run=true` to preview what it would change.
- `loom mcp --tier full` serves the same table over MCP stdio, and
  `loom tools --tier full` prints its tools/list.
- Spec: `core/api/APIV2.md` §7 (the wrapper contract), `github.com/anyproto/any-block/format/v2/SPEC.md`
  (the document format the full-read mode returns).
