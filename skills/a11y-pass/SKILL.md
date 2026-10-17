---
name: a11y-pass
description: Full accessibility pass to WCAG 2.2 AA - axe-core through Playwright over every main page in light and dark at 1440/390 (and 320 for reflow), probes for skip link, one h1, lang, visible and unobscured focus, 24px targets and sideways scrolling, a keyboard script for dialogs/drawers/tabs, manual checks (text spacing, zoom, dragging alternatives, accessible authentication), contract tests for shared components and theme contrast, fixes, known limitations with reasons and an accessibility statement page. Use when the user asks for an "accessibility pass", "WCAG", "a11y audit", "screen reader", or before the first public release.
argument-hint: "[surfaces or pages]"
---

# Accessibility pass

Reference: `${CLAUDE_PLUGIN_ROOT}/docs/accessibility.md` and `${CLAUDE_PLUGIN_ROOT}/docs/design-systems.md`.
WCAG 2.2 AA is part of every feature's definition of done; this pass is the full sweep on top.

## 1. Set up

- Pin and install the tools outside the product: `npm i --prefix <folder> playwright@<pinned>
  axe-core@<pinned>`; `A11Y_TOOLS=<folder>`.
- Run the app locally with demo data on a scratch database and your own port.
- Make `tests/a11y/pages.json` list **every main page** (and dialogs via `open`), with `lang` per
  page and a `signIn` module for signed-in pages.
- Run the pass when few other agents run; small targeted edits in shared components.

## 2. Measure ("before")

```
node tests/a11y/axe-pages.mjs --probes --json scratch/a11y-before.json
node tests/a11y/axe-pages.mjs --probes --widths 320 --page <wide pages>
node --test "tests/contracts/*.test.mjs"     # theme contrast in light and dark
```
Plus the keyboard script for the app's patterns (skip link → main, dialog trap and focus return,
top-most Escape, arrow keys in tab lists, Enter on clickable rows) and the manual checks: text
spacing (1.4.12), 200 % zoom, dragging alternatives (2.5.7), redundant entry (3.3.7), accessible
authentication (3.3.8), charts with tables, emails (lang, presentation tables, alt texts, dark).

## 3. Findings and fixes

Table: `# | Criterion | Where | Severity (serious/moderate/minor) | Fixed?`. Fix at the shared
component (one focus ring token, one dialog-keys helper, clickable rows, composite keys, scroll
regions, live regions, scroll-padding). Translate every new accessible name into every configured
language. Add contrast pairs for new colour combinations.

## 4. Guard

- Contract tests for shared components (names, live regions present before messages, token
  pairs, reduced motion, skip links).
- Remaining findings in `tests/a11y/known.json` **with reasons**, identical to the known
  limitations on the **accessibility statement** page (target WCAG 2.2 AA, limitations, contact;
  in every configured language; linked from every footer).

## 5. Report

Before → after violation counts per surface, counts per severity (fixed / not), screenshots, what
was not done (screen readers, native shells, external audit). One What's new entry. STATE.md section.
