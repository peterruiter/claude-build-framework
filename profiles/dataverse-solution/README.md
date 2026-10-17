# Profile: Dataverse solution (a full product on Dynamics 365 / Dataverse)

For a **large product built on Dataverse**: many tables, model-driven apps, security roles,
plug-ins, PCF controls, Power Automate flows, a few Azure side services, data migration, and
more than one customer environment to deploy to. The product is a set of **solutions** that
live **unpacked in git**, a **data model, role matrix and privacy register as code** with tests
that hold them to the solutions, scripts that refuse to touch an environment until it is named,
shown and confirmed, and a release that builds **managed** solutions in a clean build
environment and deploys them with per-environment settings behind an approval.

The stack-neutral method (roles, waves, agent briefs, quality gate, release checklist) lives in
the framework's [docs](../../docs/README.md) and skills. This profile is what they run when the
product is on Dataverse. It works together with:

| Part of the product | Profile |
| --- | --- |
| Plug-in assemblies, custom APIs, step registration, plug-in unit tests | [dataverse-plugins](../dataverse-plugins/) |
| PCF code components (field and dataset controls) | [power-platform-pcf](../power-platform-pcf/) |
| Azure side services (APIs, workers, portals outside Dataverse) | [dotnet-react-azure](../dotnet-react-azure/) |
| A SaaS product that connects *to* a customer's Dataverse | [docs/integrations-dynamics.md](../../docs/integrations-dynamics.md) (not this profile) |

**Not for**: a small app with three tables (one solution and Power Platform pipelines are
enough), or a product that only integrates with Dynamics from outside.

## Check the tools first

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/check-prereqs.mjs dataverse-solution
```

The list is [prerequisites.json](prerequisites.json): Power Platform CLI (pac), .NET SDK 10,
PowerShell 7, Node.js 22.18+, git, GitHub CLI and the Azure CLI (the Web API scripts take
their token from it). The plug-in and
PCF profiles bring their own lists. Note: pac installed as a .NET tool has no `pac data`
(Configuration Migration data); on Windows add the MSI or the VS Code extension when the
project moves configuration data.

## What is in it

| Path | What | Becomes, in the new repository |
| --- | --- | --- |
| `scaffold/` | Repository skeleton, sample named `contoso` / `CaseApp` ([what is sample](scaffold/README.md)) | the repository root |
| `scaffold/CLAUDE.dataverse.md` | Standing rules for Dataverse work | merged into CLAUDE.md, then deleted |
| `scaffold.ps1` | Copies the scaffold and renames the sample to the product, publisher and prefix, with labels in every chosen language | (not copied) |
| `prerequisites.json` | Tools and versions for the prerequisites check | (read by the framework) |

## Scaffold a project

```powershell
./profiles/dataverse-solution/scaffold.ps1 -Name Fabrikam -Prefix fab -Languages en,nl,de -Destination C:\src\fabrikam
```

- `-Name` (PascalCase) replaces `CaseApp` everywhere: solution names (`FabrikamCore`), texts,
  environment URLs. `-Publisher` defaults to the name. `-Prefix` replaces `contoso` in every
  schema name, file and folder (`fab_Request`); the option value prefix is derived from it.
- `-Languages` are mapped to Dataverse LCIDs; **the first is the base language** (every
  environment must be created with it). A bare code takes the likely culture (`en` en-US 1033,
  `nl` nl-NL 1043, `pt` pt-BR); give the culture when it matters (`en-GB`, `fr-BE`). A
  language outside the script's table stops it with the list of known ones.
- Every label in the sample solution and in `schema.json` is written per LCID: English, Dutch
  and German texts are real; any other language gets the English text and the script says how
  many labels to translate (the checks cannot tell English from a translation).
- It refuses a destination that exists and is not empty, initialises git on `main` and commits
  nothing. Afterwards `npm test`, `Build-Solution.ps1 -RoundTrip` and `Test-Translations.ps1`
  pass in the new repository.

```
solutions/<Name>/src/            unpacked solutions (pac XML layout), the source of truth for components
build/contracts/schema.json      publisher, solutions, languages (LCIDs), tables, columns, choices, env vars, connection refs
build/contracts/roles.json       role x table x privilege x depth, plus named platform privileges
build/contracts/privacy.json     record of processing: categories, purposes, legal basis, retention, erasure
environments.json                dev, build, test, prod (+ environments.local.json, gitignored)
deployment-settings/<env>.json   environment variable values and connection references per environment
build/*.ps1                      Build-Solution, Export-Solution, Import-Solution, New-Schema, New-SecurityRoles,
                                 Test-Translations, Export-PrivacyRegister, Test-CheckerResults, Test-Scripts, Common.psm1
tests/contracts/*.test.mjs       schema, roles, privacy, environments and settings, scripts (npm test)
.github/workflows/pr.yml         contracts + pack round trip (always), solution checker (when configured)
.github/workflows/release.yml    tag -> managed from the build environment -> test -> production (approval)
```

## How a skill uses this profile

| The skill wants to | Run |
| --- | --- |
| Start a project | `./scaffold.ps1 -Name <Product> -Prefix <prefix> -Languages <base>,<others> -Destination <folder>`, then merge with the framework's project template (`package.json` scripts, `.gitignore`, CLAUDE.md), fill `environments.local.json`, replace the sample table with the product's |
| Check tools | `node ${CLAUDE_PLUGIN_ROOT}/scripts/check-prereqs.mjs dataverse-solution` |
| Run the quality gate | `npm test`, `pwsh ./build/Build-Solution.ps1 -RoundTrip`, plus the plug-in and PCF gates |
| Add a table or column | `schema.json` + `roles.json` + `privacy.json` (labels in every LCID), `New-Schema.ps1` (plan), `-Environment dev` (compare), `-Apply`, `New-SecurityRoles.ps1 -Environment dev -Apply`, `Export-Solution.ps1`, `npm test` |
| Bring a maker-portal change into git | `Export-Solution.ps1` in development, review the diff, gate, commit |
| Add a language | its LCID in `schema.json` (the test maps it from `locales.json`), enable it in every environment, translations export/import in development, export, `Test-Translations.ps1` |
| Release | the release flow below |

Agent briefs name: the solution(s) the agent may change, its personal development environment
(an id in the agent's `environments.local.json`), its record scope for test data, and the gate
commands with the numbers to report. Agents never import into test or production.

## Architecture

```
            GitHub (source of truth)                      Dataverse environments
  solutions/*/src  contracts  build/*.ps1          dev (unmanaged, makers + scripts)
        |              |           |                  |  Export-Solution.ps1 (unpack into git)
        +-- PR: npm test, pack round trip, checker    |
        +-- tag: Build-Solution -> build env (unmanaged import, product only) -> export managed
                                         |
                       release/*.zip + release.json (import order, versions)
                                         |
                  test (managed, deployment-settings/test.json)
                                         |  GitHub environment "production": owner's approval
                  production (managed, deployment-settings/prod.json)
```

**Solution segmentation.** One publisher and one prefix for the whole product, forever. As few
solutions as the product needs, split by layer and dependency, never by team:

| Layer | Holds | Depends on |
| --- | --- | --- |
| `<Product>Core` | tables, columns, relationships, choices, security roles, environment variables, connection references | platform only |
| `<Product>Logic` | plug-in assemblies and steps, custom APIs, PCF controls | Core |
| `<Product>App` | model-driven apps, sitemaps, forms and views (segmented: only the assets it changes), web resources, flows, dashboards | Core, Logic |
| `<Product><Module>` (optional) | a module customers can leave out | the layers below |

Microsoft's guidance: a single solution is fine for small and medium work; for large products,
layered solutions, ideally each developed in its own development environment with the layers
below imported **managed**, so a missing dependency shows up in development rather than at
import. Keep the count small; every layer is another import and another version. In upper
layers add only the table assets they change (table segmentation); a table that does not
exist downstream yet must go with all its objects. Avoid patches (Microsoft no longer
recommends them); ship a new version.

**Layering.** Managed layers stack; for most components the top layer wins, while
model-driven apps, forms and sitemaps merge. An **unmanaged layer on top** in test or
production silently hides every later release of that component: block unmanaged
customisations in non-development environments (a managed environment setting) and, when one
exists, remove the active layer rather than importing with overwrite.

**Schema as code and generators.** `schema.json` is the contract; `New-Schema.ps1` applies it
to development through the Web API (additive only, labels in every LCID, every component in
its solution), `Export-Solution.ps1` brings the result into git, and the tests hold contract
and solution together in both directions. Generate from the contract what must agree with it:
constants for plug-ins (see the plug-ins profile), reference tables in the docs, the privacy
register. Generated files are never hand-edited; CI regenerates and compares. Forms, views,
apps and flows are designed in the maker portal and exported: the unpacked XML is their
source, reviewed in pull requests.

## Environment strategy

| Environment | Type | Holds | Who changes it |
| --- | --- | --- | --- |
| Personal dev (one per developer or agent) | Developer or sandbox | the product unmanaged (or lower layers managed) | the developer; reset freely |
| Development (shared) | Sandbox, managed environment | the product unmanaged; integration point | makers and the scripts, then Export-Solution |
| Build | Sandbox | **the product only**, unmanaged from git | the release workflow only |
| Test (and UAT, training if needed) | Sandbox, managed environment | managed solutions | the release workflow / Import-Solution |
| Production (one per customer) | Production, managed environment | managed solutions | the release workflow, with the owner's approval |

- **Managed environments** for everything except personal dev: solution checker enforcement
  (block in production, warn in sandboxes), blocking unmanaged customisations, backup retention
  up to 28 days for production, and Power Platform pipelines require managed targets (from
  October 2026 deployments to unmanaged targets are blocked after a grace period).
- **The build environment holds nothing else.** Whatever is in it ends up in the managed
  release: a customer extension, a generated runtime table, demo data in a table the product
  owns. A release script refuses when it finds something that is not the product.
- **Per-environment values** (URLs, mailboxes, feature switches) are environment variables;
  connections are connection references; both are set by the deployment settings file at
  import. Nothing environment-specific is hard-coded in a flow, plug-in or web resource.
- **Secret environment variables** point at Azure Key Vault (same tenant as the environment,
  `Microsoft.PowerPlatform` resource provider registered, *Key Vault Secrets User* for the
  Dataverse service principal and the makers, one vault per environment). They are readable by
  flows, custom connectors and Copilot Studio, not by plug-ins: a plug-in that needs a secret
  uses a managed identity instead (plug-ins profile).
- **Power Platform pipelines vs GitHub Actions.** Pipelines are good for maker-built
  components without code. This profile deploys from GitHub Actions because the gate (contract
  tests, round trip, checker, What's new) must run on the same commit that is released, and
  because the framework's rule is "GitHub with green CI". Azure DevOps works the same way with
  the Power Platform Build Tools. The ALM Accelerator is deprecated; do not start on it.

## Contracts as code

| Contract | Holds | Test fails when |
| --- | --- | --- |
| `schema.json` | publisher, prefix, option value prefix, solutions and import order, languages (LCIDs and cultures), tables, columns, global choices, environment variables, connection references, every label per LCID | a name lacks the prefix or repeats; an option is outside the publisher range; a label is missing or longer than 500 characters; a table or column is in the contract but not in the unpacked solution (or the reverse); the solution's version does not start with `VERSION`; a language in `locales.json` has no LCID |
| `roles.json` | role, table, privilege, depth (Basic, Local, Deep, Global), named platform privileges | a table has no role (only administrators would see it); an unknown table, privilege or depth; writing without reading; Delete at organisation depth |
| `privacy.json` | categories of personal data, purposes with legal basis, data subjects, recipients, retention (ISO 8601) and its trigger, transfers; per table and column: category, purposes, erasure (delete, anonymise, legal hold), audit note | a table or column is missing; a purpose lacks a basis or retention; special-category data lacks an article 9 condition; audited personal data has no note on audit history |
| `environments.json` | environments, kind, what each accepts, approval, settings file | a production environment without approval or not managed; a test or production environment without a settings file; anything that looks like a credential |
| `deployment-settings/*.json` | env var values, connection references per environment | a variable or reference is missing or extra; a value looks like a secret; a secret variable is not a Key Vault reference; a required variable is empty |

Add contracts when two places must agree: custom APIs, plug-in steps (the plug-ins profile has
its own), model-driven app navigation, configuration data tables, feature modules.

## Languages

- The project's languages come from the framework's `locales.json`; `schema.json` maps them to
  **LCIDs** (`en-US` 1033, `en-GB` 2057, `nl-NL` 1043, `de-DE` 1031, `fr-FR` 1036 ...). The
  **base language** is fixed when an environment is created and cannot change: create every
  environment with the same base language, and enable the other languages in each one before
  importing labels in them (the first import after enabling a language is slower).
- **What travels how** (Microsoft's table): tables, columns, choices, forms, views, charts,
  dashboards, relationships and messages by **translation export/import**
  (`CrmTranslations.xml`, or the `ExportTranslation` / `ImportTranslation` messages); web
  resources by **RESX web resources** per language; sitemap titles in the app designer per
  language (not in the export); security role names, processes and templates are base language
  only or one component per language; plug-ins read texts from XML or RESX web resources.
- Translation round: export translations from development, fill the column per LCID (agents
  key by key against the glossary), import, publish, export the solution, run
  `Test-Translations.ps1`. Labels longer than 500 characters fail the import. Changing a
  base-language label through the import does nothing: change it in the designer.
- **Find components by unique name or base-language label, never by the display name in the
  user's language.** A script that looked up a view by name as a Dutch user found nothing and
  created a duplicate every run; read labels with `RetrieveLocLabels` and match on the base
  language.
- `Test-Translations.ps1` checks the contract, the unpacked solutions (the product's own
  components) and RESX files offline; `npm test` runs it.

## Accessibility

The model-driven runtime is built to WCAG; what the product adds is the product's
responsibility:

- **Forms**: a label on every field, a logical section and tab order, no information in colour
  alone (views, charts, status icons), required fields marked by the platform, not by text.
- **Web resources**: semantic HTML, keyboard reachable, visible focus, accessible names,
  `lang`, contrast in light, dark and Windows high contrast; follow Microsoft's "Create
  accessible web resources"; run axe on them in a small harness.
- **PCF controls**: keyboard, focus and screen reader support, Fluent UI tokens; see the
  [PCF profile](../power-platform-pcf/).
- **Custom pages**: modern controls (they follow the DOM order, Z order, no tab index);
  overlapping controls break the tab order.
- Test per role with keyboard only and with a screen reader on the main journeys; record what
  was tested in STATE.md. Framework method: [docs/accessibility.md](../../docs/accessibility.md).

## Design system

The project's design system ([docs/design-systems.md](../../docs/design-systems.md)) is generated with the
targets `dataverse`, `email` and `charts` (plus `css` and `ts` for web resources and the theme contract
test, `office` for documents) into `design-system/` (`designSystem.out` in `build/framework.json`):

- **Model-driven apps**: `dataverse-theme.xml` is a modern-look `CustomTheme` (the brand ramp in all 16
  slots, the font, and `AppHeaderColors` for every header state, each checked at 4.5:1). Add it to the
  core solution as a **Data (XML)** web resource and add the **Custom theme definition** setting with
  that web resource's name as the environment value (or `dataverse-app-header.xml` with **Override app
  header color** for the header only). Commit the unpacked web resource; regenerate and repack when the
  design system changes. A logo goes in as an image web resource (about 156 × 48, the lockup for the
  header's background) named in `logoWebResource`. No dark mode and no web fonts in model-driven apps.
- **Web resources and custom pages**: `tokens.css` (with its fonts) for HTML web resources; custom
  pages do not take the modern theme yet, so use the palette's values there.
- **Email templates** (Dataverse email templates, Power Automate mails): the colours of
  `email-palette.json`, inline.
- **Charts and dashboards**: series in the order of `chart-palette.json`; system charts carry their
  colours in the chart XML.
- **PCF controls** follow the host theme ([PCF profile](../power-platform-pcf/), and
  [PCF code components](../../docs/design-systems.md#pcf-code-components)).

## Privacy and data sovereignty

- **Geo**: a Dataverse environment's data stays in the region it was created in. Create every
  environment of a customer in the customer's geo (Europe by default), and record it in
  `environments.json` and STATE.md.
- **Copilot and generative AI features**: for environments in Europe, Azure OpenAI is used in
  the EU Data Boundary, but Bing-powered features process in the United States, and the
  "Move data across regions" setting lets prompts and results leave the region. Decide per
  environment with the owner (and the customer), record it, and switch off what is not decided.
- **Solution checker**: `pac solution check --geo` decides where the solution is analysed;
  use the project's region (`Europe`). Solutions hold customisations, not records.
- **Auditing**: switch it on for tables with personal data where accountability needs it, set
  the environment's **audit retention** (the default is *forever*) to no longer than the
  longest purpose, remember that audit history keeps old values of personal data (erasure must
  delete a record's change history too), and that audit logs use log capacity. A retention
  change applies to new audit records only.
- **Retention and erasure**: per table in `privacy.json`; implement with bulk delete jobs or
  long-term retention policies, and an erasure path (delete or anonymise, plus change history)
  that covers every table with personal data. Test data and copies (sandboxes restored from
  production) count too: anonymise before anyone works with a copy.
- **Privacy register**: `Export-PrivacyRegister.ps1` writes it from the contract for every
  release; each customer is its own controller and fills in controller and DPO.
- Framework method: [docs/privacy-and-sovereignty.md](../../docs/privacy-and-sovereignty.md).

## Quality gate

Every agent before reporting, and the lead before a release:

| # | Step | Command | Passes when |
| --- | --- | --- | --- |
| 1 | Contracts, scripts parse, translations, privacy register | `npm test` | 0 failures (count reported) |
| 2 | Pack from source; source round-trips unchanged; version stamped | `pwsh ./build/Build-Solution.ps1 -RoundTrip` | no difference |
| 3 | Plug-in build and unit tests | the [plug-ins profile](../dataverse-plugins/) | clean |
| 4 | PCF build, lint, tests | the [PCF profile](../power-platform-pcf/) | clean |
| 5 | Solution checker | CI job `checker` (or `pac solution check --path "out/*.zip" --geo Europe`) then `Test-CheckerResults.ps1` | no Critical or High |
| 6 | Schema and roles against development (when they changed) | `New-Schema.ps1 -Environment dev`, `New-SecurityRoles.ps1 -Environment dev` | 0 differences after export |
| 7 | Version | `VERSION` bumped, solution version agrees (test 1), higher than production | yes |
| 8 | UI and accessibility (UI changed) | journeys per role in development or test, keyboard and screen reader, screenshots in every configured language | looked at, fixed |
| 9 | Privacy and residency | the framework checklist; new tables in `privacy.json`; no new cross-region processing without a decision | answered |
| 10 | What's new | framework changelog, every language | present |
| 11 | CI green on the pushed commit | `gh run watch` | green |

**Testing.** Unit tests for plug-in logic without Dataverse (plug-ins profile). Integration
tests against a development or test environment, never production: data created by the test
is **marked** (a `[TEST]` prefix in the primary name, or a test business unit), limited to the
record scope the owner approved, and deleted by the same run, also when the test fails. UI
tests per security role with Playwright (or EasyRepro for existing suites) against test, with
a test user per role. Load tests only in a dedicated sandbox (see Operations).

## Release flow

| Step | How |
| --- | --- |
| 1. Owner's go for this release; What's new entries in every language | framework `release` skill |
| 2. `VERSION` bumped; development's solution versions set (`Export-Solution.ps1 -SetVersion`), exported, committed | git |
| 3. Gate green on the commit; tag `v<VERSION>` | `gh run watch`, `git tag`, push (ask) |
| 4. Managed solutions from the **build environment**: pack from source, import unmanaged, export managed, `release.json` with versions and import order, GitHub release | `release.yml` job `build-managed` |
| 5. Manual backup of the target before the import (admin center or `pac admin backup`) | owner checklist |
| 6. Test: import in order with `deployment-settings/test.json` | `release.yml` `deploy-test` (or `Import-Solution.ps1 -Environment test -BuildManifest release/release.json`) |
| 7. Smoke test test: sign in per role, main journeys, flows on, no failed system jobs | checklist in STATE.md |
| 8. Production: approval on the GitHub environment `production` (the owner's go), import with `prod.json` | `deploy-prod` (or `Import-Solution.ps1 -Environment prod ... -ProductionGo`) |
| 9. Smoke test production read-only; check failed system jobs, plug-in trace log, flow runs | runbook |
| 10. Tag What's new, record the live version per environment in STATE.md | framework `release` skill |

- **Version per solution**: `major.minor.patch.build`; `VERSION` holds the first three by
  hand, CI stamps the build number. A plug-in assembly's identity is its major.minor: bump
  minor only when a new registration is intended (plug-ins profile).
- **Upgrade vs update**: an already installed managed solution is imported with
  **stage-and-upgrade** (single step): components the new version no longer contains are
  removed. A plain import over it is an *update* and leaves removed components behind.
  `Import-Solution.ps1` picks upgrade when the solution is installed and refuses a same or
  lower version.
- **Import order**: lower layers first (`importOrder` in `schema.json`, carried into
  `release.json`); one import at a time per environment (a second one is refused while the
  first runs).
- **Import options** (Microsoft's performance guidance): stage-and-upgrade, activate plug-ins
  and flows, no publish-all for managed solutions, no "overwrite unmanaged customisations",
  never "import as managed" (convert-to-managed).
- **Connection references** are validated at import: the connection must belong to (or be
  shared with) the owner of the reference. Create connections in each environment under a
  service account first, put their ids in the settings file; flows stay off until then.
- **Configuration data** (settings rows, queues, templates, reference data) does not travel in
  a solution: see Data migration.

## Multiple customers

The product has one source and one release; customers differ by **configuration and
layers, not by forks**.

1. **Configuration first**: environment variables, a settings table read at runtime, feature
   switches per module (a module a customer does not buy is a solution it does not import, or
   a switch that hides it), per-customer deployment settings and environments files
   (`customers/<name>/environments.json`, `customers/<name>/deployment-settings/`), and
   configuration data loaded per customer.
2. **Extensions as layers**: what only one customer needs goes in a separate solution on top
   of the managed product, ideally under the customer's (or a partner's) publisher, in a
   separate repository that consumes the product's released managed solutions. The product
   never depends on it.
3. **Generic abilities instead of customer code**: when a customer needs something the
   product cannot do, build the generic ability in the product (an extension point, a
   configurable field type, a declared extension file the scripts read) and use it from the
   customer layer. If a customer's name appears in a product script, stop.
4. **If a fork is unavoidable** (a customer branch with its own catalogue, demo, brand): a
   long-lived branch that **merges main in regularly and is never merged back**; customer work
   only **adds** (an extension folder declaring tables, navigation, role privileges and labels
   that the generic scripts read), never edits product files; a scheduled CI job merges main
   into each customer branch and runs the gate, so drift shows the week it happens; customer
   names are on the vocabulary checker's avoid list for main.
5. **Releases per customer**: the same managed artifacts for everyone; each customer
   environment is a deployment target with its own settings, approvals and record of which
   version is live. Never build a release in an environment that holds a customer's
   extension.

## Data migration

- **Configuration data** (reference data, settings, templates, queues): versioned in git as a
  Configuration Migration schema and data (`pac data export/import`, Windows; or the
  Configuration Migration tool), or as JSON loaded by an idempotent script. Define a
  uniqueness condition per table so a re-run updates instead of duplicating; match on names or
  alternate keys, never on GUIDs from another environment; load in dependency order. Some
  things are provisioned per environment and cannot be moved (phone numbers, channel
  accounts, external subscriptions): list them in the runbook and set them by hand.
- **Business data** from a legacy system: an idempotent load that **upserts by alternate key**
  (the source id kept in a column), so it can run again after a fix; dry run with counts
  first; reconciliation after (counts per table, totals, a sample compared field by field);
  delta runs until cut-over. Set ownership and state after insert; `overriddencreatedon` keeps
  the original creation date.
- **Service protection limits** (per user, per web server, five-minute sliding window): 6,000
  requests, 20 minutes of combined execution time, 52 concurrent requests. On 429 wait the
  `Retry-After` the server sends (`Invoke-Dataverse` does); start with a few parallel requests
  and increase until the server pushes back; prefer many small parallel requests to big
  batches (start batches at 10). Requests from plug-ins are not counted, but plug-ins and flows
  fire on every migrated row: decide per table whether to switch them off for the load, and
  what to run afterwards instead. Plan the window from a trial run, not a guess.
- **Capacity**: check database, file and log capacity before a load (and before restoring a
  backup: a restore needs 1 GB free).
- **Test data** is marked, limited to the approved scope and removed afterwards; real
  personal data never goes into development or test without anonymisation.

## Operations readiness

Planned with the product, not after it (framework: [docs/operations.md](../../docs/operations.md)):

- **Monitoring**: failed system jobs (asynchronous plug-ins, workflows, bulk deletes), plug-in
  trace log (on in development and test; in production only while investigating), flow run
  failures with alerts to an owner mailbox, Dataverse and app telemetry exported to
  Application Insights (a managed environments feature) in the same region, capacity and API
  usage reports in the admin center. A runbook row per alert.
- **Backups**: system backups are kept 7 days, up to 28 for production managed environments;
  take a manual backup before every production import. Restores go to a sandbox; a **restore
  drill** (restore production to a sandbox, smoke test, anonymise or delete) at go-live and at
  least twice a year, with the time it took.
- **Capacity**: database, file and log (audit) per environment; alert before the limit;
  retention and bulk delete jobs keep growth in check.
- **Performance and load**: forms with few columns and tabs loaded on demand, views with
  indexed filters, no synchronous plug-ins doing remote calls; a load test of the busiest
  journeys in a dedicated sandbox with production-like data volume, never production, with
  the owner's go per run (side services: the k6 setup of the
  [dotnet-react-azure profile](../dotnet-react-azure/load/README.md)).
- **Support and upgrades**: Microsoft's release waves update the platform twice a year; run
  the regression suite in an early-access sandbox before each wave.

## Safety rules

These are in `CLAUDE.dataverse.md` and every brief, on top of the framework's
[safety rules](../../docs/safety-rules.md):

- **Confirm the environment URL and the account before every pac or API call.** The scripts
  show both and ask; writes need the host name typed back (CI: `-ConfirmUrl` with the exact
  URL). Every pac call passes `--environment`; nothing relies on a "current" environment.
- **Never import into production without the owner's go** for that release (`-ProductionGo`
  locally after the owner said so; the GitHub environment approval in CI).
- **Production is read-only when debugging**: read, report, propose. Fixes go through
  development and a release.
- **Schema and roles change in development only**; test and production take managed
  solutions; unmanaged customisations are blocked there.
- **Test data**: approved record scope, marked, cleaned up by the run that made it.
- **Never switch the owner's az or pac account** without asking; restore it afterwards.
- **No secrets** in git, settings files, `environments.json` or logs; CI uses federated
  credentials; secret environment variables point at Key Vault.
- Scripts refuse the placeholder tenant: a freshly scaffolded repository cannot reach anything.

## CI that really runs green

- `pr.yml` needs no secrets and no environment: contract tests (including script parsing,
  translations and the privacy register) and pack-from-source with the round-trip check run
  on a plain Ubuntu runner with pac pinned (`Microsoft.PowerApps.CLI.Tool` 2.11.2 as a .NET
  10 tool). The **checker** job runs only when the repository variable
  `DATAVERSE_CHECKER_CLIENT_ID` exists, so a new repository is green on its first push.
- `release.yml` runs on a version tag and stays inert (skipped jobs) until its repository
  variables exist. It signs in with **federated credentials** (`pac auth create
  --githubFederated`): an app registration per stage, a federated credential for the
  repository's GitHub environment, an application user with a least-privilege role in that
  Dataverse environment. No client secrets anywhere.
- Actions are pinned to full commit SHAs; GitHub environments `test` and `production` carry
  the protection rules (required reviewers on production).

## Gotchas learned the hard way

From building large Dataverse products; each is handled in the scripts or the rules above.

- **Metadata just created is not readable for seconds**, and the metadata cache lags further:
  a create right after reads "not unique", a lookup reads "not found in the metadata cache".
  Poll, wait, and treat "already exists" as present; make every step idempotent.
- **A request that timed out may still have completed.** Never retry a write blindly; check by
  reading, then create what is missing. Run the script again rather than retrying inside it.
- **Another import or publish running** refuses customisation requests: wait, do not fail.
- **New options never reach an existing choice** when a script skips existing components:
  insert missing options (`InsertOptionValue`).
- **Updating a two-option column's labels with UpdateAttribute reports success and changes
  nothing**; `UpdateOptionValue` works.
- **A table has one parental relationship.** Set the cascade explicitly on every lookup
  (RemoveLink for delete and archive): a newer environment defaulted Archive to Cascade and the
  second lookup was refused there, never in development.
- **The primary name column stays required** whatever you send.
- **A required Yes/No step in a business process flow treats No as not filled in.**
- **A table must be a component of the model-driven app**, added by its logical name and
  metadata id, or everyone (administrators too) sees "You do not have permission to access
  these records". Every publish gives the app a new version id; count components on the
  current one.
- **An unpublished app is invisible to the Web API**, and creating apps through the API was
  refused; create them with the designer or pac, publish, then find them by unique-name prefix.
- **Find apps, views, charts and forms by unique name or base-language label**, not by display
  name: the display name follows the user's language, and the mismatch creates duplicates.
- **An environment whose base language differs from the labels' language** needs that language
  enabled before the schema can be created; enabling it through the API hung, the admin center
  took ten minutes. Check it before installing.
- **After any schema change, run the roles script**: a new table has no privileges, and
  nobody but an administrator sees it. Read every page of the privilege list.
- **Sandbox limits for plug-ins** (two minutes per execution; about eight hops of one
  asynchronous chain before it is cancelled as a loop; assembly cached for about two minutes
  after an upload): the plug-ins profile has the details.
- **A managed release cannot be imported where the solution is unmanaged** (an environment
  installed from scripts): decide per environment once, and keep test and production managed.
- **The build environment must hold the product only**: anything else in it ships.
- **Another product's publisher with the same name but another prefix** in a customer
  environment blocks the install; allow the publisher's unique name to be overridden per
  environment while the prefix stays (the scripts refuse a prefix mismatch).
- **Configuration data is not in the solution** and some of it is provisioned per environment;
  writing configuration through the API that Microsoft only documents for the Configuration
  Migration tool can break with a product update: detect the version and fail loudly.
- **pac solution list offers no JSON output** in pac 2.11.2 (newer docs mention `--json`);
  `Import-Solution.ps1` reads its text table, and that parsing is not yet proven against a
  real environment.
- **Two pac installs on one machine** (the .NET tool and the MSI or VS Code extension) are
  normal, and PowerShell and a shell may pick different ones. The Windows (.NET Framework)
  build fails on paths over 260 characters, and `pac solution pack` then printed `Error:` and
  **exited 0**. `Invoke-Pac` treats an `Error:` line as a failure, and `Build-Solution.ps1`
  stages in a short temporary folder. Keep repositories at short paths on Windows.
- **Labels over 500 characters fail the translation import**; sitemap titles are not in the
  translation export at all.
- **A first import after enabling a language is slower**; plan the window.

## Related guidance

- [docs/integrations-dynamics.md](../../docs/integrations-dynamics.md): connecting a SaaS to a
  customer's Dataverse (sign-in model, Web API patterns, service protection).
- [docs/contracts.md](../../docs/contracts.md), [docs/languages.md](../../docs/languages.md),
  [docs/release-flow.md](../../docs/release-flow.md), [docs/testing.md](../../docs/testing.md).

## Sources (Microsoft Learn, checked 17 October 2026)

- ALM: [overview](https://learn.microsoft.com/power-platform/alm/), [environment strategy](https://learn.microsoft.com/power-platform/alm/environment-strategy-alm), [organize solutions](https://learn.microsoft.com/power-platform/alm/organize-solutions), [solution layers](https://learn.microsoft.com/power-platform/alm/solution-layers-alm), [table segmentation](https://learn.microsoft.com/power-platform/alm/segmented-solutions-alm), [import performance](https://learn.microsoft.com/power-platform/alm/performance-recommendations), [deployment settings](https://learn.microsoft.com/power-platform/alm/conn-ref-env-variables-build-tools), [multiple languages](https://learn.microsoft.com/power-platform/alm/create-solutions-support-multiple-languages)
- pac CLI: [pac solution](https://learn.microsoft.com/power-platform/developer/cli/reference/solution), [pac data](https://learn.microsoft.com/power-platform/developer/cli/reference/data), [install as .NET tool](https://learn.microsoft.com/power-platform/developer/howto/install-cli-net-tool); GitHub: [actions](https://learn.microsoft.com/power-platform/alm/devops-github-available-actions), [federated credentials](https://learn.microsoft.com/power-platform/alm/tutorials/github-actions-oidc-fic)
- Governance: [solution checker enforcement](https://learn.microsoft.com/power-platform/admin/managed-environment-solution-checker), [pipelines and managed environments](https://learn.microsoft.com/power-platform/alm/admin-deployment-hub), [Key Vault secrets in environment variables](https://learn.microsoft.com/power-apps/maker/data-platform/environmentvariables-azure-key-vault-secrets)
- Data: [service protection limits](https://learn.microsoft.com/power-apps/developer/data-platform/api-limits), [Configuration Migration](https://learn.microsoft.com/power-platform/admin/manage-configuration-data), [auditing](https://learn.microsoft.com/power-platform/admin/manage-dataverse-auditing), [backup and restore](https://learn.microsoft.com/power-platform/admin/backup-restore-environments), [translations](https://learn.microsoft.com/power-apps/developer/data-platform/customize-labels-support-multiple-languages), [Copilot data movement across regions](https://learn.microsoft.com/power-platform/admin/geographical-availability-copilot), [accessible web resources](https://learn.microsoft.com/power-apps/developer/model-driven-apps/create-accessible-web-resources)

## What was validated, and what was not

Validated locally (17 October 2026, pac 2.11.2, PowerShell 7.6, Node 26): the sample solution
packs with `pac solution pack` and unpacks back to identical files; `Build-Solution.ps1
-RoundTrip` passes and catches a stray file and a hand-edited element; `pac solution
create-settings` on the packed sample gives the environment variable and connection reference
the settings files hold; `npm test` in the scaffold passes 24 tests (schema, roles, privacy,
environments and settings, script parsing, translations, privacy register, the pack round trip
(skipped with a note where pac is missing), the placeholder refusal); `Test-Translations.ps1`
finds a removed Dutch label; every script parses; `New-Schema.ps1` and `New-SecurityRoles.ps1`
print their offline plans; `actionlint` passes both workflows. `scaffold.ps1` produced
`-Name Fabrikam -Prefix fab -Languages en,nl,de`, `-Name Gemeentezaken -Prefix gz -Languages nl`
(Dutch base, Dutch only) and `-Name Northwind -Prefix nw -Languages fr-BE,en-GB` (English
fallback reported): in each, no sample name is left, `npm test` (24), `Build-Solution.ps1
-RoundTrip` and `Test-Translations.ps1` pass; it refuses a non-empty destination, an unknown
language and an invalid prefix.

Not validated: anything against an environment (Web API calls of New-Schema and
New-SecurityRoles, Export-Solution, Import-Solution including its reading of `pac solution
list`, the solution checker, `pac auth create --githubFederated`), the import of the
hand-made sample solution into a real environment, the GitHub Actions runs themselves
(actionlint only), and the shape of the checker's SARIF severity property (the script falls
back to the SARIF level).
