# Accessibility (WCAG 2.2 AA)

**WCAG 2.2 AA is the default target from day one**, not a late pass. It is a standing rule in
CLAUDE.md, part of every feature's definition of done, in every agent brief, and in the quality
gate. On top of that, run a full **accessibility pass** (`a11y-pass` skill) before the first
public release and after large UI waves. A full pass touches many shared components, so run it
when few other agents run, with "small targeted edits" rules.

## Every feature (definition of done)

- **Keyboard**: everything reachable and usable; no traps except dialogs (which return focus).
- **Focus visible** (2.4.7) with ≥ 3:1 ring, and **not obscured** by sticky bars (2.4.11).
- **Labels and names** for every control, translated; icon buttons have accessible names.
- **Contrast**: text 4.5:1, UI parts 3:1, in **light and dark** ([design-systems.md](design-systems.md#light-and-dark)).
- **Target size** at least 24×24 px or spaced (2.5.8).
- **Reduced motion** honoured (2.3.3).
- **`lang`** on the page and on content in another language (3.1.1, 3.1.2).
- **Status messages** in live regions (4.1.3); errors as `alert`.
- **Reflow** at 320 px without sideways scrolling (1.4.10).
- axe run on the changed pages, light and dark, 390 and 1440; screenshots in both themes.

## The approach

1. **Automated: axe-core through Playwright** over every main page, in light and dark, at 1440
   and 390 px (and 320 for reflow): `node tests/a11y/axe-pages.mjs`. Template:
   [`templates/project/tests/a11y/`](../templates/project/tests/a11y/), pages listed in
   `tests/a11y/pages.json`. Rules: WCAG 2.0/2.1/2.2 A and AA tags.
2. **Probes for what axe cannot see** (`--probes`): skip link first in the tab order (2.4.1);
   exactly one h1 (1.3.1); `lang` matches the page's language (3.1.1); a visible focus change on
   the first 25 tab stops (2.4.7); none hidden behind a sticky bar (2.4.11); targets at least
   24×24 or spaced (2.5.8); no sideways scrolling (1.4.10).
3. **A keyboard script** for the patterns of the app: skip link moves focus to main; dialogs trap
   focus and return it to the opener; Escape closes the top-most layer only; arrow keys in tab
   lists; Enter on clickable table rows. Project-specific; write it next to `axe-pages.mjs`.
4. **Contract tests for shared components** (no browser): Modal/Drawer named by their heading,
   status/alert live regions present before a message, colour token pairs meet 4.5:1 (text) and
   3:1 (focus ring, UI) in both themes, reduced-motion rule present.
5. **Manual checks** the tools cannot do: text spacing (1.4.12), 200 % zoom, dragging
   alternatives (2.5.7), redundant entry (3.3.7), accessible authentication (3.3.8, allow paste,
   `one-time-code`), charts have a table, emails (`lang`, `role="presentation"`, alt texts).
6. **Known limitations** go in `tests/a11y/known.json` **with a reason**, and the same list is on
   the public **accessibility statement** page (target, known limitations with reasons, contact).

## Findings table

| # | Criterion | Where | Severity | Fixed? |
| --- | --- | --- | --- | --- |
| 1 | 2.4.7 focus visible | Every control: 20 % halo ≈ 1.3:1 | Serious | Yes: 2 px ring ≥ 3:1 in both themes |

Report counts per severity and "before → after" violation counts per surface. Be honest about what
was not done (screen readers, native shells on devices, an external audit).

## Common fixes that recur

- One focus ring token (gap + ring, ≥ 3:1 on both themes, outline in forced colours).
- One dialog keys helper for every modal and drawer (trap, top-most Escape, focus return).
- Clickable rows: focusable, Enter/Space.
- Arrow keys, Home, End in tab lists and segmented controls.
- Scrollable regions focusable (`tabindex="0"`), labelled.
- `scroll-padding` for sticky headers so focus is not obscured.
- Persistent `status` and `alert` live regions; errors are `alert`, not `polite`.
- Typed position fields as an alternative to dragging.
