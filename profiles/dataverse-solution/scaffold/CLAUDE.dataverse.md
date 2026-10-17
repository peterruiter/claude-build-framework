# CLAUDE.md additions for a Dataverse solution project

Merge these sections into the project's CLAUDE.md (after "Standing rules"), fill the
`{{…}}` placeholders, then delete this file. They add to the framework's standing rules; they
never relax one.

## Dataverse facts

| | |
| --- | --- |
| Publisher / prefix | {{PUBLISHER}} / `{{PREFIX}}_` (never changes; option values start at {{OPTION_VALUE_PREFIX}}0000) |
| Solutions, in import order | {{SOLUTIONS}} (see `build/contracts/schema.json`) |
| Environments | `environments.json` (dev, build, test, prod; personal dev environments in `environments.local.json`) |
| Languages (LCIDs) | {{LCIDS}}, base {{BASE_LCID}}; every label in every one |
| Environment geo | {{GEO}}; the solution checker runs with `--geo {{CHECKER_GEO}}` |
| Design system | `designSystem.id` in `build/framework.json`; generated into `docs/brand/`; the app theme is the web resource `{{PREFIX}}_theme.xml` in the core solution, applied by the **Custom theme definition** setting. Regenerate, never edit (`/build-framework:design-system`) |
| Plug-ins / PCF / side services | `profiles/dataverse-plugins`, `profiles/power-platform-pcf`, `profiles/dotnet-react-azure` of the build framework |

## Environment safety (overrides convenience, every time)

- **Before every pac or Web API call: say the environment URL and the signed-in account, and
  get the confirmation.** The scripts do this (`Confirm-Environment`); do the same for any
  ad-hoc `pac` or `az` command. Never rely on pac's or az's "current" environment: pass
  `--environment <url>` / the URL explicitly.
- **Never import into production without the owner's go for that release.** Locally that is
  `-ProductionGo` after the owner said so in this conversation; in CI it is the approval on the
  GitHub environment `production`. A go for test is not a go for production.
- **Production is read-only when debugging.** Read, report, propose. No data fixes, no
  "quick" customisation, no publish in production: changes go dev, export, PR, release.
- **Schema and roles change in development only**, through `New-Schema.ps1` /
  `New-SecurityRoles.ps1` (dry run first) or the maker portal, then `Export-Solution.ps1`.
  Test and production get managed solutions only; unmanaged changes there are blocked.
- **Test data** is created only in development or test, marked (`[TEST]` prefix in the primary
  name, or a dedicated test business unit), within the record scope the owner approved, and
  removed again by the same agent. Never in production.
- **Never switch the owner's az or pac account** without asking; restore it afterwards.
- No secrets in `environments.json`, deployment settings or anywhere in git: secret
  environment variables point at Key Vault; CI signs in with a federated credential.

## Definition of done, Dataverse additions

- The change is in the **unpacked solution in git** (exported from development), and
  `./build/Build-Solution.ps1 -RoundTrip` is clean.
- **schema.json, roles.json and privacy.json** describe it: a new table or column has its
  labels in every LCID, a row in the role matrix and a category and purpose in the privacy
  register. `npm test` passes.
- **Labels in every language** in the solution too (`./build/Test-Translations.ps1`): export
  translations, fill, import, export the solution again.
- **Accessibility**: forms keep a logical tab order and labels on every field; web resources
  and PCF controls meet WCAG 2.2 AA (keyboard, focus, names, contrast in light, dark and high
  contrast); custom pages use modern controls.
- **Solution checker**: no Critical or High findings (CI job `checker`; locally
  `pac solution check --path out/*.zip --geo {{CHECKER_GEO}}`).
- **Version**: `VERSION` and the solution version agree; every release has a higher version
  than production.
- What's new entry for user-visible changes, in every configured language.

## Quality gate commands

```
node scripts/check-vocabulary.mjs           # framework: strings and glossary
npm test                                    # contracts, scripts parse, translations, privacy register
pwsh ./build/Build-Solution.ps1 -RoundTrip  # pack from source, source round-trips
pwsh ./build/New-Schema.ps1                 # offline plan (no environment)
pwsh ./build/New-SecurityRoles.ps1          # offline matrix (no environment)
```

Plus the plug-in and PCF gates from their profiles when the project has them.
