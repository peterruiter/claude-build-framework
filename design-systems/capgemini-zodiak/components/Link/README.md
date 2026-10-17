# Link

An inline text link that sweeps a highlight bar up from the baseline on hover. That sweep is the Capgemini signature; it comes from the theme's `linear-gradient(to right, …) no-repeat 0 100% / 0 100%` with `background-size: 100% 100%` on hover.

## Props

- `variant` — `default` sweeps `border-secondary`, `highlight` sweeps `action-highlight-on-lite` and sets the label to `text-primary`, `inverse` is for the heavy blue surfaces.
- `underline` — adds a persistent underline with a 3px offset.
- Everything else passes through to the anchor, including `href`, `target` and `rel`.

## Use `underline` inside running copy

`text-link` (#1D365A) and `text-primary` (#171A22) are close in value. A link inside a paragraph told apart by colour alone is not reliably visible, and the sweep only appears on hover. Set `underline` for any link inside body text. Standalone links in a list, a card footer or a navigation row can leave it off, because position already marks them.

## Do not

- Do not use `highlight` for more than one link in a block. It reads as a marker pen.
- Do not use a link where the action changes data. That is a `Button`.
- Do not write "click here" or "read more" on its own. Name the destination.
