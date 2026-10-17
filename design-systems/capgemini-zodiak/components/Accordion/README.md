# Accordion

The expander pattern from the locations and FAQ sections: a title row with a `border-primary` rule underneath, a chevron that rotates on open, and content that appears below. One panel open at a time.

## Props

- `items` — `{ title, content }` pairs.
- `defaultOpen` — index open on first render. Omit to start with everything closed.

## Geometry

Title row is 20px Regular with 0.1px tracking, padding 16px 24px, chevron 24px from the label. The open row thickens its rule to 2px and drops the title to Light 300, exactly as the source does. Content padding is 24px.

The generic `.expanders` block on capgemini.com runs its titles at 28px; this component uses the 20px value from the locations expanders, which matches the `h4` step in the type scale.

## What you provide

`content` can be any node, including another component. Keep each panel to one idea — an accordion that hides essential information is a scroll problem, not a disclosure problem.

## Do not

- Do not put an accordion inside an accordion.
- Do not hide anything a reader needs before they can act, such as pricing or a legal term.

## Accessibility

Each title is a `button` with `aria-expanded` and `aria-controls`; the panel is a `region` labelled by its title. Keyboard users reach every title with Tab and open it with Enter or Space.
