# Profile: Dataverse plug-ins

A starting point for **server-side business logic in Microsoft Dataverse** (Dynamics 365, Power Apps):
C# plug-ins and custom APIs on .NET Framework 4.6.2, shipped as a **plug-in package**, registered from a
**manifest kept in the repository**, tested without an environment, and released as part of a managed
solution. It brings the framework's habits to plug-ins: a quality gate that fails on what the solution
checker would flag, messages users read in every configured language, traces that say why and never who,
CI that really runs, and nothing touching an environment without the owner's go.

The stack-neutral method lives in the framework's [docs](../../docs/README.md) and skills. For a product
that *calls* Dataverse from outside (sign-in, Web API, sync), see
[integrations-dynamics.md](../../docs/integrations-dynamics.md); this profile is about code that runs
*inside* Dataverse.

## What is in it

| Path | What | Becomes, in the repository |
| --- | --- | --- |
| `scaffold/` | A working solution named `Contoso.Sample` with prefix `contoso` | the repository root |
| `scaffold.ps1` | Copies the scaffold, renames it, sets the languages | (not copied) |
| `prerequisites.json` | The tools this profile needs, for the framework's prerequisite check | (not copied) |

```
Contoso.Sample.slnx  Directory.Build.props  Directory.Packages.props  global.json  VERSION  .editorconfig  .gitignore
.github/workflows/plugins.yml      Windows: build, test, package, manifest offline; Linux: the plug-in builds
build/contracts/registration.json  every step, image and custom API, as data
build/Register-Plugins.ps1         makes an environment match the manifest; dry run unless -Apply
build/Set-Version.ps1              bumps VERSION (major.minor.patch)
src/Contoso.Sample.Plugins/        net462 class library, packed as a NuGet plug-in package
  PluginBase.cs  LocalPluginContext.cs (ILocalPluginContext)  Messages.cs
  Contacts/ValidateContactEmail.cs     PreOperation, synchronous: validation with a localised refusal
  Contacts/SetAccountPrimaryContact.cs PostOperation, asynchronous: idempotent follow-up write
  Apis/NormalizeEmailApi.cs            the main operation of custom API contoso_NormalizeEmail
  Domain/EmailAddress.cs               pure logic, no Dataverse types
  Strings/languages.json  messages.<code>.json   texts users read, one bundle per language, embedded
tests/Contoso.Sample.Plugins.Tests/  net48, xUnit, own fakes (no FakeXrmEasy)
  Fakes/ (execution context, organization service, tracing, PluginRun)  PluginTests  MessagesTests
  RegistrationManifestTests (manifest contract + checker rules)  CodeRulesTests (best practices as tests)
```

Pinned: .NET SDK 10.0.100 (latest feature band), Microsoft.CrmSdk.CoreAssemblies 9.0.2.60,
Microsoft.NETFramework.ReferenceAssemblies 1.0.3, xUnit 2.9.3, C# 12, analyzers at `10.0-recommended`.

## Decisions, and why

| Decision | Why |
| --- | --- |
| **Plug-in package** (NuGet, "dependent assemblies") from the start | Microsoft recommends it from day one because adding it later is hard. It carries dependent assemblies and resources; ILMerge/ILRepack is **not supported** by Microsoft. Limits: no custom workflow activities, no on-premises, no unmanaged code. |
| **No strong name** | Assemblies in a plug-in package need no signing (`pac plugin init --skip-signing` is Microsoft's advice for packages). If you sign one assembly, every assembly it depends on must be signed too. So: no `.snk`, nothing to keep secret, `*.snk` ignored. Only a *classic* assembly registration (needed for custom workflow activities) needs a strong name: then generate a key once, commit it (a strong name is an identity, not a security measure) and set `SignAssembly`/`AssemblyOriginatorKeyFile` in the plug-in project. |
| **Own pack target, plain `dotnet pack`** | The `pac plugin init` template packs with the Power Apps MSBuild package, which needs Visual Studio's targets path and sends build telemetry. The scaffold's 10-line target does the same job (dependencies into `lib/net462`, the sandbox SDK left out) with only the SDK, on any OS. |
| **Registration as code** | Steps clicked together in the Plugin Registration Tool drift between environments and cannot be reviewed. `registration.json` is reviewed in pull requests, tested against the assembly and the checker rules, and applied by a script that shows a plan first. |
| **Own fakes, no FakeXrmEasy** | FakeXrmEasy v2 and later are RPL-1.5 (publish your source), a non-commercial licence, or a paid commercial licence; business-internal use counts as commercial. v1 (`FakeXrmEasy.9`, MIT) is frozen at 1.58.1 (2022). The fakes here are ~250 lines, strict where best practice is (they refuse all-columns reads) and need no licence decision. Choose FakeXrmEasy v2+ only with a licence the owner has agreed. |
| **Tests on .NET Framework 4.8, Windows** | The plug-in runs on .NET Framework in the sandbox; testing on the same runtime avoids surprises. CI runs them on `windows-latest`; Linux builds the plug-in (reference assemblies from NuGet) but cannot run .NET Framework tests. |

## Prerequisites

Check first; the checker says what is missing and how to install it on this OS:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/check-prereqs.mjs dataverse-plugins
```

| Tool | Needed for |
| --- | --- |
| .NET SDK 10.0.100 or newer (10.0 band) | build and tests; the .NET Framework 4.6.2 reference assemblies come from NuGet, no targeting pack |
| .NET Framework 4.8 runtime (Windows; part of Windows 10/11) | running the tests locally |
| PowerShell 7.4+ | `scaffold.ps1`, `build/*.ps1` |
| git, Node.js 22.18+ | the repository; the framework's checker and contract tests |
| Azure CLI (optional) | the token for `Register-Plugins.ps1` against an environment |
| Power Platform CLI `pac` (optional) | solution export/unpack/version at release, `pac plugin push`, `pac tool prt`. Any OS: `dotnet tool install --global Microsoft.PowerApps.CLI.Tool`; Windows also MSI or the VS Code extension |
| Plugin Registration Tool (optional, Windows) | looking at registrations, profiling, trace logs: `pac tool prt` |

An environment for development: a Dataverse **developer or sandbox environment** of the owner's, with a
publisher (prefix) and an unmanaged solution to develop in. Never production.

## How Claude uses this profile

| The task | Do |
| --- | --- |
| Start | `node ${CLAUDE_PLUGIN_ROOT}/scripts/check-prereqs.mjs dataverse-plugins`, then `./profiles/dataverse-plugins/scaffold.ps1 -Name <Name> -Prefix <prefix> -Languages en,nl -Destination <repo>` (prefix = the publisher's; ask the owner) |
| Add a plug-in | A class deriving from `PluginBase` with a `(string unsecure, string secure)` constructor; its steps in `registration.json`; tests with `PluginRun`. The manifest tests fail until both exist. |
| Add a custom API | A `PluginBase` class for the main operation; the API, parameters and response properties in `customApis`; tests that set inputs and read outputs |
| Add a message users read | A key in every `Strings/messages.<code>.json` (same `{placeholders}`), thrown with `context.Refuse("key", values)` |
| Add a language | `Strings/messages.<code>.json` (every key) and the code in `Strings/languages.json`; then translate (`/build-framework:translate`) |
| Run the quality gate | `dotnet build -c Release` (0 warnings), `dotnet test -c Release`, `dotnet pack src/<Name>.Plugins -c Release --no-build -o out/package`, `pwsh build/Register-Plugins.ps1 -Offline`, plus the framework's checker and contract tests |
| See what an environment would get | `pwsh build/Register-Plugins.ps1 -EnvironmentUrl https://<org>.crm4.dynamics.com` (reads only) |
| Register in a dev environment | Only after the owner's explicit go for that environment, with the account confirmed (see [Deployment](#deployment-to-a-development-environment)) |
| Release | The [release flow](#release-flow) below |

Rules that hold in every brief:

- **Never** register, import, delete or change anything in an environment without the owner's explicit go for
  that environment in this conversation. The dry run is the default; show its plan with the go request.
- **Never switch** the Azure CLI or `pac` account or profile. Show the signed-in account; if it is the wrong
  one, stop and ask the owner to sign in as the right person.
- **Never** put a secret in the repository, the manifest, unsecure configuration, a trace line or chat.
- Every user-visible message in every configured language; every trace line free of personal data.
- A step not in `registration.json` does not exist: add it there, not in the Plugin Registration Tool.

Agent briefs name: the repository, the classes and manifest entries the agent owns (file ownership), the
gate commands above with the numbers to report, and "no environment access".

## Scaffold a project

```powershell
./profiles/dataverse-plugins/scaffold.ps1 -Name Northwind.Sales -Prefix nw -Languages en,nl,de -Destination C:\src\northwind
```

- `-Name` (PascalCase, dots allowed) replaces `Contoso.Sample` in namespaces, files and folders;
  `NorthwindSales` becomes the solution unique name.
- `-Prefix` is the Dataverse **publisher's customisation prefix** (2-8 lower-case letters/digits, not
  `mscrm`): it names the package (`nw_Northwind.Sales.Plugins`) and custom APIs (`nw_NormalizeEmail`), and must
  match the publisher of the solution the plug-ins ship in.
- `-Languages` decides the languages, per project. The profile ships English and Dutch; other languages start
  as a copy of the English text (the script says which) and must be translated before they go live.
  `-SourceLanguage` is `en` when listed, else the first.
- The destination may hold a project already (for example one `/build-framework:new-project` created): no file
  is overwritten (the script stops and names any clash), `.gitignore` is merged, `git init` only when needed.
  Keep the framework's `.github/workflows/ci.yml` next to `plugins.yml`, and add the strings folder to
  `build/framework.json` so the vocabulary checker covers the plug-in messages:
  `{ "name": "plugins", "folder": "src/<Name>.Plugins/Strings", "file": "messages.{code}.json" }`. The checker
  then holds every bundle to the glossary, the placeholders and the identical-text limit; the codes in
  `Strings/languages.json` must be the codes in `build/contracts/locales.json`.
- Replace the sample plug-ins, steps and custom API with the product's own before the first registration.

## The PluginBase pattern

Microsoft recommends a `PluginBase` with an `ILocalPluginContext` (the `pac plugin init` template); this
profile's version is written fresh and adds what the method needs:

- **Stateless.** The platform caches one instance per step and runs it on several threads. A plug-in has no
  fields except the read-only step configuration; nothing static changes. `CodeRulesTests` enforces both by
  reflection. The one allowed static: immutable data from the assembly itself (the message catalogue).
- **`ILocalPluginContext`** unwraps the services once per execution: `ExecutionContext`, `UserService` (the
  step's user: use this), `SystemService` (SYSTEM, past every role: only when the logic truly needs it),
  `TracingService`, `Logger` (Application Insights, may be null), `Target`, `TargetReference`,
  `PreImage(name)`, `PostImage(name)`, `Input<T>()`, `Output()`, `Trace()`, `Text()`, `Refuse()`.
- **Traces** start and end of every execution: class, assembly version, message, table, stage, mode, depth,
  correlation id, elapsed milliseconds. Never record data.
- **Errors**: see [Error handling](#error-handling-and-messages-in-every-language).

```csharp
public sealed class ValidateContactEmail : PluginBase
{
    public ValidateContactEmail(string? unsecureConfiguration, string? secureConfiguration)
        : base(unsecureConfiguration, secureConfiguration) { }

    protected override void ExecuteDataversePlugin(ILocalPluginContext context)
    {
        var target = context.Target;
        if (target is null || !target.Contains("emailaddress1")) return;
        if (EmailAddress.Check(target.GetAttributeValue<string>("emailaddress1"), out var tidy) != EmailCheck.Valid)
            throw context.Refuse("contact.email.invalid");
        target["emailaddress1"] = tidy; // PreOperation: saved with the operation, no extra Update
    }
}
```

Keep business rules in plain classes (`Domain/`) without Dataverse types: they get most of the tests.

## Registration as code

`build/contracts/registration.json` holds the solution and publisher prefix, the package, every **step**
(class, message, table, stage `PreValidation`/`PreOperation`/`PostOperation`, mode `Synchronous`/`Asynchronous`,
explicit `rank`, `filteringAttributes`, `images` with named columns, `unsecureConfiguration`, `asyncAutoDelete`,
`description`) and every **custom API** (binding, action or function, processing-step type, privilege, typed
request parameters and response properties).

`RegistrationManifestTests` holds it to the assembly and to the solution checker's registration rules, so a
mistake fails the build instead of a solution check weeks later:

| Check | Checker rule / platform rule |
| --- | --- |
| Every step names a public, concrete `IPlugin` with a `()` or `(string, string)` constructor; every plug-in class is registered | (registration would fail; dead code) |
| No two steps with the same class, message, table, stage and mode; unique names | `meta-remove-dup-reg` |
| Update steps list filtering attributes, never the primary key | `meta-avoid-reg-no-attribute` |
| Retrieve/RetrieveMultiple only with a written `retrieveReason`; never RetrieveMultiple of annotation | `meta-avoid-reg-retrieve`, `meta-avoid-retrievemultiple-annotation` |
| Asynchronous only PostOperation; rank set; a description | platform; "don't accept the default execution order" |
| Images only on messages that support them, named, with listed columns; no pre-image on Create, post-images only PostOperation and not on Delete | platform; "never all columns" |
| No secret-looking text in unsecure configuration; no secure configuration in the repository | secure configuration is not exported with solutions |
| Custom API names carry the prefix; parameter types valid and unique; a function returns something | platform |

`build/Register-Plugins.ps1` makes an environment match the manifest (Web API, `MSCRM.SolutionUniqueName` on
every create so components land in the development solution):

1. **Package**: created (`uniquename` = prefix + assembly, `version` 1.0.0) or its content replaced. A plug-in
   package's name and version cannot change after creation, and the version plays no part in upgrades, so the
   NuGet version stays `1.0.0` (`PluginPackageVersion`) while assembly versions follow `VERSION`.
2. **Types**: the platform registers the `IPlugin` classes it finds; the script creates any it did not.
3. **Steps**, matched by name: changed mode, rank, filtering attributes, configuration or description are
   updated; a changed class, message, table or stage is delete-and-create. Steps on the package's types that the
   manifest no longer lists are reported and deleted only with `-Prune`.
4. **Images**: a changed image is deleted and created again.
5. **Custom APIs**: created with parameters in one deep insert; plug-in, display name and description updated.
   Binding, function/action and parameter types cannot change in place: reported, never "fixed" by deleting the
   API (that breaks callers).

Modes: `-Offline` (no environment: what a first registration creates; CI runs it), `-EnvironmentUrl` alone
(reads and prints the plan), `-Apply` (does it, after the host is typed back or passed as
`-ConfirmEnvironment <host>`).

The Plugin Registration Tool stays useful for looking (profiler, trace logs). `pac plugin push --pluginId <id>
--pluginFile out/package/<Name>.Plugins.1.0.0.nupkg --type Nuget` is a quick way to update an existing package's
content in a dev environment; it does not register steps.

## Configuration and secrets

| Kind | Where | Never |
| --- | --- | --- |
| Behaviour switches, URLs, thresholds that are the same everywhere | `unsecureConfiguration` in the manifest (exported with the solution, readable by customisers) | secrets |
| Settings that differ per environment | Dataverse **environment variables** (in the solution; a value per environment through the deployment settings file at import), read with a query on `environmentvariabledefinition`/`environmentvariablevalue` | secrets in plain text variables |
| Secrets (API keys, client secrets) | **Azure Key Vault**, read from the plug-in with a **Power Platform managed identity** (`IManagedIdentityService.AcquireToken`, then the Key Vault REST API). Managed identity needs the package or assembly signed with a certificate (`nuget sign`/`signtool`) and a federated credential set up by an admin | in the repository, unsecure configuration, traces |
| Last resort for a secret | **Secure configuration** of the step, set per environment by an administrator (readable by administrators only, **not exported** with solutions) | in `registration.json` (the tests refuse it) |

Key Vault-backed *secret* environment variables are documented for flows and custom connectors, not for
plug-ins: do not build on reading them from plug-in code. Cache nothing secret in statics.

## Logging and tracing without personal data

- `ITracingService` writes to the plug-in trace log (when tracing is on in the environment): 10 KB per
  execution, kept 24 hours, shown in error details. Trace **what happened and why, never who**: ids, counts,
  decisions, exception types. No names, email addresses, phone numbers or free text from records. Dataverse
  fault messages can quote record values: `PluginBase` traces the fault code, not the message. The tests assert
  the address never reaches the trace.
- `ILogger` (`Microsoft.Xrm.Sdk.PluginTelemetry`, never `Microsoft.Extensions.Logging`) writes to the
  customer's own Application Insights when the environment exports to it, never to Microsoft; null when not
  enabled. Same rule: no personal data. The Application Insights resource must sit in the configured region.
- Users see a correlation id, not internals: support looks it up in the trace log or Application Insights.

## Error handling and messages in every language

- A refusal the user should read: `throw context.Refuse("key", values)`: an
  `InvalidPluginExecutionException` with the text from `Strings/messages.<lang>.json` in the language of the
  person who started the operation (their personal UI language, `usersettings.uilanguageid`, read only when a
  message is needed; exact culture, then language, then the source language).
- Anything else is caught by `PluginBase`: traced (type and member), logged, and replaced by the localised
  `error.unexpected` text with the correlation id. The original message and inner exception are not passed on.
- Refuse early: PreValidation stops before the transaction (first call only); PreOperation is where the record
  being saved can be changed. A refusal in PreOperation or PostOperation rolls the transaction back; keep them
  rare and caused by the user.
- One sentence, the user's words, what to do next. Same `{placeholders}` in every language (`MessagesTests`).
  Message keys are product vocabulary: the framework's glossary and checker apply.
- Bundles are embedded with `WithCulture="false"`, otherwise MSBuild turns `messages.nl.json` into a satellite
  assembly the code cannot find.

## Sandbox, pipeline and limits

- **Sandbox**: .NET Framework 4.6.2; **2 minutes** per execution (hard limit, the transaction rolls back);
  network only over HTTP/HTTPS to **DNS names** (no IP addresses, no localhost); no file system, registry or
  machine environment; anonymous or token authentication only; the platform may reuse or recycle the process at
  any time.
- **Size**: a plug-in assembly at most 16 MB (the script refuses a larger package); hundreds of `IPlugin`
  classes in one package make imports slow.
- **Stages**: PreValidation (10, outside the transaction on the first call, before security checks), PreOperation
  (20, inside: change the target here), main operation (30, custom APIs only), PostOperation (40, inside;
  asynchronous steps run after the transaction through the system job queue and can be retried: make them
  idempotent).
- **Depth**: each call a plug-in makes that triggers another raises `Depth`; at 8 within an hour the platform
  stops the chain as a loop. Do not use Depth for business logic (Microsoft's advice): prevent loops with
  filtering attributes, by writing only changed columns, and with shared variables
  (`ExecutionContext.SharedVariables`) to pass a fact from a pre to a post step of the same request.
- **Images** instead of retrieves for "what was it before"; only the columns the logic reads.

## Performance rules

- Filtering attributes on every Update step; no Retrieve/RetrieveMultiple steps without a strong reason.
- Name the columns in every retrieve and query (`new ColumnSet("a", "b")`), never all columns; the fake service
  refuses all-columns reads, `CodeRulesTests` refuses `ColumnSet(true)`.
- Write only the columns you change (unchanged values still fire plug-ins, flows and auditing).
- No `ExecuteMultipleRequest`/`ExecuteTransactionRequest`, no `Parallel`, `Task.Run`, threads or `Thread.Sleep`
  inside a plug-in (`CodeRulesTests`).
- Outbound HTTP: a timeout well under the limit (seconds, not the default 100), keep-alive off
  (`ConnectionClose = true`), a fresh `HttpClient` per execution or a static one with no per-request state;
  `CodeRulesTests` checks the first two whenever an HTTP client appears.
- Work that nobody waits for: asynchronous PostOperation, or hand it off (service endpoint/webhook to Azure
  Service Bus, Event Hubs or an Azure Function) instead of calling slow services synchronously.
- Synchronous steps: measure (the start/end trace has milliseconds); anything near a second is a design
  question.

## Privacy and data residency

- Plug-ins run inside the customer's environment, in its region: logic in a plug-in moves no data by itself.
  Every **outbound call** does: list each external host, what it receives and where it processes data, and get
  the owner's (and for a customer environment the customer's) decision before adding one. Prefer services in the
  configured region; the sandbox allows only named HTTPS hosts, which makes the list easy to review.
- Send the minimum: ids rather than records, no personal data in URLs or headers.
- Application Insights export goes to the customer's own resource: keep it in the configured region, and keep
  personal data out of what `ILogger` writes.
- Erasure: plug-ins that copy personal data into other tables (notes, logs, integration tables) create records
  an erasure request must cover; list them in the project's privacy notes.
- The Dataverse environment's own region is the customer's choice; record it in STATE.md.

## The quality gate

Every agent before reporting, and the lead before a release:

1. `dotnet build -c Release`: warnings are errors in Release, .NET analyzers on for .NET Framework at the pinned
   level (`10.0-recommended`), code style enforced in the build. Exceptions only in `.editorconfig`, each with
   its reason.
2. `dotnet test -c Release` (Windows): plug-in tests through the fakes, the registration manifest contract, the
   code rules (stateless, no threads, no batch requests, named columns, no file system, HTTP timeouts), and the
   message bundles (every key, same placeholders, every offered language embedded). The sample has 68 tests.
3. `dotnet pack src/<Name>.Plugins -c Release --no-build -o out/package`: the package holds the plug-in
   assembly and its dependent assemblies, never the Dataverse SDK.
4. `pwsh build/Register-Plugins.ps1 -Offline`: the manifest reads and the package is under 16 MB.
5. The framework's checker and contract tests (`node scripts/check-vocabulary.mjs`,
   `node --test "tests/contracts/*.test.mjs"`), and What's new entries for user-visible changes.
6. Before a release: the **solution checker** on the exported unmanaged solution (Power Apps > Solutions >
   Solution checker, or the `Microsoft.PowerApps.Checker.PowerShell` module): zero critical and high issues. The
   tests catch the registration rules early; the checker remains the authority.
7. CI green: `gh run watch <id> --exit-status`.

## Release flow

The owner's go comes first; approval for one environment does not carry over to another.

| Step | How |
| --- | --- |
| 1. Version | `pwsh build/Set-Version.ps1 -Bump patch` (or minor/major). AssemblyVersion = major.minor.0.0, FileVersion = major.minor.patch.(CI run number), InformationalVersion = VERSION. Raise the Dataverse solution version to match (`pac solution version` on the solution project, or in the solution's properties). |
| 2. What's new | One-sentence entries in every configured language for each user-visible change (`/build-framework:whats-new`): new refusals, changed behaviour, new APIs |
| 3. Gate | The quality gate above, in a clean copy of the commit |
| 4. Register in the development environment | `Register-Plugins.ps1 -EnvironmentUrl <dev> -Apply` with the owner's go (next section); smoke-test the steps there |
| 5. Package the solution | Export the development solution **managed** (`pac solution export --name <Solution> --managed --path out/<Solution>_managed.zip`) and unmanaged for source control (`pac solution unpack` into `solution/`, committed). The managed zip is the release artifact; the plug-in package, its steps, images and custom APIs travel inside it |
| 6. Solution checker | On the unmanaged solution; zero critical and high |
| 7. Import into test, then production | Managed import with the deployment settings file for environment variables (`pac solution import --path ... --settings-file ...`, or a Power Platform pipeline), each with the owner's go for that environment |
| 8. Tag What's new, record the release in STATE.md, commit, push | the framework's release script |

Secure configuration is never in the solution: an administrator sets it per environment after import.

## Deployment to a development environment

1. Dry run first, always: `pwsh build/Register-Plugins.ps1 -EnvironmentUrl https://<org>.crm4.dynamics.com
   [-Subscription <id>]`. It prints the environment, the **signed-in account** (from the Azure CLI's current
   account; it never switches) and the plan.
2. Show the owner the plan, the environment and the account, and ask for the go **for this environment**. Do not
   ask for or handle credentials: the owner signs in (`az login`) as the right person if needed.
3. With the go: run again with `-Apply -ConfirmEnvironment <host>`. Interactive runs ask for the host instead.
4. Turn plug-in trace logging on in the dev environment while testing (System Settings, Customization tab,
   "Enable logging to plug-in trace log": Exception or All); off again afterwards.
5. Smoke test: create and update a test record that triggers each step, call each custom API, read the trace log;
   use clearly marked test data and remove it afterwards.

Never against production from a laptop: production gets the managed solution through import or a pipeline.

## CI

`.github/workflows/plugins.yml` runs on pull requests, pushes to main and by hand, next to the framework's
`ci.yml`:

- **windows** (`windows-latest`): SDK from `global.json`, NuGet cache, restore, Release build (warnings are
  errors), tests on .NET Framework 4.8, `dotnet pack`, `Register-Plugins.ps1 -Offline`, every `.ps1` parses, the
  package kept as a 14-day artifact. `BUILD_NUMBER` = the run number goes into FileVersion.
- **linux** (`ubuntu-24.04`): the plug-in project builds and packs from the reference assemblies package,
  proving the build needs no Windows; tests stay on Windows.

Actions are pinned to full commit SHAs with the release in a comment. No secrets, no environment access, no
deployment: registration and imports are human-approved steps.

## Gotchas

- **`messages.nl.json` becomes a satellite assembly.** MSBuild reads the `.nl.` as a culture and moves the
  embedded resource into `nl/<Assembly>.resources.dll`; the catalogue then finds nothing. `WithCulture="false"`
  on the `EmbeddedResource` keeps it in the main assembly. Found by the scaffold's own message tests.
- **ImplicitUsings on net462 includes `System.Net.Http`**, which the project does not reference unless it calls
  out: off, with explicit usings.
- **No `record`, `init` or default interface members on net462** (they need runtime types). Plain classes,
  getter-only properties.
- **`string.Contains(string, StringComparison)` does not exist on .NET Framework**; use `IndexOf(...) >= 0`.
- **Don't depend on `System.Text.Json` in the plug-in without packing it**: the SDK package references it, but
  the sandbox's copy may be another version.
- **XML documentation in the package**: the scaffold turns it off for the plug-in project so the package holds
  assemblies only.
- **Plug-in package name and version are fixed after creation.** Keep the NuGet version at 1.0.0; versions live in
  the assembly.
- **Updating a package that drops a class used by a step is rejected.** Remove the step from the manifest and
  run with `-Prune` (after the go) before shipping the package without that class.
- **An image cannot be changed in place reliably**: the script deletes and recreates it.
- **Post-image on Create uses `Id`, not `Target`** as the message property name; the script maps it per message.
- **Secure configuration is not exported** with solutions: document per environment who sets it.
- **Classic assemblies: a new major.minor is a new assembly** in a solution upgrade, and its steps stay on the
  old one. Plug-in packages do not have this problem; `Set-Version.ps1` warns anyway.
- **`ILogger` from the wrong namespace is null**: use `Microsoft.Xrm.Sdk.PluginTelemetry`.
- **Analyzers off for .NET Framework by default**: `EnableNETAnalyzers` must be set, and the level pinned so a
  newer SDK does not add rules unannounced.
- **Do not fake success in tests with a lenient fake**: the fake organization service refuses all-columns reads
  and records every call so tests can assert "wrote only this column".

## Related guidance elsewhere in the framework

- [docs/integrations-dynamics.md](../../docs/integrations-dynamics.md): calling Dataverse from a product (sign-in,
  Web API, sync, consent).
- [docs/privacy-and-sovereignty.md](../../docs/privacy-and-sovereignty.md), [docs/languages.md](../../docs/languages.md),
  [docs/whats-new.md](../../docs/whats-new.md), [docs/release-flow.md](../../docs/release-flow.md),
  [docs/quality-gate.md](../../docs/quality-gate.md), [docs/safety-rules.md](../../docs/safety-rules.md).

## What was validated, and what was not

Validated locally (17 Oct 2026, Windows 11, SDK 10.0.303): the scaffold builds in Release with 0 warnings and
68 tests pass on .NET Framework 4.8; the compiler took every .NET Framework reference from the NuGet reference
assemblies package (the Linux path); `dotnet pack` puts the plug-in assembly in `lib/net462`, and a test
dependency (Newtonsoft.Json) went into the package beside it while the Dataverse SDK stayed out; products
generated with `scaffold.ps1 -Name Northwind.Sales -Prefix nw -Languages en,nl,de` (69 tests) and
`-Name Fabrikam -Prefix fab -Languages nl` (Dutch only, 67 tests) build, test, pack and pass
`Register-Plugins.ps1 -Offline`; the scaffold refuses to overwrite an existing project and merges `.gitignore`;
`Register-Plugins.ps1` ran its dry run, refusal without confirmation, apply, re-plan (no changes), update
(rank, images, a new response property), replace (stage change) and `-Prune` paths against a local stand-in of
the Web API tables it uses; `actionlint` passes the workflow; both scripts parse; the prerequisite patterns
match real tool output.

Not validated: anything against a real Dataverse environment (package upload, the platform registering plug-in
types from a package, step and image creation, custom API deep insert, `MSCRM.SolutionUniqueName` on each
create), the managed identity and Key Vault route, solution export/import and the solution checker run, the
GitHub Actions run itself (actionlint only, until a repository runs it; in particular the Linux job).

## Sources (Microsoft Learn)

- Write a plug-in (PluginBase, stateless, configuration): <https://learn.microsoft.com/power-apps/developer/data-platform/write-plug-in>
- Build and package (plug-in packages, signing, ILMerge, 16 MB, System.Text.Json): <https://learn.microsoft.com/power-apps/developer/data-platform/build-and-package>
- Plug-in packages with PAC CLI (`--skip-signing`, update rules): <https://learn.microsoft.com/power-platform/developer/howto/cli-create-package>
- `pac plugin`: <https://learn.microsoft.com/power-platform/developer/cli/reference/plugin>
- Register a plug-in (stages, images, secure configuration, assembly versioning): <https://learn.microsoft.com/power-apps/developer/data-platform/register-plug-in>
- Plug-in package table: <https://learn.microsoft.com/power-apps/developer/data-platform/reference/entities/pluginpackage>
- Create a custom API with code: <https://learn.microsoft.com/power-apps/developer/data-platform/create-custom-api-with-code>
- Best practices for plug-ins: <https://learn.microsoft.com/power-apps/developer/data-platform/best-practices/business-logic/>
- Solution checker rules: <https://learn.microsoft.com/power-apps/maker/data-platform/use-powerapps-checker>
- Access external web services (sandbox network rules): <https://learn.microsoft.com/power-apps/developer/data-platform/access-web-services>
- Timeouts and keep-alive for external calls: <https://learn.microsoft.com/power-apps/developer/data-platform/best-practices/business-logic/set-timeout-for-external-calls-from-plug-ins>
- Depth and loop detection: <https://learn.microsoft.com/dotnet/api/microsoft.xrm.sdk.iexecutioncontext.depth>
- ILogger and Application Insights: <https://learn.microsoft.com/power-apps/developer/data-platform/application-insights-ilogger>
- Power Platform managed identity for plug-ins: <https://learn.microsoft.com/power-platform/admin/set-up-managed-identity>
- Key Vault secrets in environment variables: <https://learn.microsoft.com/power-apps/maker/data-platform/environmentvariables-azure-key-vault-secrets>
- Install PAC CLI as a .NET tool: <https://learn.microsoft.com/power-platform/developer/howto/install-cli-net-tool>
- FakeXrmEasy licensing (v2 and later): <https://dynamicsvalue.github.io/fake-xrm-easy-docs/licensing/license/>
