# Profile: .NET + React + Azure

A complete starting point for a product built as **one ASP.NET Core API (minimal APIs, Dapper, Azure SQL)
serving React apps (Vite + TypeScript) from one container on Azure Container Apps**, with the release,
operations and quality machinery that such a product needs from day one: a quality gate that matches the
container image, idempotent migrations applied by a person, infrastructure that survives redeploys,
monitoring with tiered availability tests, backups proven by a restore drill, load tests, accessibility,
privacy and EU data residency by default.

The stack-neutral method (roles, waves, agent briefs, the quality gate, the release checklist) lives in the
framework's `docs/` and `skills/`. This profile is what those skills run when the project is on this stack.

## What is in it

| Path | What | Becomes, in the new repository |
| --- | --- | --- |
| `scaffold/` | The solution skeleton, named `App` (see below) | the repository root |
| `scaffold.ps1` | Copies everything below into a new repository and renames `App` | (not copied) |
| `build/` | Release and operations scripts, configured by `profile.config.json` | `build/` |
| `infra/` | Bicep: `main.bicep` and modules | `infra/` |
| `ci/pr.yml` | GitHub Actions checks for pull requests and main | `.github/workflows/pr.yml` |
| `load/` | k6 scenarios, a local test-data generator, how to run a real load test | `tests/load/` |
| `profile.config.json.example` | Every setting the scripts read, documented inline | `profile.config.json` |

### The scaffold

```
App.slnx  Directory.Build.props  Directory.Packages.props  global.json  VERSION  Dockerfile
build/contracts/   locales.json (offered languages)  plurals.json (CLDR rules, 76 languages)
                   routes.json (every route + who may call it)  privacy.json (tables without personal data)
db/migrations/     0001_ops.sql  0100_items.sql      idempotent, embedded, ledgered
src/App.Api/       Program.cs (migrate command, forwarded headers, canonical host, static apps)
                   AppSettings.cs  PublicUrls.cs  Redact.cs (log redaction)  SharedRateLimiter.cs
                   Endpoints/ (health live/ready, locales and bundles, sample items)
src/App.Data/      DatabaseMigrator.cs (ledger, changed-file refusal, app lock)  RateCounterStore.cs
                   ItemStore.cs (UPDLOCK, HOLDLOCK find-or-create; DB clock; ms precision)  Erasure.cs
src/App.Domain/    Localization/ LocaleCatalogue.cs  PluralRules.cs (data-driven CLDR)  Localizer.cs
                   Resources/{ui,email}.{lang}.json
tests/App.Tests/   TestDatabase.cs ([LocalDbFact], scratch DB per run, LocalDB or TEST_SQL_CONNECTION)
                   MigrationTests  DatabaseTests  ApiTests (routes contract)  LocalizationTests  RedactTests
src/web/           vite.config.ts (/app/)  vite.portal.config.ts (/portal/)  vite.design-system.ts
                   src/ (i18n, plural.ts, strings.ts, theme.ts, Chrome.tsx, styles/base.css,
                   styles/design-system/ generated)  scripts/ (check-strings, check-plurals, add-language,
                   axe-check)  tests/ (contrast.test.mjs, plural.test.ts)
build/framework.json  the design system (designSystem, theme), merged with the framework's template
```

Package versions are pinned centrally (`Directory.Packages.props`, `package.json` without ranges):
.NET 9, Microsoft.Data.SqlClient 6.0.1, Dapper 2.1.66, xUnit 2.9.2, FluentAssertions held below 8 (v8 is
paid for commercial use), React 19.2, Vite 7.3, TypeScript 5.9, Node 22.

## Prerequisites

- .NET SDK 9.0.200 or newer within 9.0 (`global.json` rolls forward within 9.0; 9.0.200 is the first band that reads `.slnx`).
- Node 22.18 or newer (type stripping for `node --test` on `.ts`).
- PowerShell 7.
- Windows: SQL Server LocalDB for database tests and local runs. Elsewhere: any SQL Server reachable through
  `TEST_SQL_CONNECTION` (a `mcr.microsoft.com/mssql/server:2022-latest` container works).
- For Azure: Azure CLI (`az`, with Bicep), `sqlcmd` (go-sqlcmd) for `Grant-DatabaseAccess.ps1`, and an
  account that can see the product's subscription. Docker is NOT needed: images build in the registry.
- Optional: k6 v2.3.0 (load tests), Playwright + `@axe-core/playwright` (accessibility check).

## How a skill uses this profile

| The skill wants to | Run |
| --- | --- |
| Start a project | `./scaffold.ps1 -Name MyProduct -Languages en-GB,nl,pl -Destination ../my-product -DesignSystem <id>` |
| Run the quality gate | `dotnet build -c Release` (0 warnings), `dotnet test`, then in `src/web`: `npm run check`, `npm run typecheck`, `npm test`, `npm run build` |
| Run the app locally | `./build/Start-Local.ps1 -Port <own port> -Database <own name>` (one port and database per agent) |
| Add a language | `node src/web/scripts/add-language.mjs <code> [culture]`, then translate the new bundles |
| Add a migration | a new `db/migrations/NNNN_name.sql` in the agent's reserved number slot, idempotent |
| Add a route | the endpoint, plus its line in `build/contracts/routes.json` with who may call it |
| Add a table | the migration, plus an `IErasureParticipant` or a `privacy.json` entry with a reason |
| Release | the release flow below |
| Check operations readiness | the "Operations readiness" section below |

Agent briefs should name: the repository path, `profile.config.json`, the agent's migration slot, its own
`-Port`/`-Database`, and the gate commands above with the numbers to report.

## Scaffold a project

```powershell
./profiles/dotnet-react-azure/scaffold.ps1 -Name MyProduct -Languages en-GB,nl,de,pl -Destination C:\src\my-product -DesignSystem neutral
```

- `-Name` (PascalCase) replaces `App` everywhere in the skeleton: namespaces, folders, files, the solution,
  the product name in titles. Lower-cased, it becomes the Azure name prefix and the image repository.
- `-Languages` decides the languages, per project. A bare code takes CLDR's likely culture (`nl` -> `nl-NL`,
  `en` -> `en-US`); give the culture when it matters (`en-GB`, `pt-PT`). The first one is the default unless
  `-DefaultLanguage`. English bundles are the source; every other language gets complete bundles with the
  plural forms its culture needs (Polish: one, few, many; Arabic: zero, one, two, few, many). New bundles
  hold English text until translated: `npm run check` cannot tell an untranslated value from a translation,
  so translating is an explicit task in the brief.
- `-DesignSystem` (default `neutral`) is the look: see [Design system](#design-system) below.
- `profile.config.json` is filled with the names; fill in `azure.tenantId` and `azure.subscriptionId` before
  any script that touches Azure (they refuse the placeholder).
- A git repository is initialised on `main`, nothing committed.

## Configuration

`profile.config.json` at the repository root drives every script; `profile.config.local.json` (gitignored)
is merged on top. Every key is explained in `profile.config.json.example` (`_doc` keys). Nothing in it is a
secret: secrets are Key Vault references (`app.secrets[].keyVaultSecret`) or passed at run time
(`Deploy-Infrastructure.ps1 -SecretValues`). Every `az` command passes `--subscription` from the config,
whichever subscription the CLI has selected.

## The quality gate

Every agent before reporting, and the lead again before a release:

1. `dotnet build -c Release`: warnings are errors in Release (`Directory.Build.props`), with the SDK the
   image uses (`global.json`: 9.0.200, latestFeature; `AnalysisLevel` pinned to `9.0-recommended`).
2. `dotnet test`: unit tests, database tests on a scratch database (LocalDB or `TEST_SQL_CONNECTION`), and
   the contract tests: routes, privacy coverage, string bundles and plural forms, plural rules against
   Node's `Intl.PluralRules`.
3. In `src/web`: `npm run check` (strings complete in every language, plural forms, picker order; CLDR data
   against Intl), `npm run typecheck` (`tsc -b`), `npm test` (contrast in both themes, plural helper),
   `npm run build` (both apps).
4. Before a release or after UI changes: `npm run axe` against a running local API (WCAG 2.2 AA rules,
   light and dark, 390 and 1440 px) plus a keyboard pass.

## Release flow, mapped to scripts

The owner's go comes first (standing or explicit); approval in one context does not carry over.

| Step | How |
| --- | --- |
| 1. Commit only the release's files, push | git (the lead) |
| 2. Clean copy of the commit | `./build/Release-Worktree.ps1 -Keep` creates `<repo>-release` as a detached worktree |
| 3. Release build with the image's SDK, tests without an artifacts path | same script (temporary SDK pin when `-SdkVersion` or `dotnet.releaseSdkVersion` is set) |
| 4. Web checks without reinstalling | same script (node_modules junction to the main tree, removed safely after) |
| 5. Migrations on production, as a person | `./build/Initialize-Database.ps1` from the worktree; asks before switching the CLI's default account, restores it in `finally` (`Invoke-WithAccount.ps1`) |
| 6. Infrastructure changes (alerts, retention, settings) | `./build/Deploy-Infrastructure.ps1` (carries over what it does not know) |
| 7. Publish the image, wait for a healthy revision | `./build/Publish-Container.ps1` (tag `<VERSION>-<yyyyMMddHHmmss>`) |
| 8. Smoke test production | `./build/Test-Deployment.ps1` (checks from `smokeChecks.checks`) |
| 9. Errors and warnings of the new revision | `./build/Check-Logs.ps1` (wait about five minutes for logs to arrive) |
| 10. Tag the changelog entries with the release | the project's changelog script (stack-neutral) |
| 11. Record the live image in STATE.md, commit, push | git |
| 12. Remove the worktree | the command `Release-Worktree.ps1 -Keep` printed |

A new environment, once: `Deploy-Infrastructure.ps1` (the app runs the platform placeholder),
`Initialize-Database.ps1`, `Grant-DatabaseAccess.ps1` (the app's identity gets read and write only),
`Publish-Container.ps1` (the first image goes through the template, which sets port 8080 and the probes).

## Operations readiness

Part of planning, not an afterthought: a project is not "live" until each of these is in place and proven.

**Monitoring and alerts** (`infra/modules/alerts.bicep`, config `monitoring`). One action group emails
`alertEmail`. Availability tests come in **tiers** because every run is billed: `core` (the app with its
database, and the main page) or `extended` (plus secondary surfaces); 3 to 5 test locations (European by
default), every 300, 600 or 900 seconds; an alert fires when all but two locations fail. A core test must
read the database: the health probes deliberately do not. Alert rules: `server-errors` (5xx in 5 minutes),
`restarts`, `unhealthy` (failed probes in the system log), `error-spike` (fail/crit/exception lines),
`sql-cpu`, `sql-workers`, `sql-storage`, `vault-throttled`; thresholds in the config, any rule switched off by
name. Write a runbook row per alert in STATE.md: fires when, look first at.

**Backups** (`infra/modules/sql.bicep`, config `database`). Point-in-time restore for
`backupRetentionDays` (1-35, default 14; a redeploy never shrinks what is set), long-term retention of weekly,
monthly and yearly backups (ISO 8601 durations), and `backupRedundancy` (Local/Zone stay in the region; Geo
copies to the paired region: a conscious choice between residency and regional recovery).

**Storage** (`infra/modules/storage.bicep`, config `storage`). Private containers only, no account keys,
blob and container soft delete for `softDeleteDays` (default 14), optional versioning.

**Restore drill** (`build/Test-RestoreDrill.ps1`). Restores production to a new database at a point in time,
compares row counts and the configured queries side by side, times it, deletes the copy (also on failure),
and shows blob soft delete; `-BlobUndeleteTest` proves an undelete. It asks you to type the drill
database's name before restoring. Run it after go-live and at least quarterly; record the time it took.

**Load tests** (`load/`, see its README). k6 v2.3.0, a scenario per journey with p95 and error-rate
thresholds, a local generator; local trials any time, real runs only in a separate resource group with the
owner's go per run, never production.

## Accessibility, theming, languages

- Colour tokens on `:root` in `src/web/src/styles/tokens.css`: light by default, dark by
  `prefers-color-scheme`, and a reader's choice through `data-theme` (the theme select in `Chrome.tsx`).
  `tests/contrast.test.mjs` holds every text pair to 4.5:1 and every UI/focus pair to 3:1 in both themes,
  and the two dark blocks to each other.
- `base.css`: a visible focus ring (never removed), a skip link, 44 px targets, reduced motion honoured.
- `<html lang>` follows the chosen language's culture and `<html dir>` its direction (Arabic, Hebrew, Persian,
  Urdu ... are right to left: use logical CSS properties such as `inset-inline-start`); each language in the
  picker carries its own `lang`.
- Strings by key with the English beside the key; counted strings by CLDR category on both sides
  (`Intl.PluralRules` in the browser, `plurals.json` evaluated by `PluralRules.cs` on the server, held to
  each other by `check-plurals.mjs` and `LocalizationTests`).
- `npm run axe` runs axe-core (WCAG 2.2 AA tags) over the apps in both themes and two widths, and flags
  sideways scrolling. Not in CI by default (it needs a browser and a running API).

## Design system

The web apps take their look **only** from the project's design system
([docs/design-systems.md](../../docs/design-systems.md)); nothing in the scaffold carries a colour of its own.
`scaffold.ps1 -DesignSystem <id>` (default `neutral`) runs
`node <framework>/scripts/design-system.mjs build <id> --out src/web/src/styles/design-system --targets css,ts,email,charts`
and records `designSystem` (id, out, targets) and `theme` (the generated `tokens.css` and `tokens.json`) in
`build/framework.json`. The scaffold in the framework ships the `neutral` files; they are replaced, never
edited.

- `styles/design-system/tokens.css` is imported first in `src/main.tsx` and `portal/src/main.tsx`, then
  `styles/base.css`. It carries both themes (the system preference, and `data-theme="light|dark"` on `<html>`
  from the theme picker, `src/theme.ts`), the fonts as `@font-face` (served from the app, never a font CDN),
  the type scale and the roles.
- `styles/base.css` and every component use the **roles** (`--ds-background`, `--ds-surface`,
  `--ds-surface-subtle`, `--ds-text`, `--ds-text-muted`, `--ds-link`, `--ds-accent`, `--ds-text-inverse`,
  `--ds-focus`, `--ds-danger`, `--ds-divider` ...), the fonts (`--font-sans`, `--type-<style>-*`) and the
  radius tokens, so the app survives a switch of design system. Control edges use `--ds-text-muted`, because a
  design system's border role may be decorative (below 3:1).
- `tests/contrast.test.mjs` (in `npm test`) reads the generated `tokens.json`: the design system's own pairs
  in both themes, the role pairs `base.css` uses (`APP_PAIRS`: text 4.5:1, control edges and focus 3:1), the
  two dark blocks, **no colour values in `src/`, `portal/` or `index.html`** and no undefined `--ds-*` name,
  and that the files come from the design system `build/framework.json` names. Add a pair to `APP_PAIRS`
  when a component puts a role on another.
- `vite.design-system.ts` copies `tokens.css`, the fonts and the logos to `/app/design-system/` at build time:
  the API's start page (`wwwroot/index.html`) links that stylesheet, and emails link the PNG logo from
  `/app/design-system/logos/` (an absolute https URL from `PublicUrls`).
- **Favicon**: for a design system with a mark (`logos.files.markOnLight` and `markOnDark`, where its logo
  rules let the mark stand alone, as favicons), `scaffold.ps1` adds both as `<link rel="icon">` with
  `prefers-color-scheme` to both apps' `index.html`. `neutral` has none: the product's own icon comes later.
- Emails (`Resources/email.*`): the colours of `email-palette.json`, light inline and dark in the
  `prefers-color-scheme` block. Charts: series from `chart-palette.json` (or `role()`/`color()` from
  `tokens.ts`), each chart with a table.
- **Switch or regenerate** with the framework's `design-system` skill (it rebuilds the folder from
  `build/framework.json`); add `video` with video tours and `office` for documents to `designSystem.targets`.

## Privacy

- Logs carry why, never who: `Redact.Url` (scheme and host only), `Redact.Email` (domain only),
  `Redact.Text`/`Redact.Exception` for messages, and `RequestFailureLogging` logs the route pattern, not the
  path or query string.
- Erasure: every store with personal data registers an `IErasureParticipant` (tables it covers, how it
  deletes or anonymises one person). `DatabaseTests` fails when a table in the migrated database is neither
  covered nor listed in `build/contracts/privacy.json` with a reason.
- Rate-limit partitions are stored hashed; no address is kept in clear.

## Data residency

- `location` defaults to `swedencentral` (an EU region), and every resource that stores data is created
  there: the database and its backups (Local or Zone redundancy), long-term backups, storage (LRS/ZRS),
  Key Vault, Log Analytics and workspace-based Application Insights, the registry, Azure OpenAI.
  `sqlLocation`/`containerLocation` exist only for when a region refuses new SQL servers: keep them in the
  same geography.
- Azure OpenAI (`openAi.enabled`) uses a **DataZoneStandard** deployment by default: prompts are processed
  only within the EU data zone when the account is in an EU region. `Standard` keeps processing in the
  region itself. `GlobalStandard` (processing anywhere in the world) is deliberately not allowed by the
  template. Abuse monitoring may keep prompts and completions up to 30 days in the same geography unless
  Microsoft approves modified abuse monitoring: say so in the privacy statement or apply for the exemption.
  Local auth (API keys) is off; the app's identity calls the model.
- What may run or be stored elsewhere, and how to avoid it:
  - Availability tests run from the chosen test locations (European by default) and only GET public URLs;
    keep `monitoring.testLocations` in Europe.
  - Metric alert rules and the action group are `global` resources: configuration only, no product data.
    Alert emails leave Azure by nature: keep personal data out of alert descriptions (the templates do).
  - Geo-redundant options (`sqlBackupRedundancy: Geo`, `Standard_GRS`/`RAGRS` storage) copy data to the
    paired region; for EU regions that pair stays in Europe, but check the pair if the requirement is a
    single country.
  - Entra ID (sign-in) and Azure Resource Manager are global services; they hold identities and resource
    metadata, not product data.
  - Third-party services the product calls (mail, payments, AI outside Azure) are outside these
    templates: record where each processes data before adopting it.

## Gotchas learned the hard way

- **`/path` is an absolute URI on Linux.** `Uri.TryCreate("/x", UriKind.Absolute, …)` succeeds on Linux (as
  `file:///x`) and fails on Windows, so code that treats "not absolute" as "relative" behaves differently on
  the CI runner and in the Linux image. Check `!uri.IsFile` (or the scheme) as well. Found by the scaffold's
  first CI run.
- **Static state leaks between tests.** A test that configures a process-wide value (a remembered origin, a
  clock) changes what later tests see, and Linux runs tests in a different order. Assert against the
  configured value, or reset it in the test.
- **SDK pin vs the image's SDK, and analyzers as errors.** A newer local SDK has newer compiler warnings
  and analyzers; the image (`sdk:9.0`) built with warnings as errors failed on what the laptop never showed
  (CS1998, CA1859). Commit `global.json` (9.0.200, latestFeature), pin `AnalysisLevel` to the major
  (`9.0-recommended`, not `latest-recommended`), and build Release before every release with the image's
  SDK (`Release-Worktree.ps1` can pin an exact one temporarily). The scaffold's own CA1859 fix came from
  exactly this check.
- **Tests that locate the repository must run without `--artifacts-path`.** An artifacts path moves the
  build output outside the repository, so walking up to the `.slnx` fails. Build with a scratch artifacts
  path if you like; run the tests without one. Prefer copying contracts beside the tests (the test
  project does).
- **Corporate TLS-inspecting proxies (Zscaler and the like).** Public-IP lookups, smoke tests and npm/NuGet
  can fail with certificate errors, or the address Azure sees is the proxy's egress address (so the SQL
  firewall rule is wrong). Pass `-ClientIp` explicitly; to see what a host really serves, pin the address
  with `curl --resolve <host>:443:<ip> https://<host>/health/ready -v`; run releases from a network without
  the proxy when possible.
- **The app's identity cannot migrate the schema, by design.** It has db_datareader and db_datawriter only;
  a person runs `Initialize-Database.ps1` (the API's `migrate` command, signed in as themselves). The
  deployed app only checks for pending migrations and logs loudly.
- **Ask before switching the CLI's default account, every time, and restore it in `finally`.**
  `Authentication=Active Directory Default`, `DefaultAzureCredential` and `sqlcmd -G` use the az CLI's
  current account; on a machine whose default is another (a client's) account, they run as the wrong
  person. `Invoke-WithAccount.ps1` shows from/to/why, asks, switches, runs, and switches back even when the
  step fails. An agent never answers that question for the owner.
- **Key Vault references vs plain container app secrets when the deploy script reads secrets back.**
  `az containerapp secret list --show-values` returns a plain secret's value but, for a Key Vault reference,
  only its `keyVaultUrl` and no value. A script that carries secrets over by value deploys an empty secret
  for every reference. `Deploy-Infrastructure.ps1` carries references as references; prefer
  `keyVaultSecret` in the config so values never pass through a deployment.
- **A template deployed without what is running removes it.** Custom domains on the ingress, settings set by
  hand, secrets, the running image (the placeholder comes back), the alert address (all alerts vanish),
  purge protection (cannot be turned off; the deploy fails). The deploy script reads all of them back first
  and names what it carried over.
- **The Linux image has no legacy code pages.** Windows-1252, IBM437 and friends throw
  `NotSupportedException` in the container and work on Windows. `Program.cs` registers
  `CodePagesEncodingProvider.Instance` at start.
- **Insert-if-not-exists deadlocks under concurrency.** `IF NOT EXISTS ... INSERT` races: two requests both
  see nothing, then deadlock or violate the key. Take `UPDLOCK, HOLDLOCK` on the existence check inside a
  transaction (`ItemStore.EnsureTagAsync`), back it with a unique key, and keep a concurrency test (twenty
  callers, one row).
- **Compare timestamps at the precision they are stored.** `DATETIME2(3)` keeps milliseconds; `DateTime`
  has 100 ns ticks. Comparing a value read back with one held in memory fails on some machines and not
  others. Compare stored with stored, or truncate (`ItemStore.StoredPrecision`).
- **The database clock, not the app clock.** Replicas' clocks drift; use `SYSUTCDATETIME()` defaults and
  windows computed in SQL (the rate limiter does), and do not assert exact equality with the app's clock.
- **Don't let a static remember a request's host.** A link written later (an email) would carry whatever
  Host the last caller sent. Configure `Site__PublicBaseUrl` and use `PublicUrls`; never honour
  `X-Forwarded-Host`.
- **The health probes must not touch the database.** A slow database would restart healthy containers; the
  availability tests check the database instead.
- **`az acr build` can report failure for a build that succeeded.** The client dies printing the streamed
  log (non-UTF-8 consoles); ask the registry whether the tag arrived (`Publish-Container.ps1` does).
- **Removing a node_modules junction with a recursive delete empties the target.** Delete the link itself,
  non-recursively (`[System.IO.Directory]::Delete(path, $false)`).
- **`.slnx` needs SDK 9.0.200 or newer.** `global.json` says 9.0.200 with latestFeature, so neither a laptop
  nor CI picks an older 9.0 band that cannot read the solution file.
- **`node --test tests/` no longer expands a folder in recent Node.** Pass a glob: `node --test "tests/*.test.*"`.
- **winget may lag behind a pinned tool version** (k6 2.3.0 vs 2.2.0 on winget): pin from the release page.

## CI

`ci/pr.yml` (becomes `.github/workflows/pr.yml`) runs on pull requests, pushes to main and by hand:

- **dotnet**: `actions/setup-dotnet` reads `global.json`; NuGet cache; restore, Release build (warnings are
  errors), tests. LocalDB is Windows only, so a `mcr.microsoft.com/mssql/server:2022-latest` **service
  container** (health-checked with `sqlcmd`) stands in, and the tests find it through
  `TEST_SQL_CONNECTION`: the database tests run in CI, not skip. Its SA password is a throwaway for a
  container that lives as long as the job; it is not a secret.
- **web**: `actions/setup-node` 22 with the npm cache, `npm ci`, check, typecheck, node tests, build.
- **image**: `docker build` of the Dockerfile with tests skipped inside (the dotnet job ran them), so a broken
  image is found before the registry.

Actions are pinned to full commit SHAs with the release in a comment. No secrets, no deployment. Inside the
image build (`RUN_TESTS=true` by default, as `Publish-Container.ps1` uses it) the database tests skip by name.

## Related guidance elsewhere in the framework

- `docs/operations.md`: the stack-neutral operations readiness checklist this section implements.
- `docs/mobile-apps.md`: wrapping the web app for Android and iOS (Capacitor), stores and signing.
- `docs/integrations-dynamics.md`: Dynamics 365 / Dataverse integration.

## What was validated, and what was not

Validated locally (17 Oct 2026): the scaffold builds in Release with 0 warnings on SDK 9.0.315; 22 tests
pass on LocalDB and again through `TEST_SQL_CONNECTION`; `npm ci`, check, typecheck, 10 node tests and both
builds pass; a product generated with `scaffold.ps1 -Name Acme -Languages en-GB,nl,pl,pt-PT` passes the same
gate, and so does `-Name Northwind -Languages nl,de,ar` (no English offered, Dutch default, Arabic with five
plural forms); `Release-Worktree.ps1` ran the full gate in a worktree with a temporary SDK pin and left the main tree's
node_modules intact; the generated API ran on LocalDB and passed `Test-Deployment.ps1`; the generator and all
three k6 scenarios ran against it within thresholds, and the target guards refused remote and production
targets; every Bicep file builds and lints without warnings; `actionlint` passes the workflow; every script
parses, and the Azure scripts refuse the placeholder config before calling Azure. The design system
(17 Oct 2026): products generated with `-DesignSystem neutral` and with the corporate design system pass
`npm ci`, check, typecheck, 12 node tests (the design system ones included) and both builds; the
corporate one also `dotnet build` and 22 tests on LocalDB; both apps rendered in Edge in light and dark at
1440 and 390 px (system preference and the theme picker), with the brand font loaded and the favicon
links resolved, and the start page styled from `/app/design-system/tokens.css`.

Not validated: anything against Azure (deployments, ACR builds, restore drill, log queries, the account
switch), the Docker image build (no Docker on the validating machine: the CI `image` job covers it), the
GitHub Actions run itself (actionlint only, until a test repository runs it), and `npm run axe` (Playwright
not installed).
