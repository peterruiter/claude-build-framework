# DataTable

The listing table from the careers and archive pages. Rows highlight to `border-secondary` on hover, cells carry a `border-primary` rule underneath, and the first cell in each row is set larger than the rest.

## Props

- `columns` — `{ key, header }` pairs. The key names the field on each row.
- `rows` — objects keyed by those column keys. Values can be any node, so a cell can hold a `Link` or a `Button`.
- `caption` — the accessible name for the table. Always set it.

## Geometry

Cells are 12px with 16px 24px padding, top aligned, `white-space: nowrap`. The first cell in each row steps up to 16px Light with 0.3px tracking and wraps. That asymmetry is the source's, and it is what makes the first column read as the row's subject.

## What you provide

All the data. The component does no sorting, paging or filtering — wire those above it and pass the rows you want shown.

## Do not

- Do not use it for layout. It is a data table.
- Do not let a row's only action be the row click. Put a real control in a cell.

## Accessibility

The table is built from `div` elements with `role="table"`, `row`, `columnheader` and `cell`, matching how the source markup works. If you need sorting, row selection or a caption longer than a label, use a real `table` element instead — roles alone will not carry that.
