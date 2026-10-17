# Design systems

One folder per design system. A project picks one when it is set up, and
[`scripts/design-system.mjs`](../scripts/design-system.mjs) generates everything the project needs
from it: CSS tokens for light and dark, tokens for JavaScript, a Fluent UI theme, a model-driven
app theme, email and chart palettes, the video-tour brand block and an Office theme mapping. The
method is in [docs/design-systems.md](../docs/design-systems.md).

```
node scripts/design-system.mjs list
node scripts/design-system.mjs check <id>
node scripts/design-system.mjs build <id> --out <dir> [--targets css,ts,fluent,dataverse,email,charts,video,office]
```

`neutral` is the framework's default for projects without a brand of their own. The others are
listed by `list`; each folder's `README.md` is its brand book, and a `README-USE.md`, where there
is one, says who may use it and how.

## What a design system folder holds

| File | What it is |
| --- | --- |
| `design-system.json` | The manifest: id, name, version, source (the Claude Design System artifact it was copied from), licence notes, which file is what, the roles, the contrast pairs and known exceptions, chart, video and Office mappings |
| `tokens.json` | The tokens in the Claude Design System format, **as copied**: `color.themes` (light, dark), `color.tokens` (palette values and semantic tokens with a value per theme), `type` (fonts, families, styles), `spacing`, `radius`, `shadow` |
| `README.md` | The brand book, as copied |
| `README-USE.md` | Brand use rules (who may use it, logo rules, private repositories), when the brand is someone's trademark |
| `components/` | Ready-made components, when the system has them (CSS classes, a React bundle, types, a README and preview per component) |
| `fonts/` | The font files, with the font's licence in `fonts/LICENCE.txt` |
| `assets/` | Logos (SVG and PNG) and reference files |
| `word-template.md` | How documents use the brand (Office theme slots, styles), when the system has one |

### Roles

Every design system names its tokens its own way. The manifest's `roles` map the jobs every system
has (`background`, `surface`, `text`, `textMuted`, `border`, `accent`, `textInverse`, `focus`,
`danger`, and optional ones such as `heavy`, `textOnHeavy`, `link`, `active`, `dangerSurface`) to
the system's tokens. The Fluent, Dataverse, email and video outputs work from roles, so they need
nothing system-specific, and the generated CSS also exposes every role as `--ds-<role>` for code
that should survive a switch of design system.

### Contrast

`contrast.pairs` lists the foreground and background pairs the brand book documents (text on its
surfaces 4.5:1, focus rings and indicators 3:1); `check` measures each in both themes.
`contrast.known` lists the exceptions the brand book documents on purpose (a decorative border, a
disabled label), each with its reason; `check` reports them but does not fail. An entry with
`"documented": false` is a shortfall found in the source that the brand book does not mention; it
is reported as a finding so nobody relies on that pair.

## Adding a design system

From a Claude Design System artifact: read its files with the Artifact tool and copy them here
under a new id, then write `design-system.json` and run `check`. The steps are in the
`design-system` skill (`skills/design-system/SKILL.md`).
