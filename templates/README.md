# Templates

Stack-neutral templates. Stack-specific scaffolding (build, database, infrastructure, CI with the
stack's build) is in a profile, for example [`profiles/dotnet-react-azure/`](../profiles/dotnet-react-azure/).

## `project/`: copied into a new project by the `new-project` skill

| File | Becomes | What it is |
| --- | --- | --- |
| `CLAUDE.md` | `CLAUDE.md` | The standing rules (placeholders `{{…}}` filled in) |
| `STATE.md` | `STATE.md` | Honest status, deployment, data flows, runbooks, Unproven |
| `ROADMAP.md` | `ROADMAP.md` | Waves, Not doing, Operations readiness, Decisions |
| `package.json` | `package.json` (merged if one exists) | `npm test` = checker + contract tests + stand-in tests |
| `gitignore.template` | `.gitignore` | Named so it does not affect this repository |
| `github/workflows/ci.yml` | `.github/workflows/ci.yml` | Stack-neutral CI (a profile's CI replaces it and keeps these steps) |
| `githooks/commit-msg` | `.githooks/commit-msg` (`git config core.hooksPath .githooks`) | Refuses commit messages with AI attribution |
| `build/framework.json` | same | Configuration for the checker, tests and release script |
| `build/contracts/locales.json` | same | The configured languages (rewritten from the owner's answer) |
| `build/contracts/glossary.json` | same | One vocabulary per language |
| `build/contracts/changelog.json` + `.schema.json` | same | What's new |
| `scripts/check-vocabulary.mjs` | same | Translations, plurals (CLDR), glossary, key usage |
| `scripts/release-tag.mjs` | same | Sets `release` on What's new entries |
| `src/i18n/plural.ts` | wherever the app keeps i18n (update `pluralModule`) | Plural selection helper |
| `src/styles/tokens.css` | the app's stylesheet folder (update `theme.css`) | Light/dark colour tokens |
| `src/strings/ui.*.json` | the app's strings folder (update `strings`) | Sample bundles |
| `tests/contracts/*.test.mjs` | same | Changelog, languages and plurals, theme contrast |
| `tests/standins/standin.mjs` + `example-service.mjs` (+ test) | same | Generic stand-in server and an example service |
| `tests/standins/dataverse.mjs` (+ test) | same, when the project talks to Dataverse | Dataverse Web API stand-in |
| `tests/a11y/axe-pages.mjs`, `pages.json`, `known.json`, `sign-in.example.mjs` | same | axe-core + probes over configured pages |
| `tests/load/journeys.k6.js`, `journeys.json`, `generate.mjs` | same | Load test by user journey, test data generator |

## `mobile/`: native app shells around the web app

See [`mobile/README.md`](mobile/README.md) and [docs/mobile-apps.md](../docs/mobile-apps.md); used
by the `mobile-app` skill.

## Documents

| File | Used by |
| --- | --- |
| [`agent-brief.md`](agent-brief.md) | `agent-brief`, `plan-wave` skills |
| [`agent-report.md`](agent-report.md) | Every agent's final message |
| [`status-update.md`](status-update.md) | `status-update` skill |
| [`owner-checklist.md`](owner-checklist.md) | `owner-checklist` skill |
| [`runbook.md`](runbook.md) | `write-docs`, `ops-readiness` skills |
| [`load-test-plan.md`](load-test-plan.md) | `load-test` skill |
| [`languages-catalog.json`](languages-catalog.json) | `new-project`, `translate` skills: languages to choose from |
