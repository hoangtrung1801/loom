# sidebar/ - Left and Right Sidebars

Collapsible sidebars for navigation, object properties, and type configuration. **21 files**.

## Left Sidebar (`left.tsx`)

Main navigation sidebar with sub-pages:
- `page/widget.tsx` - Widget dashboard (default view); the Tree section (listed once `S.Common.hasTreeSection`) renders `widget/tree/section.tsx` instead of `Widget`
- `page/vault.tsx` - Space/vault browser; header search icon opens the search popup in global (cross-space) mode
- `page/settings/index.tsx` - Settings panel
- `page/settings/library.tsx` - Library panel (types, relations)
- `page/type.tsx` - Type management page (used in right sidebar routing)
- `page/object/relation.tsx` - Object relation panel
- `page/object/tableOfContents.tsx` - Document TOC panel

Registered components: `widget`, `vault`, `settings`, `settingsSpace`, `settingsTypes`, `settingsRelations`.

## Right Sidebar (`right.tsx`)

Context-sensitive detail panel with animation (motion/react):
- `page/type.tsx` - Type configuration
- `page/object/relation.tsx` - Object relation editing
- `page/object/tableOfContents.tsx` - Document TOC
- `page/widget.tsx` - Widget preview
- `page/agent/` - AI Agent chat (page `agent`), opened from the object header button or the `agent` shortcut (Cmd/Ctrl+Shift+A). State lives in `S.Agent`.
  - `index.tsx` - three views that crossfade (motion, `reducedMotion="user"`): chat, history (the space's saved sessions: open, move to bin) and settings (provider, key, model, base URL, tool tier, confirm-before-changes). Chat: empty state with prompt suggestions; new messages rise in (not on load or when a session opens, since the list is keyed by chat); the view follows new text only while scrolled to the bottom, with a scroll-down button otherwise; one round button sends, or stops a run when the input is empty
  - `message.tsx` - message rendering: user bubbles with @mentions as links; Lo's answers with avatar, markdown via `lib/agentMarkdown.ts` (React elements, never innerHTML), a caret while streaming, typing dots before the first text, tool rows with status icons and an animated Allow/Decline card, and a copy button
  - `composer.tsx` - the message input (reports empty/non-empty, `setText` for suggestions): an `Editable` where `@` opens the editor's `blockMention` menu and inserts a mention mark, and `/` at the start opens the command list in the `select` menu. Menus use `classNameWrap: 'fromSidebar'` to sit above the panel
  - `commands.ts` - the slash commands: actions (`/new`, `/history`, `/settings`, `/stop`) and prompts (`/summarize`, `/tasks`, `/explain`, `/translate`) that fill the input

Registered components: `agent`, `type`, `objectRelation`, `objectTableOfContents`, `widget`.

## Sections (`section/`)

`section/index.tsx` - Generic section dispatcher. Maps component strings to section implementations:

- `section/type/title.tsx` - Type title config
- `section/type/layout.tsx` - Type layout settings
- `section/type/relation.tsx` - Type relations management
- `section/type/template.tsx` - Type templates
- `section/type/format/page.tsx` - Page format settings
- `section/type/format/list.tsx` - List format settings
- `section/object/relation.tsx` - Object relation editing
- `section/object/tableOfContents.tsx` - Object TOC

## Preview (`preview.tsx`)

Layout preview panel for type configuration. Shows a live preview of type layout settings (alignment, width, featured relations, format). Used when right sidebar has `withPreview` enabled for the `type` page.

## Progress (`progress.tsx`, `progress.stories.tsx`)

Progress indicator for long-running operations (import, export, update, etc.). Displays in the left sidebar footer. Auto-expands when new processes appear, collapsible via header click. Exports `ProgressItem` component for individual progress entries and `SidebarProgress` as the container. Has Storybook stories.

Rows come from two sources: middleware processes, and client-owned file downloads (`isLocal`), which cancel through `Lib/download` instead of `ProcessCancel` and fill `subtitle` with the file being written plus a `tooltip` listing every file in the row. A download that only wrote a file keeps its place (`keepWhenDone` → `isDone`) with a platform-named reveal action — Show in Finder / Explorer / folder — and is dropped only when dismissed. One that opened or revealed the file disappears like every other finished row, since it already acted on it.

Import v2 runs additionally carry `I.ImportStatistic` (from `Event.Import.Statistic`), which replaces the blended percentage with per-phase counters: a count-up while totals are unknown, page/file or object counts once known, ETA, a calm rate-limit or retry badge, the current item as a subtitle, and live warning/error counts. Cancelling past the creating boundary opens a confirm popup, since it deletes the objects already created. Runs without a statistic (import v1, other process types) keep the legacy percentage rendering.

## Patterns

- Resize handle with drag state tracking via refs and `raf`
- Component ID to camelCase mapping for dynamic rendering
- State persistence via `Storage`
- `sidebar` utility object for programmatic open/close
- Uses `motion/react` for page transition animations (right sidebar)
- `forwardRef` + `useImperativeHandle` throughout for parent access
