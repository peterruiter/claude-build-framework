# Checkbox

The styled checkbox from the theme's forms: a 17px box with a 2px border at 3px radius, filled with the tick when checked.

## Props

- `label` — the visible, clickable label.
- Everything else passes through, including `checked`, `defaultChecked`, `onChange`, `disabled` and `name`.

## Colour

The source hard-codes the border and fill to black (#000 and #202020). This component binds them to `text-primary` instead, so the control stays visible in the dark theme. That is the one deliberate departure from the source in this component.

## Do not

- Do not use a checkbox for a single yes/no that applies immediately. That is a toggle.
- Do not nest checkboxes for a parent/child relationship without also wiring `aria-checked="mixed"` on the parent.

## Accessibility

Focus shows a 2px `action-focus-on-lite` outline at 2px offset, plus the 3px soft glow the source uses. The visible box is `aria-hidden`; the real input carries the state.
