# Input

A single-line text field, 48px tall on `radius-sm` with a `border-primary` hairline, matching the theme's form controls.

## Props

- `label` — renders a real `label` bound to the input.
- `hint` — helper text under the field, in `text-secondary`.
- `error` — error text in `negative-on-lite`. Also sets `aria-invalid` and the negative border, and replaces the hint.
- `size` — `md` (48px, default) or `lg` (58px, the size the marketing forms use).
- Everything else passes through, including `type`, `placeholder`, `value`, `onChange` and `required`.

## Geometry

Padding 12px 16px, 16px Light, `radius-sm` (4px), 1px `border-primary`. Focus adds a 2px `action-focus-on-lite` outline at 2px offset over `shadow-focus`.

## Do not

- Do not use the placeholder as the label. It disappears on the first keystroke.
- Do not mark errors with the border alone. `border-primary` to `negative-on-lite` is a colour-only change; the `error` text is what carries the meaning.
- Do not disable a field to show it is read-only. Use `readOnly`.
