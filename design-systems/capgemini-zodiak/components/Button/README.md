# Button

An outline pill that fills on hover. Capgemini has no solid-by-default button; the filled state is the hover state.

Provide the label as children. The component renders a `button` unless you pass `href`, which renders an anchor with the same styling.

## Props

- `variant` — `primary` (default) or `secondary`. They map to the `action-primary-*` and `action-secondary-*` token families. Zodiak gives both families the same values today, so the two look identical; use `primary` for the single main action on a screen so the split stays meaningful when the tokens diverge.
- `tone` — `lite` (default) or `heavy`. Pick by the ground, not the theme: `heavy` on `surface-ink-heavy`, `surface-marine-heavy`, `surface-azur-heavy` and `surface-always-black`.
- `size` — `md` (48px, default) or `sm` (38px). `sm` is the filter and toolbar size.
- `icon` — adds the trailing arrow. Use it when the button navigates away, not when it submits.
- Everything else passes through to the element, including `disabled`, `onClick`, `type` and `aria-*`.

## Geometry

48px tall, `radius-pill`, padding 8px 22px 8px 24px, 16px Light with 0.208px tracking. The 38px size drops to 14px with 0.168px tracking and 8px/16px padding. Those are the capgemini.com values, copied as they are.

## Use it for

- One primary action per view. Everything else is `secondary` or a `Link`.
- Labels that name the action: "Send request", "Read the report". Sentence case.

## Do not

- Do not put a `lite` button on a heavy blue surface. The border disappears.
- Do not use `icon` on a submit button. The arrow means navigation.
- Do not stack more than two buttons side by side. Use a `Link` for the third option.

## Accessibility

Focus is a 2px `action-focus-on-lite` outline at 2px offset, or `action-focus-on-heavy` on heavy tone. The source declares 1px; this system uses 2px to match the treatment its tags and inputs already use and to clear the 3:1 floor comfortably.

Disabled buttons sit below 4.5:1 by design. Always set the real `disabled` attribute so the state does not rest on colour.
