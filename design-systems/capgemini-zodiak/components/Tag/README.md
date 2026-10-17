# Tag

The filter chip from the archive pages: a filled `text-link` pill at 16px radius carrying `text-inverse`, with an optional remove control.

## Props

- `onRemove` — shows the remove control and fires on click. Leave it off for a read-only label.
- `removeLabel` — accessible name for that control. Default `"Remove"`. Make it specific: `Remove Cloud filter`.
- `quiet` — outline instead of filled, for labels that are not removable filters.
- Children are the label.

## Geometry

Padding is 4px 16px, or 4px 4px 4px 16px when removable. The source declares `4px 16px 4px 4px`; this system mirrors it so the remove control sits on the trailing edge, which is where the archive pages place it.

## Use it for

- Active filters above a result list, each removable.
- Content type and reading time on a card, as `quiet`.

## Do not

- Do not use a tag as a button. Give it `onRemove` or nothing.
- Do not colour-code tags by category. The fill is fixed to `text-link`; category goes in the label.

## Accessibility

The remove control is a real `button` with its own accessible name, focusable and reachable by keyboard. Announce the result of a removal in a live region — the chip disappearing is not enough on its own.
