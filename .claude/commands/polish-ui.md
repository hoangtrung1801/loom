Polish UI elements by auditing SCSS and TSX markup against the Anytype design system, then fixing discrepancies.

## Arguments

$ARGUMENTS — Component name, file path, or area to polish (e.g. "sidebar widgets", "list view", "dataview"). If empty, polish the most recently changed components.

## Instructions

### Phase 1: Identify Target Files

1. Find the component files matching the user's description (`.tsx` + `.scss`).
2. If no specific target, check `git diff --name-only HEAD~3` for recently changed component files.

### Phase 2: Read Design References

Read these docs to establish the design baseline:

- `src/scss/_vars.scss` — CSS custom properties for colors, typography, spacing
- `src/scss/_mixins.scss` — Shared SCSS mixins (text styles, overflow, clamp)
- `src/scss/README.md` — SCSS conventions overview

### Phase 3: Read Codebase Patterns

For each component being polished, find equivalent/sibling components to compare:

- **CSS values**: spacing, font mixins, colors, border-radius, shadows
- **HTML structure**: nesting depth, class patterns, wrapper conventions
- **Hover/active/focus states**: what changes on interaction
- **Transitions**: what animates and how

Use `Grep` to find sibling components in `src/ts/component/` and their SCSS in `src/scss/`.

### Phase 4: Audit Against Checklist

For each component, check every item below. Mark issues found.

#### Typography
- [ ] Font sizes use SCSS mixins (`@include text-small`, `@include text-common`, `@include text-paragraph`, etc.) — never raw `px` for font-size
- [ ] Font weights match codebase scale (400 regular, 500 medium, 600 semibold, 700 bold)
- [ ] Line heights use CSS variables (`var(--line-height-*)`) or come from text mixins
- [ ] Letter spacing comes from text mixins, not hardcoded

#### Colors
- [ ] All colors use `var(--color-*)` CSS variables (no hardcoded hex/rgb outside `src/scss/theme/dark/`)
- [ ] Text colors match semantic roles: `--color-text-primary` for body, `--color-text-secondary` for secondary, `--color-text-tertiary` for placeholders
- [ ] Background colors use correct semantic token (`--color-bg-primary`, `--color-bg-secondary`, `--color-shape-highlight-*`)
- [ ] Hover states use `var(--color-shape-highlight-medium)` where appropriate
- [ ] Icon colors follow existing patterns

#### Spacing
- [ ] Padding/margin values match sibling component equivalents
- [ ] Gap values are consistent with sibling components
- [ ] Values follow the spacing grid (common: 2, 4, 6, 8, 10, 12, 16, 20, 24, 32)

#### Borders & Shapes
- [ ] Border-radius matches design (common values: 4px, 6px, 8px, 12px)
- [ ] Border colors use `--color-shape-primary` or `--color-shape-secondary`
- [ ] Shadows use existing patterns or theme variables

#### Layout
- [ ] Flex/grid alignment matches design (center, start, space-between)
- [ ] Element sizing is correct (height, min-height, width constraints)
- [ ] Overflow handling is correct (`hidden`, `auto`, or `@include text-overflow-nw` for text)
- [ ] No unnecessary wrapper divs
- [ ] CSS uses native nesting where appropriate

#### Interactions
- [ ] No `cursor: pointer` anywhere (the app does not use custom cursors)
- [ ] Hover states exist where expected (buttons, list items, interactive elements)
- [ ] Selection/highlight states use `var(--color-shape-highlight-medium)`
- [ ] Transitions use `$transitionCommon` or `$transitionAllCommon` where appropriate

#### Inline Styles
- [ ] No inline `style={{}}` for static values (must be in SCSS)
- [ ] Inline styles only for truly dynamic values (computed widths, positions from JS)

#### Code Quality (SCSS)
- [ ] SCSS uses compact anytype formatting (related properties on same line, semicolons)
- [ ] Uses native CSS nesting — nested selectors instead of flat/inline selectors
- [ ] `!important` is minimal and justified
- [ ] No unused CSS classes
- [ ] Uses existing mixins (`@include text-overflow-nw`, `@include text-small`, etc.) instead of hand-rolling

#### Code Quality (TSX)
- [ ] `else if` has a linebreak before `if` (per CLAUDE.md code style)
- [ ] Compound conditions wrapped in parentheses for readability
- [ ] UI text uses `translate()` function for i18n
- [ ] Follows existing component patterns in the same directory
- [ ] No over-engineering — minimal changes for the desired outcome

### Phase 5: Compare with Sibling Components

For each issue found, compare the specific CSS property with sibling/equivalent component:

```
Component: ListRow (Regular mode)
Property: padding
Ours:      padding: 4px 8px
Sibling:   padding: 2px 4px (compact mode)
Expected:  Match the pattern
```

### Phase 6: Apply Fixes

For each discrepancy:
1. Fix the SCSS file with the correct value
2. Fix the TSX file if structural changes are needed
3. Verify no regressions by checking related components

### Phase 7: Verify

1. Run `npm run typecheck` to ensure no type errors
2. Run `npm run lint` to ensure no lint errors
3. List all changes made with before/after values

## Rules

- **Always check sibling components first** — existing codebase patterns are the source of truth
- **Prefer CSS variables and mixins** over hardcoded values
- **Don't change behavior** — only fix visual/styling issues
- **Don't add features** — polish is about matching the design, not adding new functionality
- **Don't refactor structure** — keep component hierarchy as-is unless it prevents correct styling
- **No `cursor: pointer`** — the app does not use custom cursors
- **One component at a time** — fix completely before moving to the next
- **Preserve existing patterns** — follow the conventions of surrounding code

## Output

Provide a summary table:

| Component | Issue | Before | After | Reference |
|-----------|-------|--------|-------|-----------|
| ListRow | Wrong mixin | raw `font-size: 12px` | `@include text-small` | `_mixins.scss` |
| list.scss | Hardcoded color | `#6e6e6e` | `var(--color-text-secondary)` | `_vars.scss` |

End with total count: `Fixed N issues across M components.`
