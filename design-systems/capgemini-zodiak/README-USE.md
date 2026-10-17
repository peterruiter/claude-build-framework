# Using this design system: brand rules

Read this before you use anything in this folder.

## Whose brand this is

The Capgemini name, the logo lockup, the spade, the colour palette and the look described in
[README.md](README.md) are **Capgemini trademarks and brand assets**. This folder carries them so
that Capgemini work built with the framework looks like Capgemini, consistently, without anyone
re-drawing a logo or guessing a colour.

- **Capgemini work only.** Use this design system for products, prototypes, documents, decks and
  videos made for or by Capgemini. Do not use it for anything else, and do not choose it for a
  project just because it is the default; pick `neutral` or the client's own system instead.
- **Keep the repository private.** A repository that contains this folder, or files generated from
  it (logos, fonts, themes), stays private unless Capgemini's brand owners have agreed otherwise.
  The framework repository itself is private for this reason.
- **No new marks.** Never make a new logo, icon set or wordmark from these files, and never
  present a product as a Capgemini product unless it is one.

## Logo rules

From [assets/Logos/README.md](assets/Logos/README.md) and the brand book:

- **Use the files as they are.** Never recolour the mark, never add effects (shadow, glow,
  outline, gradient), never rebuild it from type, never stretch, rotate or crop it. The ink is
  baked into each file; pick the file that matches the ground.
- **Ground**: the blue lockup on `page-background`, `surface-always-white` and light photography;
  the white lockup on `surface-ink-heavy`, `surface-marine-heavy`, `surface-azur-heavy` and dark
  photography. Never the blue lockup on a blue ground.
- **Clear space**: the height of the spade in the lockup, on all four sides. Nothing enters it.
- **Minimum size**: 120 px wide on screen for the lockup, 32 px for the spade.
- **The spade alone** only where the full name already appears: favicons, app icons, avatars.
- Aspect ratios: lockup 358 × 117, spade 150 × 139.

## Fonts

Ubuntu is under the Ubuntu Font Licence 1.0 ([fonts/LICENCE.txt](fonts/LICENCE.txt)). Keep that
file next to the fonts wherever they are copied; the framework's build does this for you. Ubuntu
Mono is not shipped; code falls back to the system's monospace font. Do not load fonts from a third
party's CDN in a product (it sends the visitor's address there); serve the copies from the product.

## When in doubt

Ask the owner before something branded leaves the team: a public site, a store listing, a video
on a public channel, a document sent to a client. Approval for one does not carry over to another.
