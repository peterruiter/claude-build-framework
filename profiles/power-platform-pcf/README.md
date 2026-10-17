# Profile: Power Apps component framework (PCF)

For **code components**: field and dataset controls that run inside model-driven apps (forms,
views, subgrids, custom pages) and canvas apps, built as **virtual (React) controls on the
platform's own React and Fluent UI v9**, shipped in a **Dataverse solution** (managed for every
environment but development). The profile gives a working repository with two sample controls,
every string in every configured language through RESX files, light and dark through the host's
theme, accessibility built in and tested, privacy rules the build enforces, a quality gate with
numbers, CI that builds the solution zip, and a deploy to a development environment that only
runs with the owner's go.

The stack-neutral method (roles, waves, agent briefs, quality gate, release checklist) lives in
the framework's [docs](../../docs/README.md) and skills. This profile is what they run when the
work is code components. A larger product on Dataverse uses it next to
[dataverse-solution](../dataverse-solution/) (tables, apps, flows, environments) and
[dataverse-plugins](../dataverse-plugins/) (server-side logic).

## Check the tools first

```text
node ${CLAUDE_PLUGIN_ROOT}/scripts/check-prereqs.mjs power-platform-pcf
```

The list is [prerequisites.json](prerequisites.json):

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 22.18 or newer (LTS; CI uses 22) | pcf-scripts, eslint, vitest, the gate scripts |
| npm | 10 or newer | `npm ci` from the lock file (one npm workspace for all controls) |
| .NET SDK | 8.0.100 or newer (validated with 10.0.303) | `dotnet build` of the solution project (`*.cdsproj`) |
| Power Platform CLI (`pac`) | 2.11.2 or newer | `pac pcf init`, `pac solution add-reference`, imports, the Power Apps checker |
| git | 2.40 or newer | the repository; the version check compares with the base branch |
| Power Platform Tools for VS Code | optional | auth profiles in VS Code; the Windows-only `pac data` and `pac package deploy` |
| actionlint | optional | lint the workflows before pushing |

Install pac as a .NET tool on every OS: `dotnet tool install --global Microsoft.PowerApps.CLI.Tool`
(update: `dotnet tool update --global Microsoft.PowerApps.CLI.Tool`). The build itself does not
need pac: it uses the MSBuild packages pinned in the project files.

**Pinned versions** (change deliberately, together): `pcf-scripts` and `pcf-start` 1.51.1,
`Microsoft.PowerApps.MSBuild.Pcf` and `.Solution` 1.52.1 (the 1.x line `pac pcf init` still
writes), React 16.14.0 and `@fluentui/react-components` 9.68.0 (the platform libraries the
manifests ask for), TypeScript 5.9.3 (pcf-scripts accepts 4.x and 5.x, not 6 or 7), ESLint 9,
vitest 4.1, jsdom 26, `@testing-library/react` 12.1.5 (the React 16 line). Every npm version
is exact and locked in `controls/package-lock.json`.

## What is in it

| Path | What | Becomes, in the new repository |
| --- | --- | --- |
| `scaffold/` | The repository skeleton, named `Contoso`, prefix `contoso` (see below) | the repository root |
| `scaffold.ps1` | Copies the scaffold, renames it, writes the languages | (not copied) |
| `scaffold-locales.mjs` | Writes `locales.json` from the framework's languages catalogue | (not copied) |
| `ci/deploy-dev.yml` | Manual import into the development environment, behind an approval | `.github/workflows/deploy-dev.yml` with `-WithDeployWorkflow` |
| `prerequisites.json` | Tools and versions for the prerequisites check | (read by the framework) |

### The scaffold

```text
build/contracts/locales.json        the languages (the framework's contract); RESX files follow it
controls/                           one npm workspace, one lock file, one node_modules
  package.json                      gate scripts: check, lint, typecheck, test, build:release, size
  eslint.config.mjs                 pac's lint set (Power Apps checker rules) + privacy rules
  SampleControl/                    a FIELD control project (SampleControl.pcfproj, package.json)
    SampleControl/                  ControlManifest.Input.xml, index.ts, SampleField.tsx,
                                    strings/SampleControl.<lcid>.resx, strings/fallback.generated.ts
  SampleGrid/                       a DATASET control project: table, sorting, paging, selection,
    SampleGrid/                     a list below 480 px; same layout
  shared/                           strings.ts (RESX + CLDR plurals + fallback), theme.ts (host theme,
                                    direction), diagnostics.ts (the only console output), languages.generated.ts
  scripts/                          sync-languages, check-controls, check-bundle-size, bump-version,
                                    check-version-bump, dataverse-languages.json (LCIDs)
  tests/                            mockContext.ts (a context reading the real RESX files), tests for
                                    both controls, strings, theme contrast and the checks themselves
solution/Contoso.cdsproj            references every pcfproj; Release builds managed + unmanaged zips
solution/src/Other/Solution.xml     solution and publisher (prefix, option value prefix, version)
scripts/Deploy-Dev.ps1              import into a development environment, with checks and a confirmation
.github/workflows/ci.yml            framework checks, controls gate, solution zip as artifact
```

**One control per project.** Microsoft's rule: a `pcfproj` holds one code component, a
solution project references many. The npm workspace keeps one lock file and one `node_modules`
for all of them; each control project has its own `package.json` with only the pcf-scripts
commands. (pcf-scripts can build two manifests in one project, but its generated types then
mix the controls' properties: the scaffold does not do that.)

Validated (17 Oct 2026, Windows 11, Node 26.7, .NET SDK 10.0.303, pac 2.11.2): `npm ci`, the
full gate (`npm run gate`: check, refreshTypes, lint 0 warnings, typecheck, 35 tests, release
build, size: 6 KB and 7.5 KB bundles), and `dotnet build -c Release` of the solution from a
clean tree (both zips; the managed one holds both controls with their RESX files). The same for
projects generated with `scaffold.ps1` (see the end of this file).

## Scaffold a project

```powershell
./profiles/power-platform-pcf/scaffold.ps1 -Name FieldTools -Prefix ftl -Languages en-GB,nl,pl -Destination C:\src\field-tools
cd C:\src\field-tools\controls; npm ci; npm run gate
dotnet build ..\solution\FieldTools.cdsproj -c Release
```

- `-Name` (PascalCase) replaces `Contoso`: the solution's unique name, the controls' namespace,
  the publisher (or `-PublisherName`). Control names stay `SampleControl` and `SampleGrid` until
  the first real control replaces them.
- `-Prefix` is the publisher's customization prefix (2-8 lower-case letters or digits). Use the
  prefix of the publisher the target environments already have: a control's schema name is
  `<prefix>_<Namespace>.<Control>` and never changes after the first import.
  `-OptionValuePrefix` likewise when the publisher exists.
- `-Languages` (codes or cultures) writes `build/contracts/locales.json` from the framework's
  catalogue and a RESX file per control and language. New languages start as the English text
  marked `untranslated`; `npm run check` warns, `npm run check:release` (the release gate)
  refuses. Without English in the list, the default language becomes the source.
- `-WithDeployWorkflow` adds the manual deploy workflow. Nothing is imported anywhere.
- Into an existing framework project (CLAUDE.md, build/contracts, ...): the script copies
  beside it, keeps the project's files and merges `.gitignore` and `.gitattributes`.

In a project made by `new-project`, the framework's string bundles are not used for the
controls: set `"strings": []` in `build/framework.json`, remove `theme` and `pluralModule`
there (the controls take the host's theme; their contrast is tested in
`controls/tests/theme.test.ts`), and delete `src/strings`, `src/styles` and `src/i18n`. The
checker then covers What's new and the glossary, and its contract tests skip what does not
apply (tried: 9 pass, 3 skip). The CI's framework job runs them when they are there.

## The quality gate

In `controls/`, every agent before reporting and the lead before a release:

| # | Step | Command | Expect |
| --- | --- | --- | --- |
| 1 | Strings, manifests, privacy | `npm run check` (`check:release` for a release) | a RESX per language, same keys and placeholders, plural forms per language, generated files current, no undeclared network call or feature |
| 2 | Manifest types | `npm run refreshTypes` | `generated/ManifestTypes.d.ts` per control |
| 3 | Lint | `npm run lint` | 0 problems, 0 warnings (includes `@microsoft/eslint-plugin-power-apps`, the Power Apps checker rules for code) |
| 4 | Type check | `npm run typecheck` | controls and tests, strict |
| 5 | Unit tests | `npm test` | every test passes; count them |
| 6 | Release build | `npm run build:release` | each control built in production mode (pcf-scripts lints again) |
| 7 | Bundle size | `npm run size` | under `config.bundleBudgetKb` (300 KB), never a development build |
| 8 | Solution | `dotnet build ../solution/<Name>.cdsproj -c Release` | `<Name>.zip` and `<Name>_managed.zip`, 0 warnings |
| 9 | Versions (before a release, and in CI on pull requests) | `npm run version:check -- --base origin/main` | every changed control raised its version, and the solution |
| 10 | Power Apps checker (optional, the owner's tenant) | `pac solution check --path ../solution/bin/Release/<Name>.zip --geo <region>` (`Europe`, `Germany`, `France` ... as the residency requires) | no critical or high findings; it runs in Microsoft's checker service, so only with the owner's go and a pac profile for their tenant |
| 11 | In an app (UI changed) | import into development, then keyboard, screen reader, light/dark, narrow and wide, each declared host (model-driven and canvas) | written down with what was checked |

`npm run gate` runs 1 to 7 in order. Then the framework's own steps (What's new, data
residency, CI green): see [quality-gate](../../skills/quality-gate/SKILL.md).

## Languages (RESX, in the project's chosen languages)

- **The contract is the framework's**: `build/contracts/locales.json` (codes, cultures, source,
  default). `npm run languages` (scripts/sync-languages.mjs) makes the controls follow it: a
  `<Control>.<lcid>.resx` per language, the manifest's `<resx>` lines (between the
  `<!-- languages -->` markers), `shared/languages.generated.ts` and each control's
  `strings/fallback.generated.ts`. `--prune` removes languages no longer offered.
- **LCIDs**: Dataverse picks the RESX file by the user's language id. A culture maps to its
  Dataverse language (`scripts/dataverse-languages.json`, the 45 languages Dataverse offers):
  `en-GB` and `en-US` are both 1033 (Dataverse has one English), `pt` is 2070 and `pt-BR` 1046,
  `zh-TW` 1028. A language Dataverse does not offer stops the sync with the reason.
- **Keys**: manifest keys as Microsoft's samples write them (`SampleControl_Name`,
  `Value_Description`); interface strings by area (`field.clear`, `grid.page`). Placeholders
  `{0}`, `{1}`; the checker holds every language to the source's placeholders.
- **Plurals**: RESX has none, so the framework's convention carries over: the key is `other`,
  `key.one`, `key.few`, `key.many` ... are the CLDR categories the language needs
  (`Intl.PluralRules` on the culture: Polish one/few/many, Arabic zero/one/two/few/many,
  Japanese none). `strings.counted("grid.count", n)` picks the form. The sync adds missing forms
  (marked untranslated) and removes forms a language does not use; the checker refuses both.
- **Fallback**: when the user's language has no file, the platform uses the environment's base
  language; when that is missing too, `getString` returns the key. The helper then uses the
  default language's strings built into the bundle, so a reader never sees `grid.next`. Ship a
  RESX for the base language of every environment the controls go to.
- **Numbers** in placeholders are formatted for the culture (`1.234` in Dutch).
- **Accessible names are strings** (`field.clearLabel` "Clear {0}", `grid.select` "Select {0}")
  and contain the visible label (WCAG 2.5.3).
- New language: add it to `locales.json`, `npm run languages`, translate the strings marked
  untranslated (the `translate` skill), `npm run check`.

## Accessibility (WCAG 2.2 AA)

- **Fluent v9 components** (Input, Button, Checkbox, Table, Link, Spinner) bring roles, states,
  focus rings and high-contrast support; the controls add the names: the input is named after
  the column (`DisplayName`), every checkbox after its record, the table after the view.
- **Keyboard**: everything works with Tab, Enter and Space; the grid adds arrow keys between
  cells (`useArrowNavigationGroup`, the grid pattern); sortable headers are buttons; records
  open from a link, not from a double-click only.
- **States in words**: loading (Spinner with a label), empty, failed (`role="alert"`), the page
  and the record count in a polite live region. Never colour alone.
- **Field security**: a value the user may not read is not rendered at all (tested); a value
  they may not edit is read-only.
- **Space**: `trackContainerResize(true)` and `context.mode.allocatedWidth`: the field stacks
  below 320 px, the grid becomes a list below 480 px. Test at 320 and 1280 px, and at 200% zoom.
- **Theme, light and dark, high contrast**: the controls render inside a `FluentProvider` with
  `context.fluentDesignLanguage.tokenTheme` (the host's tokens, in model-driven apps also the
  display density), else `webDarkTheme` or `webLightTheme` by `isDarkTheme`. Colours come from
  tokens only (`tokens.colorNeutralForeground2` and so on); `tests/theme.test.ts` holds the
  pairs the controls use to 4.5:1 (text) and 3:1 (focus) in the light, dark and high-contrast
  themes. Read the theme in every `updateView`: it can change while the control is open.
- **Right to left**: `dir` from `context.userSettings.isRTL`; use logical CSS properties
  (`paddingInline`, `marginInlineStart`).
- In the app: the framework's [accessibility](../../docs/accessibility.md) pass with a screen
  reader (Narrator or NVDA) on a form and in a canvas app, if the manifest is used there.

## Privacy and data residency

- **No calls outside Dataverse.** The manifests declare `<external-service-usage enabled="false" />`;
  `npm run check` refuses `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` and `EventSource`
  unless the control declares the domain **and** `controls/external-services.json` records the
  owner's decision for it:

  ```json
  { "services": [ { "domain": "api.example.eu", "purpose": "address lookup", "approvedBy": "owner", "date": "2026-10-17", "dataResidency": "EU (West Europe)" } ] }
  ```

  A declared external service makes the control **premium** (users need a Power Apps licence)
  and sends data from the user's browser to that domain: both are owner decisions, recorded
  in ROADMAP.md, and the domain's region is part of the data residency table.
- **Dataverse access through the platform**: `context.webAPI` and the dataset API run as the
  user, inside the environment and its region. `uses-feature` declares WebAPI, Utility or a
  Device feature before the code may use it (checked).
- **Nothing about a person in the console**: `shared/diagnostics.ts` is the only console
  output (eslint `no-console` elsewhere) and logs a code and the kind of error, never a value,
  a record id or the platform's message (it can name records). A test types an e-mail address
  and asserts it never reaches the console. No telemetry in the controls.
- **No browser storage** of record data (eslint refuses `localStorage` and `sessionStorage`).
- **Control state** (`setControlState`) stays in the session; keep it to view state (page,
  sort), never field values.
- The framework's [privacy checklist](../../docs/privacy-and-sovereignty.md) per new control.

## Release flow

The framework's [release flow](../../docs/release-flow.md) with the owner's go, plus:

1. **Versions**: `npm run version:bump` (patch by default; `minor`, `major`, `--controls A,B`)
   raises the changed controls' `version` in their manifests **and** the solution version
   (control `MAJOR.MINOR.PATCH`, solution `MAJOR.MINOR.BUILD.REVISION`; patch raises
   `REVISION`). Without a higher control version the environment keeps serving the old bundle.
   `npm run version:check -- --base <last release tag>` proves it before the build.
2. `npm run check:release`: no string still marked untranslated, in any language.
3. The gate, then `dotnet build -c Release` of the solution in a clean copy of the commit.
4. **The managed zip** (`<Name>_managed.zip`) is the release artifact for test, acceptance and
   production; the unmanaged zip only ever goes to development. Keep both from the CI run (the
   `solution-<sha>` artifact) or attach them to a GitHub release.
5. Import with the owner's go per environment (the dataverse-solution profile's deploy, or
   `pac solution import --environment <url> --path <managed zip>` run by a person), then smoke
   test in the app: the control shows the change (so the new version loaded), in each language
   that environment offers.
6. **What's new**: a one-sentence entry per user-visible change in every configured language
   (`build/contracts/changelog.json`, the [whats-new](../../skills/whats-new/SKILL.md) skill),
   tagged with the release.

## Deploy to a development environment

Only with the owner's go for that environment, every time:

- **By a person**: `./scripts/Deploy-Dev.ps1 -EnvironmentUrl https://<org>.crm4.dynamics.com`
  builds, shows the pac account and environment, refuses when the active pac profile points
  elsewhere (it never switches profiles: switching is the owner's decision; afterwards they
  switch back), shows the zip and version, and imports the **unmanaged** zip only after the
  environment's host name is typed. `-ConfirmHost` carries the host the owner typed in their
  go; an agent never supplies its own.
- **From GitHub** (`-WithDeployWorkflow`): `deploy-dev.yml` runs only by hand, through the
  GitHub environment `development` that the owner protects with required reviewers, asks for
  the host name as input, shows who-am-i, and imports with a service principal (an application
  user in that one environment, with a role that can import solutions there and nothing else).
  The owner adds `DEV_ENVIRONMENT_URL`, `DEV_APP_ID`, `DEV_TENANT_ID` (variables) and
  `DEV_CLIENT_SECRET` (secret) to that GitHub environment; nothing secret is in the repository.
- `pac pcf push --publisher-prefix <prefix>` is the quickest loop for one control, but it
  imports into a separate unmanaged `PowerAppsTools_<prefix>` solution: only for a personal
  development environment, never for one others use, and never instead of the solution.
- Never import into test, acceptance or production from this profile's scripts, and never from
  CI without the owner's go.

## CI

`.github/workflows/ci.yml` on pull requests, pushes to main and by hand, actions pinned to
commit SHAs, no secrets:

- **framework**: the framework's checker and contract tests, when the repository has them.
- **controls** (Ubuntu): `npm ci`, check, refreshTypes, lint, typecheck, tests, release build,
  bundle size; on pull requests the version check against the base branch (full history).
- **solution** (Windows): `npm ci`, `dotnet build -c Release` of the solution, both zips kept as
  the `solution-<sha>` artifact for 30 days.

`actionlint` 1.7.12 passes `ci.yml` and `deploy-dev.yml`. Watch the first run until it is green
(`gh run watch <id> --exit-status`); on red, `gh run view <id> --log-failed`, fix, push.

## How Claude uses this profile

For the `new-project`, `plan-wave`, `quality-gate` and `release` skills (link this section):

| The skill wants to | Do |
| --- | --- |
| Check the tools | `node ${CLAUDE_PLUGIN_ROOT}/scripts/check-prereqs.mjs power-platform-pcf` |
| Start a project | ask name, publisher prefix (the one the environments already use) and languages; `./scaffold.ps1 -Name <Name> -Prefix <prefix> -Languages <codes> -Destination <repo>`; then the `build/framework.json` change above; `cd controls; npm ci; npm run gate`; `dotnet build ../solution/<Name>.cdsproj -c Release`; commit; push; watch CI green |
| Add a control | in `controls/`: `pac pcf init -n <Control> -ns <Name> -t field\|dataset -fw react -o <Control>` (it does not run npm install by default); keep only the `scripts` in its `package.json` (the workspace has the packages), delete its `eslint.config.mjs` and `.gitignore` (the workspace's apply), copy `tsconfig.json`, `pcfconfig.json` and the pcfproj settings (`PcfEnableAutoNpmInstall` false, pinned packages) from SampleControl, add the folder to `workspaces`, write the source RESX and the `<!-- languages -->` markers, `npm install`, `npm run languages`, then `pac solution add-reference -p ../controls/<Control>` in `solution/`, and `npm run gate` |
| Run the gate | `cd controls; npm run gate`, then the solution build; report the numbers (tests, bundle KB, warnings) |
| Add or change a string | the source RESX first, then `npm run languages`, then translate what is marked untranslated in every language; `npm run check` |
| Add a language | `locales.json`, `npm run languages`, translate, `npm run check` |
| Use Dataverse data in a control | `context.webAPI` with `<uses-feature name="WebAPI" required="true" />`; few calls, `$select` only the columns needed; loading and failed states in words |
| Call anything outside Dataverse | stop: owner decision (premium licence, data leaves the environment), then the manifest domain and `external-services.json` |
| Release | the release flow above: version bump, `check:release`, gate, managed zip, What's new, import with the owner's go |
| Deploy to development | ask the owner for the go and the environment; `Deploy-Dev.ps1`; never switch pac profiles or az accounts without asking |
| Test in the app | import to development, then keyboard, screen reader, light/dark, narrow/wide, every language, each declared host |

Agent briefs name: the control(s) the agent owns (its project folder; `shared/` only with the
lead's say-so), the strings it adds, the gate commands with the numbers to report, and that no
agent imports into any environment.

## Gotchas learned the hard way

- **The control version must go up**, or nothing changes. Dataverse and the browser cache the
  bundle by control version; an import with the same version "succeeds" and users keep the old
  code. Raise it for every change that should reach an environment (`npm run version:bump`),
  and the solution version with it; CI's version check refuses a pull request that forgets.
  After an import: publish all customizations, then reload the app with Ctrl+F5; a canvas app
  has to take the component update in Power Apps Studio and be republished.
- **Platform library versions are what the manifest asks for, not what npm installs.** React is
  16.14.0 in canvas apps and 17.0.2 in model-driven apps at run time, whatever the manifest says;
  Fluent v9 at run time can be newer than the build (Learn lists 9.46.2 as the highest allowed
  and 9.68.0 as loaded; `pac pcf init` writes 9.68.0). Build and test with what the manifest
  declares (the check holds `package.json` to it) and use nothing newer than React 16.14 offers:
  no `useId`, `useTransition` or `createRoot` from React itself (Fluent's `useId` is fine). The
  `pcf-scripts` table also lists React 18.3.1; Microsoft Learn does not yet, so the scaffold
  stays on 16.14.0.
- **One control per pcfproj**: two manifests in one project build, but the generated
  `ManifestTypes.d.ts` of the second control then also has the first one's properties.
- **The pcfproj installs packages by itself** (`npm install` when `package.json` is newer than
  the lock file) unless `PcfEnableAutoNpmInstall` is false, which the scaffold sets: the build
  must use the locked versions, so run `npm ci` in `controls/` first.
- **Never import a development build**: it is many times larger (webpack `eval` source maps),
  slow, and can be refused for size (the limit is the environment's maximum attachment size,
  5 MB by default). `dotnet build -c Release` and `npm run build:release` build production;
  `npm run size` refuses a development bundle.
- **Dataset paging**: the paging calls do not support parallel execution, and each one ends in
  a new `updateView`. Keep the page number in the control and use `loadExactPage(n)` (as
  Microsoft's canvas grid tutorial does), never while `dataset.loading`. `totalResultCount` is -1 when unknown, and in canvas apps a multiple of
  500 until the last page (delegation): show "page n", show the count only when known. Sorting
  is a change to `dataset.sorting` followed by `refresh()`, which also resets to page 1.
- **`allocatedWidth` and `allocatedHeight` come only after `trackContainerResize(true)`**, can be
  -1 when the host sets no size, and the test harness passes them as text. Treat 0 or less as
  "unknown, use the wide layout".
- **Dataset values are not initialised in `init`** (the pac template says so): apply the page
  size in the first `updateView`, once (`setPageSize`, then `paging.reset()` to reload page 1).
- **Test in every host the manifest allows.** A field control on a model-driven form, in a
  custom page and in a canvas app gets different contexts: `contextInfo` (record id, table) only
  in model-driven apps, `DisplayName` empty in canvas apps, `fluentDesignLanguage` only with
  modern theming, `isControlDisabled` from the form. The test harness (`npm start -w <Control>`)
  shows none of WebAPI, navigation, utility, paging, sorting or lookups: it throws on them.
- **`getString` returns the key itself** for a key the chosen RESX file does not have: never show
  its result unchecked (the strings helper falls back to the built-in default language).
- **Fluent components that use a portal** (Dialog, Popover, Menu, Tooltip) render outside the
  control's tree: wrap their content in a `FluentProvider` with the same theme, or they lose it.
- **`IdPrefixProvider` or a custom `FluentProvider` theme** opts the control out of the host's
  theme: do not, unless the owner wants a different look.
- **No IE-era or host DOM APIs**: no `document.getElementById` outside the control's own
  container, no `Xrm` or `formContext` (unsupported in code components; bind a column and let
  a form script react to its change instead), no synchronous `XMLHttpRequest`, no global CSS
  (Fluent's `makeStyles` scopes everything). Target ES2020 browsers; strict TypeScript.
- **Write as if React strict mode were on**: effects that survive running twice, no side
  effects in render, cleanup in `destroy` for anything held outside React (listeners on
  `window`, timers, sockets).
- **npm 11 on Node 24+** may warn that install scripts (esbuild, @parcel/watcher) are not
  approved and skip them; the build and tests do not need them. CI uses Node 22's npm 10.
- **`pac solution check`** sends the solution to Microsoft's checker service in the geography
  you name (`--geo`): pick the project's region, and only with the owner's go.

## What was validated, and what was not

Validated (17 Oct 2026, Windows 11): the scaffold as shipped passes `npm ci`, `npm run gate`
(35 tests) and a clean `dotnet build -c Release` of the solution (managed and unmanaged zips
with both controls and their RESX files, 0 warnings); `scaffold.ps1` generated
`-Name FieldTools -Prefix ftl -Languages en-GB,nl,pl,ar` (Polish one/few/many, Arabic
zero/one/two/few/many and right to left; the gate warns about the untranslated strings, as it
should) and `-Name Northwind -Prefix nw -Languages nl,de` (no English: Dutch becomes source and
default, the 1033 files go), and each passed `npm ci` from the renamed lock file, the gate (35
tests) and the solution build, with the new prefix in the zip (`ftl_FieldTools.SampleGrid`);
`check-version-bump.mjs` refuses a changed control or `shared/` without a raised version and
accepts it after `bump-version.mjs` (in a scratch git repository); the checks catch a missing string, a changed
placeholder, a missing plural form, an unlisted language, an undeclared `fetch` and an
undeclared WebAPI use (tests); the framework checker and contract tests run with the RESX-only
`framework.json` above; `actionlint` passes both workflows; `Deploy-Dev.ps1` parses and its
`pac org who` parsing matches pac 2.11.2's output.

Not validated: anything inside an environment (import, the controls on a real form, view or
canvas screen, the runtime RESX fallback, modern theming and dark mode in a real app, display
density), `pac solution check` (needs the owner's tenant), the GitHub Actions runs themselves
(actionlint only, until a test repository runs them: the solution job on `windows-2025` and the
deploy workflow with `microsoft/powerplatform-actions` v1.9.2), the solution build on Linux,
and a screen reader pass.

## Sources (Microsoft Learn, October 2026)

- [React controls and platform libraries](https://learn.microsoft.com/power-apps/developer/component-framework/react-controls-platform-libraries)
- [Style components with modern theming](https://learn.microsoft.com/power-apps/developer/component-framework/fluent-modern-theming)
- [Localization API sample and the resx element](https://learn.microsoft.com/power-apps/developer/component-framework/sample-controls/localization-api-control)
- [getString](https://learn.microsoft.com/power-apps/developer/component-framework/reference/resources/getstring)
- [Code components ALM (versions, cdsproj, managed builds)](https://learn.microsoft.com/power-apps/developer/component-framework/code-components-alm)
- [Best practices (production builds, accessibility, scoped CSS, no formContext)](https://learn.microsoft.com/power-apps/developer/component-framework/code-components-best-practices)
- [Debug code components and the test harness limits](https://learn.microsoft.com/power-apps/developer/component-framework/debugging-custom-controls)
- [Common issues (web resource size)](https://learn.microsoft.com/power-apps/developer/component-framework/issues-and-workarounds)
- [Licensing and external-service-usage](https://learn.microsoft.com/power-apps/developer/component-framework/overview#licensing)
- [Paging](https://learn.microsoft.com/power-apps/developer/component-framework/reference/paging)
- [GitHub Actions for Power Platform](https://learn.microsoft.com/power-platform/alm/devops-github-available-actions)
- [Install the Power Platform CLI](https://learn.microsoft.com/power-platform/developer/cli/introduction)
- [Dataverse languages (LCIDs)](https://learn.microsoft.com/power-platform/admin/language-collations)
