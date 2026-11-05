---
name: loom-project-management
description: Manage projects and tasks in Loom through the loom CLI. Sets up a Loom space with Project and Task types and a Kanban board, then creates, triages and moves tasks, and for a task writes an investigation, implementation plan and report back into the Loom object. Use when the user asks to track, plan or work on tasks/projects "in Loom" or "with Loom project management".
---

# Loom project management

Loom is the system of record for projects and tasks; the agent reads and writes it through the `loom` CLI (the same API behind the app's AI Agent panel). Tasks are ordinary Loom objects: **properties** hold the state (Status, Priority, Due date, Project) and the **body** holds the writing (investigation, plan, report). Never keep state only in chat.

Base tool reference: the `loom` skill (`loom-heart/cmd/loom/SKILL.md`) for the task verbs and the `api` verb. This skill is the workflow on top. Re-check `loom <verb> --help` and `loom api <op> --help` rather than guessing a flag or argument.

## 0. Preflight

1. `loom auth status`. If not paired, `loom auth` (the app shows a 4-digit code). Headless: `loom serve` first (see the `loom` skill).
2. `loom spaces`. Look for a space named **Projects** (or the one the user names). Found: skip to "Verify the schema". Not found: ask the user whether to create one, then do "Set up".
3. Always state which space you are writing to.

## 1. Set up (once per space, idempotent)

Check before every create (`loom api list_types space_id=…`, `list_properties`), reuse what exists, create only what is missing. Prefer `dry_run=true` first. Ids are full ids from the output, not handles.

**Space**
```sh
loom api create_space name=Projects description="Projects and tasks"
```

**Task type** (Loom may already ship `task`; if so, only add the missing properties):
- Status: `select`, options `Backlog`, `To do`, `In progress`, `In review`, `Done`, `Cancelled`. This is the Kanban grouping property. Options need `create_missing_options=true`.
- Priority: `select`, options `Urgent`, `High`, `Medium`, `Low`.
- Due date: `date`.
- Project: `objects` (links to a Project object).

```sh
loom api update_type space_id=SP type_key=task create_missing_options=true \
  ops='[{"op":"add_property","property":"Status","format":"select","options":[{"name":"Backlog"},{"name":"To do"},{"name":"In progress"},{"name":"In review"},{"name":"Done"},{"name":"Cancelled"}]},
        {"op":"add_property","property":"Priority","format":"select","options":[{"name":"Urgent"},{"name":"High"},{"name":"Medium"},{"name":"Low"}]},
        {"op":"add_property","property":"Due date","format":"date"},
        {"op":"add_property","property":"Project","format":"objects"}]'
```
If `task` can't take the properties or you want a clean type, `create_type` with `property_definitions` (`loom api get_schema kind=type` shows the body).

**Project type** (same approach; reuse `project` if it exists): properties Status (`select`: `Planned`, `Active`, `On hold`, `Done`), Due date, and a body for goals.

**Kanban board** over tasks, a query with a board view grouped by Status:
```sh
loom api create_query space_id=SP name="Task board" type=task \
  views='[{"name":"Board","type":"kanban","group_by":"status"},{"name":"All tasks","type":"table"}]'
```
(`group_by` is a property key; `loom api get_schema kind=query` shows every view field.) For a per-project board, create another query with `filter='project HAS ("<project object id>")'` or add a view with `insert_view`. Put the board in the sidebar so it is one click away: `loom api create_widget space_id=SP target=<query id> scope=personal`.

> The operation names above come from the API v2 table (`loom api` lists them). If a name or argument differs in the installed version, trust `loom api` / `--help` and `loom api get_op_schema op=add_property`.

**Verify the schema** every session before creating anything: `loom find --space SP --type Task`, then `loom describe`, and confirm Status options match exactly (names are case-sensitive and never auto-created by the task verbs).

## 2. Everyday operations

Use the task verbs; handles (1, 2, …) come from `find` and expire on the next `find`.

| Intent | Command |
|---|---|
| list open tasks | `loom find --space SP --type Task --filter 'Status IN ("To do","In progress","In review")'` |
| my tasks | `--filter 'Assignee = "@me" AND Status != "Done"'` |
| tasks of a project | `--filter 'Project HAS ("<project id>")'` |
| overdue | `--filter 'Due_date < today() AND Due_date IS NOT EMPTY AND Status != "Done"'` |
| create a task | `loom api create_object space_id=SP type=task name="…" properties='{"status":["To do"],"priority":["High"],"due_date":"2026-12-01T00:00:00Z","project":["<project id>"]}' markdown="…"` |
| create a project | `loom api create_object space_id=SP type=project name="…" markdown="## Goal\n…"` |
| move on the board | `loom set-properties --object N --set '{"Status":"In progress"}'` |
| assign / reschedule | `--set '{"Assignee":"@me","Due date":"+3d"}'` |
| break down a task | create subtasks with `Project` copied from the parent and link them in the parent body |
| archive | `loom api delete_object …` (goes to the Bin, restorable). Don't delete for good unless asked |

Triage request ("what should I do next?"): `find` open tasks, sort mentally by Priority then Due date, answer with the top 3 and why, then offer to set the top one `In progress`. Weekly summary: group by Project and Status, call out overdue and blocked items.

Writes the user did not ask for (bulk status changes, archiving, creating a pile of tasks) get a one-line confirmation first. Single-task edits don't.

## 3. Working a task: investigate, plan, report

When the user says "work on / look into / implement task X":

1. **Fetch.** `find --type Task` with a name/query filter, pick the match (ask if ambiguous), then `read --object N` in full. Read the linked Project and any linked objects too. If the user mentions comments, `loom api create_discussion` on the object returns its discussion chat id (the existing one if any); read it with `loom api get_chat_messages`.
2. **Start.** Set `Status` to `In progress` (and `Assignee` `@me` if empty) before doing work.
3. **Investigate.** Do the actual research in the codebase or elsewhere. Then write findings into the task body with `add-blocks --markdown`, under one heading per phase, appended after existing content:

```markdown
## Investigation
- **Question:** what we need to find out
- **Findings:** what you found, with file paths / links
- **Root cause / constraints:**

## Implementation plan
- [ ] Step 1 …
- [ ] Step 2 …
**Risks:** …   **Out of scope:** …
```
   Checklist steps are real checkbox blocks; later tick them with `check-item --object N --block <id> --checked` (block ids come from `read --mode outline`).
4. **Plan gate.** Show the user the plan (a short summary plus the task name) and wait for a go-ahead before implementing, unless they already asked you to implement it. Set `Status` to `In review` if the user must approve the plan.
5. **Implement.** Tick plan steps as you finish them. Keep Status `In progress`.
6. **Report.** Append, never overwrite earlier sections:

```markdown
## Report
- **Outcome:** done / partially done / blocked
- **What changed:** PR / commits / files
- **How it was verified:**
- **Follow-ups:** (create each as a new task and link it)
```
   Then set `Status` to `In review` (or `Done` if the user said so) and tell the user in chat where the write-up lives, naming the object.
7. **Blocked?** Set the status back, write the blocker under `## Report`, and ask the user. Don't leave a task `In progress` with no note.

Editing rules (from the `loom` skill): use `edit-text` for small changes, `add-blocks` for new sections, never rewrite the whole body; re-read after structural edits before reusing block ids; every receipt names the changed object, so check it matches your intent.

## 4. Conventions

- One task = one outcome that fits a PR or an afternoon; split bigger ones into subtasks.
- Status is the single source of truth for progress; never encode status in the name.
- Dates in properties: `today`, `tomorrow`, weekday names, `+3d` or ISO. Create-object `properties` take RFC 3339.
- Select values are option **names**, exact case. An unknown option is an error listing the valid ones; fix the spelling instead of creating new options, unless the user wants a new status.
- Reference Loom objects by name in chat, never paste raw ids to the user.

## 5. Using it from the app's AI Agent panel

The panel's agent talks to the same API over MCP, so the same workflow works there: the user opens the panel, mentions the task with `@`, and asks e.g. "investigate this task and write a plan into it". Do "Set up" from a coding agent with the CLI (or `loom mcp --tier full`); it is not verified that the panel's tool set can create types and queries.
