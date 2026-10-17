# Select

A native `select` with the same geometry as `Input`, plus the chevron drawn inline.

## Props

- `options` — strings, or `{ value, label }` pairs.
- `label`, `hint`, `error`, `size` — as on `Input`.
- Everything else passes through, including `value`, `defaultValue`, `onChange`, `multiple` and `required`.

## Why native

The theme's own selects are enhanced with Select2, which brings a listbox, a search field and its own focus handling. This component keeps the native control: it inherits the platform's keyboard behaviour, works on touch, and needs no library. Swap it for a combobox only when the list is long enough to need search.

## Do not

- Do not use a select for fewer than four options. Use radios.
- Do not put an empty first option without a label. Give it one, such as "Select an industry".
