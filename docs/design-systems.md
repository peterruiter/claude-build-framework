# Design systems: one design system drives everything

**Every output a project makes looks like one product.** A project picks one design system when it
is set up, and that one system feeds the web UI, code components, model-driven apps, emails,
charts, documents, slides, video tours, store images and icons. Nobody picks a colour by eye, and
a rebrand is a regenerate, not a hunt.

**Every UI ships light and dark from day one.** It is a standing rule in CLAUDE.md, part of every
feature's definition of done, and checked by a contract test.

## Where design systems live

[`design-systems/`](../design-systems/README.md) in the framework, one folder per system:
`design-system.json` (the manifest), `tokens.json` (the Claude Design System token format, as
copied), `README.md` (the brand book), and where the system has them `components/`, `fonts/` (with
the font licence), `assets/` (logos) and a `README-USE.md` with brand use rules.

| Design system | For |
| --- | --- |
| `neutral` | The framework's default: no brand, system fonts, one blue accent. Any project without a brand of its own. |
| `capgemini-zodiak` | Capgemini work only (Capgemini's 2025 identity on the Zodiak token layer: one blue, Ubuntu, the spade). Read its [README-USE.md](../design-systems/capgemini-zodiak/README-USE.md) first: the brand is Capgemini's trademark, the logo rules are strict, and repositories that carry it stay private. |

A design system that also lives on Claude as a **Claude Design System artifact** names that
artifact in `source.claudeArtifact`. The artifact is the source of truth for Claude Slides and
Design artifacts (the Artifact tool picks the account's org default design system by itself); the
copy in `design-systems/` is what code uses. When the artifact changes, copy it again
(`design-system` skill) and bump the version.

## Choosing one

`new-project` asks it as its fifth question: it lists `design-systems/*` and recommends the
account's org default design system when the owner's Claude account has one that matches (for an
owner whose org default is Capgemini Zodiak, `capgemini-zodiak`), and `neutral` otherwise. The
answer goes into `build/framework.json` (`designSystem`), the Project facts in CLAUDE.md, and the
generated files. Switch later with the `design-system` skill.

## The generator

[`scripts/design-system.mjs`](../scripts/design-system.mjs), Node's own modules only:

```
node scripts/design-system.mjs list
node scripts/design-system.mjs check <id>
node scripts/design-system.mjs build <id> --out <dir> [--targets css,ts,fluent,dataverse,email,charts,video,office]
node scripts/design-system.mjs show <id> --target <target>      # one target to stdout, paths absolute
```

`build` refuses a design system that fails `check`, writes deterministic files (no dates, so a
regenerate gives a clean diff), and copies what the outputs point at (fonts with their licence,
logos, the brand use note as `BRAND-USE.md`) so the output folder works on its own. It always
writes `tokens.json`.

| Target | Files | Used by | Goes to |
| --- | --- | --- | --- |
| `css` | `tokens.css`, `fonts/` | Web UI | the app's stylesheet folder; import it first |
| `ts` | `tokens.ts` | JavaScript that needs colours (canvas, charts, inline styles) | next to `tokens.css` |
| `fluent` | `fluent-theme.ts`, `fluent-theme.json` | React with Fluent UI v9, PCF code components | the component's source |
| `dataverse` | `dataverse-theme.xml`, `dataverse-app-header.xml`, `dataverse-theme.json` | Model-driven apps | a web resource in the solution |
| `email` | `email-palette.json`, `logos/` | Transactional emails | the email templates |
| `charts` | `chart-palette.json` | Every chart | the chart code |
| `video` | `video-brand.json`, `fonts/`, `logos/` | `tools/video-tour` | `brand` in `video-tour.config.json`, or `brand.designSystem` |
| `office` | `office-theme.json` | Word and PowerPoint documents | the document template's theme |

### Roles: the same names in every system

Each manifest maps **roles** (`background`, `surface`, `text`, `textMuted`, `border`, `accent`,
`textInverse`, `focus`, `danger`, and optional `link`, `active`, `heavy`, `textOnHeavy`,
`dangerSurface`, ...) to its own tokens. The Fluent, Dataverse, email and video outputs are built
from roles, and `tokens.css` exposes each as `--ds-<role>` (`--ds-background`, `--ds-text`,
`--ds-accent`, `--ds-focus`, ...). Write shared app code against `--ds-*` and it survives a switch
of design system; write against the system's own tokens (`--text-primary`) where the brand book
asks for a specific token, as a system's own components do.

## Every output, from the one system

- **Web UI**: `tokens.css` (semantic tokens per theme, the palette, fonts as `@font-face` with
  relative URLs, spacing, radius, shadow, the type scale as `--type-<style>-*` variables and
  `.type-<style>` classes, the `--ds-*` roles, a focus ring and reduced motion). Components use
  tokens only, never raw colours. A system with components (`components/bundle.css` with its
  classes, `bundle.js` as a React global, `index.d.ts`) can be used as is: load the bundle CSS
  after `tokens.css`.
- **PCF code components**: `fluent-theme.ts` exports `brand` (a Fluent `BrandVariants` ramp, 10 to
  160, with the system's brand colour exactly at 80), `lightTheme` and `darkTheme` (Fluent's own
  themes with the semantic colours, fonts and radius laid over). Inside a model-driven app a
  control normally follows the host's theme (`context.fluentDesignLanguage`); use the generated
  theme for canvas apps, custom pages, the test harness, or where the control must carry the brand
  ([Style components with modern theming](https://learn.microsoft.com/power-apps/developer/component-framework/fluent-modern-theming)).
  Profile: [`power-platform-pcf`](../profiles/power-platform-pcf/), and
  [PCF code components](#pcf-code-components) below.
- **Model-driven apps** (modern look): `dataverse-theme.xml` is a `CustomTheme` with
  `basePaletteColor`, `lockPrimary="true"`, the font, all 16 palette slots (`darker70` ... `primary`
  ... `lighter80`, the same ramp as Fluent) and `AppHeaderColors` for every header state, each
  checked at 4.5:1. Add it to the solution as a Data (XML) web resource and set it in the **Custom
  theme definition** setting; `dataverse-app-header.xml` alone goes in **Override app header
  color** (ignored when a custom theme is set). For a logo, add an image web resource (about
  156 × 48) and `logoWebResource`/`logoTooltip`. Model-driven apps have no dark mode for custom
  themes and do not load web fonts. Format:
  [Use modern themes in model-driven apps](https://learn.microsoft.com/power-apps/maker/model-driven-apps/modern-theme-overrides).
  Profile: [`dataverse-solution`](../profiles/dataverse-solution/README.md).
- **Emails**: `email-palette.json` holds opaque hex values (no variables, no alpha) for light and
  dark: background, surface, text, muted text, link, border, button fill and label, header fill
  and text, and the PNG logos for the header and for light grounds. Light inline; dark in a
  `@media (prefers-color-scheme: dark)` block (see [Emails](#emails) below).
- **Charts**: `chart-palette.json` lists the series in order for light and dark, each with its
  contrast against the background. Every chart labels its series directly and has a table; a
  series under 3:1 against the background needs that label.
- **Documents**: `office-theme.json` maps the Office theme slots (`dk1`, `lt1`, `dk2`, `lt2`,
  `accent1`–`accent6`, `hlink`, `folHlink`) and the heading and body fonts; for a system with a
  `word-template.md` it is read from that file (with the page setup, the named styles and the
  classification options), and `check` fails when its colours disagree with the tokens. Build
  Word documents from the brand's own template when there is one (attach it; never rebuild the
  cover by hand), otherwise apply the mapping to a template. A document in Claude Docs uses the
  same palette and type names.
- **Slides and designs**: use the Claude Design System artifact (the Artifact tool's quickstart
  and publish pick the account's org default design system); a `.pptx` uses `office-theme.json`.
- **Video tours**: `video-brand.json` is the `brand` block for
  [`tools/video-tour`](../tools/video-tour/README.md) (colours for the cards, the font file, the
  logo for a dark backdrop). Or set `"brand": { "designSystem": "<id>" }` in
  `video-tour.config.json` and the tool resolves it through the script; colours, font or logo set
  next to it override the design system's.
- **Store and marketing images**: the same palette, fonts and logos; the logo files as they are,
  on the ground the logo rules allow, with their clear space. Screenshots for stores come from the
  real app in both themes.
- **Favicons and app icons**: from the mark (for a brand, the mark alone only where its rules allow
  it, typically favicons, app icons and avatars), on a ground the rules allow, at the minimum size
  or larger. Never recolour or redraw a mark; for a system without a logo, the product's own icon.

## PCF code components

For the [`power-platform-pcf`](../profiles/power-platform-pcf/) profile: generate the `fluent` and
`ts` targets into the component's source (for example
`node "${CLAUDE_PLUGIN_ROOT}/scripts/design-system.mjs" build <id> --out <Control>/design-system --targets fluent,ts`;
the folder name is the project's choice).

- In a **model-driven app**, wrap the control in a `FluentProvider` with the host's theme
  (`context.fluentDesignLanguage?.tokenTheme`) so it matches the app, which the app's
  `dataverse-theme.xml` already brands; when the host passes none, fall back to the generated
  `darkTheme` or `lightTheme` by `context.fluentDesignLanguage?.isDarkTheme` (in place of Fluent's
  `webDarkTheme` and `webLightTheme`). Portalled Fluent content (dialogs, popovers) gets the same
  theme in its own `FluentProvider`.
- In a **canvas app, a custom page or the test harness**, or when the control must carry the brand
  itself, use the generated `lightTheme` or `darkTheme`.
- Colours outside Fluent controls come from `tokens.ts` (`role('accent')`, `color(...)`), never
  as literals.
- Fonts: a code component cannot rely on the brand's web font being loaded in the host; the
  generated themes name a font stack that falls back.

## Light and dark

- **Colour tokens on `:root`**, generated: the first `:root` block holds the light values of the
  semantic tokens; the palette, fonts, spacing and roles follow in a second `:root` block.
- **System preference first**: `@media (prefers-color-scheme: dark)` sets the dark tokens on
  `:root:not([data-theme="light"])`.
- **Explicit user choice**: `data-theme="light|dark"` on `<html>` overrides the system. Store the
  choice per user (or locally) and apply it before first paint (an inline script in `<head>`) so
  the page does not flash.
- `color-scheme: light|dark` in each block, so form controls and scrollbars follow.
- Foreground tokens for filled colours (a label colour per fill, such as `--accent-fg` or
  `--text-inverse`): white on a light accent fails in dark mode.
- Images and logos: a dark variant or a transparent version that works on both; for a brand, the
  logo file its rules give for that ground.
- Charts: series colours from the chart palette, checked in both themes; every chart also has a
  table.

## Contrast, checked

Twice:

1. **`design-system.mjs check <id>`** (the quality gate runs it for the project's system): token
   names unique, every semantic token has a light and a dark value, every reference resolves, the
   roles and files the manifest names exist, every documented pair (`contrast.pairs`: text on its
   surfaces 4.5:1, focus rings and indicators 3:1) passes in both themes, and so do the pairs the
   generated outputs rely on (button labels, email and app header text, video cards). The brand
   book's own intentional exceptions (`contrast.known`, each with its reason: a decorative border,
   disabled labels, an indicator colour that is not for text) are reported as known, not failed.
   Shortfalls found in a source that its brand book does not mention are recorded with
   `"documented": false` and reported as findings, so nobody builds on them.
2. **`tests/contracts/theme.test.mjs`** in the project reads the generated `tokens.css` and
   `tokens.json` (`theme.css` and `theme.tokens` in `build/framework.json`) and checks the design
   system's pairs plus the project's own (`theme.pairs`) **in both themes**, that both themes
   define the same tokens, that the two dark blocks agree, and that the files were generated from
   the system `designSystem.id` names.

Add a project pair to `theme.pairs` whenever a new combination appears (a tag colour on its tint,
a warning banner), with CSS custom property names.

## Screenshots and accessibility runs

Every screenshot matrix and every axe run covers **light and dark** at 390 and 1440 px.

## Emails

HTML emails get a dark-mode style too: `<meta name="color-scheme" content="light dark">`,
`@media (prefers-color-scheme: dark)` in the `<style>` block with the palette's dark values,
colours that survive a client's own dark inversion (avoid pure black on pure white logos; give
logos a padding or a background), PNG logos with width, height and alt text, and test sends to the
main clients in both modes before relying on it. Web fonts do not load in most clients; the
palette's font stack falls back.

## Switching, regenerating, adding

- **Regenerate** after the design system changes (a new version in `design-systems/`): run the
  `build` command in `build/framework.json`'s terms (`designSystem.id`, `.out`, `.targets`), then
  the contract tests, and look at screenshots in both themes.
- **Switch** with the `design-system` skill: it changes `designSystem.id`, regenerates, clears
  `theme.pairs` that name the old system's tokens, and lists the code that uses the old system's
  own token names (code on `--ds-*` roles needs no change).
- **Add** a design system from a Claude Design System artifact with the same skill: read the
  artifact's files with the Artifact tool, copy them into `design-systems/<id>/`, write the
  manifest (roles, documented pairs and exceptions, charts, video, Office), and run `check`.
- **Fonts** are served from the product, never from a third party's font CDN (it sends each
  visitor's address there), and their licence file travels with them.
