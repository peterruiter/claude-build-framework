Capgemini's identity runs on one blue, one typeface and one mark. Everything below tells you which token carries which job, in both themes.

## Content fundamentals

- Write to the reader as "you". Keep sentences short and active.
- Sentence case everywhere: headings, buttons, labels, table headers. Title Case appears only in the wordmark and in proper nouns.
- The brand line is "Get the future you want". Do not paraphrase it, do not translate it, do not set it in anything but the `h1` or `h1-light` style.
- Spell the company **Capgemini**. Never CapGemini, never Cap Gemini, never CG in running copy.
- No emoji in product UI, error messages or navigation.
- Buttons name the action: "Send request", not "Submit". Error messages say what happened and what to do next.

## Colour

Three layers, and they do different jobs.

**1. Brand palette** — `brand-*`. The twelve colours from the Capgemini colour palette, with their Pantone references. Use these for identity work: covers, charts, illustration, large graphic fields. Do not build UI states out of them.

| Token | Hex | Pantone |
| --- | --- | --- |
| `brand-capgemini-blue` | #0058AB | 2144 C |
| `brand-light-blue` | #1DB8F2 | 2995 C |
| `brand-dark-blue` | #121A38 | 4145 C |
| `brand-white` | #FFFFFF | — |
| `brand-turquoise` | #00D5D0 | 2239 C |
| `brand-yellow` | #FEB100 | 130 C |
| `brand-orange` | #FF816E | 2345 C |
| `brand-lilac` | #D4D3F1 | 270 C |
| `brand-teal` | #00828E | 7474 C |
| `brand-terracotta` | #BE4D00 | 7579 C |
| `brand-deep-red` | #8F3237 | 7622 C |
| `brand-purple` | #71609E | 7669 C |

**2. UI ramps** — `capgemini-blue-*`, `neutral-*`, `green-*`, `orange-*`, `red-*`, `peacock-*`, `teal-*`, `basics-*`. Reference values. Read them, do not paint with them.

**3. Semantic tokens** — `page-background`, `surface-*`, `text-*`, `border-*`, `action-*`, `negative-*`. **Paint with these only.** Each one resolves per theme, so a component written against them works in light and dark without a second stylesheet.

Rules:

- Start every screen on `page-background`. Raise panels with `surface-primary-neutral-lite`, tint bands with `surface-cloud-lite`, stripe tables with `surface-fog-lite`.
- Set body copy in `text-primary` and metadata in `text-secondary`. Both clear 6.4:1 on every lite surface in both themes.
- The heavy surfaces — `surface-ink-heavy`, `surface-marine-heavy`, `surface-azur-heavy`, `surface-always-black` — carry `text-always-white` and `text-link-inverse` only. Never put `text-primary` on them; it inverts with the theme and disappears.
- Primary actions use `action-primary-default-on-lite` on light grounds and `action-primary-default-on-heavy` on the heavy blues. Pick by the ground, not by the theme.
- Errors are `negative-on-lite` on lite surfaces, `negative-on-heavy` on heavy ones, over `surface-negative`. Always add a word or an icon: green and red are not distinguished by hue alone here, and `green-*` against `red-*` is a hue-only pair.
- `border-primary` measures 1.6:1 on white and 1.8:1 on the dark page. That is Zodiak's own value and it stays exact, so never let a border alone carry state — pair it with a label, an icon or a fill.
- Focus is `action-focus-on-lite` or `action-focus-on-heavy` as a 2px solid outline at 2px offset, with `shadow-focus` behind it on inputs. The outline carries the meaning; the glow does not.
- `action-active` (#3573C0) clears 3:1 as an indicator but not 4.5:1 as small text. Use it for tab underlines, selected borders and progress fills, never for labels.
- `text-disabled` and `action-disabled-content` sit under 4.5:1 on purpose. Always ship them with the real `disabled` attribute so assistive tech does not rely on the colour.

## Typography

Ubuntu, in Light 300 and Regular 400, is the whole system. Ubuntu Mono covers code and is loaded from Google Fonts; it is not shipped in `fonts/`.

- Headings use `h1` through `h5`. `h1` and `h2` are Light 300 — the brand's headlines are thin and wide, not bold. `h3` upward switch to Regular 400.
- `h1` steps 40 → 32px, `h2` 32 → 24px and `h3` 24 → 20px below 768px. Line height stays 1.25.
- Body copy is `body`: 16px, Light 300, 1.625 line height. `body-strong` is the emphasis weight, not a bold. Never set a paragraph in Medium or Bold.
- `body-small` and `caption` carry metadata and footnotes in `text-secondary`. `caption` is italic.
- Controls use `button-large` at 48px height and `button` at 38px. Form labels use `label`, values use `input`.
- One `h1` per page. Do not skip levels to reach a size — reach for `h3` because it is the third level, not because it is 24px.
- Ubuntu Bold 700 exists for data emphasis and nothing else. Medium 500 is for dense UI where Regular reads too light.

## Spacing and layout

A 4px base step: `space-1` (4px) through `space-16` (64px). Inputs take `space-3` vertical and `space-4` horizontal. Buttons take `space-6` horizontal. Cards take `space-6` inset, `space-5` below 768px. Sections separate by `space-12`, page bands by `space-16`.

The names are this system's. Zodiak does not publish spacing names, so match the values, not the labels, when you compare against Figma.

## Borders, radii and elevation

- `radius-sm` (4px) on inputs, selects, text areas and tables.
- `radius-pill` (24px) on buttons and filter chips — a 48px control reads as a full pill at that value.
- `radius-full` on avatars, toggles and icon-only round buttons.
- `radius-md` (8px) and `shadow-card` are additions, not source values. Capgemini separates cards with `border-primary` and a surface change, not with shadow. Reach for elevation only when a card genuinely floats.

## Logo

`assets/Logos/` holds the 2025 logo set: the primary lockup and the spade, each in Capgemini Blue and in white, as SVG and PNG.

- Blue lockup on `page-background`, `surface-always-white` and light photography.
- White lockup on `surface-ink-heavy`, `surface-marine-heavy`, `surface-azur-heavy` and dark photography.
- Clear space on all four sides is the height of the spade in the lockup. Nothing enters it.
- Minimum width 120px on screen for the lockup, 32px for the spade.
- Never recolour the mark, never add effects, never place the blue lockup on a blue ground, never rebuild it from type. Use the files.
- The spade alone stands in for the brand only where the full name already appears — favicons, app icons, avatars.

## Iconography

Zodiak ships an icon font (`zodiak-icons`) that is not in these sources, so this system has no icon set. Until it is added, use a single outline library at 24px on a 24px box with a 1.5px stroke, and colour icons with `text-primary`, `text-secondary` or `text-link` in the markup. SVGs referenced through `<img>` cannot inherit colour — inline them or ship a per-colour file.

## Imagery

Photography is people-first and unfiltered. Lay `overlay-photo-style` over an image before any text: it is transparent in the light theme and a 10% black scrim in the dark. Buttons over photography use `action-primary-default-on-photographic` with `text-always-white`, and that pairing needs the scrim to be legible.

## Themes

`light` is the default and the first theme; `dark` mirrors it token for token. Switch by setting `data-theme="dark"` on the root. Every semantic token resolves in both, so no component needs a theme branch. The `always-*` tokens deliberately do not flip — use them when a ground is fixed, such as a logo lockup or a print-matched panel.
