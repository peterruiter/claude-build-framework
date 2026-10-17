# Card

The content box used across insights, news and careers listings: optional image that scales on hover, a category eyebrow with the turquoise sweep, a title that sweeps on card hover, meta line, body copy and a footer slot.

## Props

- `image`, `imageAlt` — the image scales 1.1x on card hover. Pass `imageAlt=""` when the image carries no information.
- `eyebrow`, `eyebrowHref` — the category label above the title, with the `brand-turquoise` sweep from the theme.
- `title`, `href` — pass `href` to link the title; the card's hover state then sweeps it.
- `meta` — one value or an array. Several values are separated by the 4px dot from the theme.
- `children` — body copy.
- `footer` — usually a `Button` with `size="sm"` or a `Link`.

## What you provide

The container. The card has no width of its own and no padding around its text, matching the source, where cards sit in a grid column. Give it a column or a `max-width`, and space cards apart with `space-6`.

## Do not

- Do not make the whole card a link. The source links the title and the eyebrow separately so each destination is announced.
- Do not put two actions in the footer. One is the pattern.
- Do not add a shadow. Cards separate by surface and spacing, not elevation.
