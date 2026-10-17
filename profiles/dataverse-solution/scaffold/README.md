# CaseApp (scaffold of the dataverse-solution profile)

The repository skeleton for a product built on Dataverse. Everything named `contoso`,
`Contoso`, `CaseApp` or `contoso_Request` is **SAMPLE**: replace it with the product's own
publisher, prefix, solutions and tables. The profile's README explains the method; this file
says what is where.

| Path | What | Sample? |
| --- | --- | --- |
| `solutions/CaseAppCore/src/` | An unpacked solution (pac's XML layout): one table `contoso_Request` with three columns, a global choice, an environment variable, a connection reference; labels in English (1033) and Dutch (1043) | **Sample**: replace with `pac solution clone` / `Export-Solution.ps1` of the real solution |
| `solutions/CaseAppCore/src/WebResources/contoso_theme.xml` | The model-driven apps' modern theme (a Data (XML) web resource), byte for byte `docs/brand/dataverse-theme.xml` | Real: generated from the design system |
| `docs/brand/` | Generated from the design system (`build/framework.json`: `designSystem`): the app theme, email, chart and Office palettes | Real: regenerate, never edit |
| `build/contracts/schema.json` | Data model as code: publisher, solutions, languages, tables, columns, choices, variables, references | Sample content, real format |
| `build/contracts/roles.json` | Security role matrix: role, table, privilege, depth | Sample content |
| `build/contracts/privacy.json` | Privacy register: categories, purposes, legal basis, retention, erasure per table and column | Sample content |
| `environments.json` | dev, build, test, prod: URL, kind, what each accepts, approval; no secrets | Sample URLs, placeholder tenant (scripts refuse it) |
| `deployment-settings/<env>.json` | Environment variable values and connection references per environment (`pac solution create-settings` format) | Sample values |
| `build/Common.psm1` | Shared helpers: environment guard, Web API with retry on 429, pac wrapper | Real |
| `build/Build-Solution.ps1` | Offline: pack from source, stamp the version, round-trip check | Real |
| `build/Export-Solution.ps1` | Export from development and unpack into `solutions/` | Real |
| `build/Import-Solution.ps1` | The only deploying script: checks, typed confirmation, upgrade or install | Real |
| `build/New-Schema.ps1` | schema.json to development via the Web API; offline plan by default | Real |
| `build/New-SecurityRoles.ps1` | roles.json to development; offline matrix by default | Real |
| `build/Test-Translations.ps1` | Offline label coverage: contract, solutions, RESX | Real |
| `build/Export-PrivacyRegister.ps1` | Offline: the register as Markdown or CSV | Real |
| `build/Test-CheckerResults.ps1` | Reads the solution checker's SARIF, fails on High and above | Real |
| `build/Test-Scripts.ps1` | Parses every PowerShell file | Real |
| `tests/contracts/*.test.mjs` | Contract tests (`npm test`), the design system's theme in the solution included | Real |
| `.github/workflows/pr.yml` | PR and main: contracts, pack round trip, checker (when configured) | Real |
| `.github/workflows/release.yml` | Tag: managed from the build environment, deploy test, deploy production behind approval | Real, inert until its variables are set |
| `CLAUDE.dataverse.md` | Sections to merge into the project's CLAUDE.md | Real |

## First run

```
npm test
pwsh ./build/Build-Solution.ps1 -RoundTrip
pwsh ./build/New-Schema.ps1
```

All three are offline. Nothing in this scaffold reaches an environment until
`environments.json` (or `environments.local.json`) holds the real tenant id, and then only
after the URL and the account are shown and confirmed.
