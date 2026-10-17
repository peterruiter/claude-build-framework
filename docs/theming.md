# Light and dark themes

**Every UI ships light and dark from day one.** It is a standing rule in CLAUDE.md, part of every
feature's definition of done, and checked by a contract test.

## How

- **Colour tokens on `:root`** (`--bg`, `--surface`, `--text`, `--text-muted`, `--border`,
  `--accent`, `--accent-fg`, `--danger`, `--danger-fg`, `--ring`, …). Components use tokens only,
  never raw colours. Template: [`templates/project/src/styles/tokens.css`](../templates/project/src/styles/tokens.css).
- **System preference first**: `@media (prefers-color-scheme: dark)` sets the dark tokens on
  `:root:not([data-theme="light"])`.
- **Explicit user choice**: `data-theme="light|dark"` on `<html>` overrides the system. Store the
  choice per user (or locally) and apply it before first paint (an inline script in `<head>`) so
  the page does not flash.
- `color-scheme: light|dark` in each block, so form controls and scrollbars follow.
- Foreground tokens for filled colours (`--accent-fg`, `--danger-fg`): white on a light accent
  fails in dark mode.
- Images and logos: a dark variant or a transparent version that works on both.
- Charts: series colours from tokens, checked in both themes; every chart also has a table.

## Contrast, checked

`tests/contracts/theme.test.mjs` reads the token file and the pairs in `build/framework.json`
(`theme.pairs`) and checks every pair **in both themes**: text 4.5:1, large text and UI parts
(focus ring, borders that identify a control) 3:1. It also checks that both themes define the same
tokens and that the system dark block and `data-theme="dark"` agree.

Add a pair whenever a new combination appears (a tag colour on its tint, a warning banner).

## Screenshots and accessibility runs

Every screenshot matrix and every axe run covers **light and dark** at 390 and 1440 px.

## Emails

HTML emails get a dark-mode style too: `<meta name="color-scheme" content="light dark">`,
`@media (prefers-color-scheme: dark)` in the `<style>` block, colours that survive a client's own
dark inversion (avoid pure black on pure white logos; give logos a padding or a background), and
test sends to the main clients in both modes before relying on it.
