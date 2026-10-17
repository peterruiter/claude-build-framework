# Neutral

The framework's default design system: no brand, the system's own fonts, one blue accent, and a
light and a dark theme that both pass WCAG 2.2 AA. Projects without a brand of their own start
here; a project with a brand adds that brand as a design system and switches
(`/build-framework:design-system`).

## Colour

Ten semantic tokens. Components paint with these only, never with raw colours.

| Token | Light | Dark | Job |
| --- | --- | --- | --- |
| `bg` | #ffffff | #121418 | The page |
| `surface` | #f5f6f8 | #1c2027 | Raised panels, cards, table stripes |
| `text` | #1b1f24 | #e8eaee | Body copy and headings |
| `text-muted` | #5b6577 | #a3acba | Metadata and helper text (still 4.5:1) |
| `border` | #c4cad3 | #5c6573 | Dividers and outlines (decorative) |
| `accent` | #2456c7 | #8fb0ff | Primary buttons, links, selected states |
| `accent-fg` | #ffffff | #0d1526 | Text on an accent fill |
| `danger` | #b3261e | #ff8a80 | Errors and destructive actions |
| `danger-fg` | #ffffff | #2a0705 | Text on a danger fill |
| `ring` | #2456c7 | #8fb0ff | Focus ring, 2px solid, 2px offset |

- `accent-fg` and `danger-fg` flip with the theme because the dark accent and danger are light;
  white on a light accent would fail in dark mode.
- `border` is decorative (1.5:1 or more). Where a border is the only thing that shows a control's
  edge or state, it needs 3:1, or a label, an icon or a fill beside it.
- Errors always carry a word or an icon; colour alone never carries meaning.

## Type

The system font stack (`system-ui`, Segoe UI, Roboto, Helvetica Neue, Arial). Headings `h1`
(32px, 28px below 768px), `h2` 24px, `h3` 20px; `body` 16px at 1.5; `body-small` 14px for
metadata in `text-muted`; `code` in the system monospace font.

## Spacing, radius, elevation

A 4px step (`space-1` 4px to `space-12` 48px). `radius-sm` 4px on inputs and tables, `radius-md`
8px on cards, dialogs and buttons, `radius-full` for pills and avatars. Separate cards with
`surface` and `border`; `shadow-card` only when a card really floats.

## Logo, charts, video, documents

No logo ships with this system: the product draws its name as a wordmark until it has one.
Charts use the eight series in `design-system.json` (accent first), each with a table and direct
labels. Video tours use the dark theme's colours. Office documents use Aptos with the chart
colours as theme accents.
