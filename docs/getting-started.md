# Getting started

This guide is for developers who get access to this repository and want to use the framework in
Claude Code. You do not need to know the way of working yet; the walkthrough shows it.

**What you get**: a Claude Code plugin (`build-framework`) with skills (step-by-step playbooks
Claude follows), subagents (specialists the lead session starts in parallel), templates and
docs. Claude acts as the **lead**: it plans work in waves, starts agents in the background, runs a
quality gate and releases only with your go. You are the **owner**: you decide and approve.

## 1. Prerequisites

| Tool | Why | Check |
| --- | --- | --- |
| Claude Code (recent; tested with 2.1.233) | Runs the plugin | `claude --version` |
| git | Marketplace is a git repo; every project is one | `git --version` |
| GitHub CLI `gh`, signed in | Private repo access, repo creation, CI runs | `gh auth status` |
| Node.js 22.18 or later | Checkers, contract tests, stand-ins, release scripts | `node --version` |

Per profile, for example [`profiles/dotnet-react-azure/`](../profiles/dotnet-react-azure/):

| Tool | Check |
| --- | --- |
| .NET SDK (the version the profile pins) | `dotnet --list-sdks` |
| Azure CLI | `az version` |
| PowerShell 7 | `pwsh --version` |

Optional: Playwright and axe-core for screenshots and accessibility runs (installed per project,
pinned; the a11y template says how), k6 for load tests.

You don't have to check these by hand: `/build-framework:check-tools <profile>` (or, without
Claude, `node scripts/check-prereqs.mjs <profile>` in a clone of this repo) checks every tool the
framework and the profile need against its minimum version, and prints the exact install command
for your OS for anything missing. `new-project` and `quality-gate` run it first and stop when a
required tool is missing. Each profile's list is its `prerequisites.json`.

## 2. Get access to the private repository

1. The repository owner invites you as a **collaborator** on GitHub
   (`github.com/peterruiter/claude-build-framework` → Settings → Collaborators).
2. Accept the invitation (email, or github.com/notifications).
3. Make sure **git on your machine can fetch the repo without prompting**. Claude Code runs `git`
   with interactive prompts turned off and has no token of its own; it uses whatever credentials
   your machine already holds:
   - **HTTPS (simplest)**: `gh auth login`, then `gh auth setup-git`. This stores a credential
     git can use silently.
   - **SSH**: a key loaded in `ssh-agent` (no passphrase prompt) and `github.com` in
     `known_hosts`. With `owner/repo` shorthand Claude Code tries SSH first and falls back to
     HTTPS. If you have **no** GitHub SSH key, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` in your
     environment so installs and updates from inside a session use HTTPS.
   - A `GITHUB_TOKEN` in the environment alone is **not** enough; it works through a credential
     helper such as `gh`'s.
4. Test: `git ls-remote https://github.com/peterruiter/claude-build-framework.git` must list refs
   without asking anything.

(Source: Claude Code docs, "Host and maintain a marketplace → Grant access to a private
marketplace", https://code.claude.com/docs/en/plugins/host-marketplace.)

## 3. Install

In a Claude Code session:

```
/plugin marketplace add peterruiter/claude-build-framework
/plugin install build-framework@pruiter-plugins
```

Or from your shell:

```
claude plugin marketplace add peterruiter/claude-build-framework
claude plugin install build-framework@pruiter-plugins
```

`pruiter-plugins` is the marketplace's name (from `.claude-plugin/marketplace.json`), not the
repository name. Restart Claude Code (or run `/reload-plugins`), then check:

```
claude plugin list            # build-framework@pruiter-plugins  ✔ enabled
claude plugin details build-framework
```

**From a local clone** (handy if you change the framework itself):

```
git clone https://github.com/peterruiter/claude-build-framework.git
claude plugin marketplace add ./claude-build-framework
claude plugin install build-framework@pruiter-plugins
```

A marketplace added from a local path loads the files in place: your edits apply at the next
session start or after `/reload-plugins`, without a version bump.

## 4. Update and uninstall

```
/plugin marketplace update pruiter-plugins          # fetch the latest catalogue
claude plugin update build-framework@pruiter-plugins   # then restart Claude Code
```

You only receive a new copy when the plugin's `version` changes (see [CHANGELOG.md](../CHANGELOG.md)).
To update automatically: `/plugin` → Marketplaces → `pruiter-plugins` → Enable auto-update.

Uninstall:

```
claude plugin uninstall build-framework@pruiter-plugins
claude plugin marketplace remove pruiter-plugins    # also uninstalls its plugins
```

## 5. A 10-minute walkthrough: a new project

Make an empty folder, open Claude Code in it, and run:

```
/build-framework:new-project
```

(Or just say "start a new project with the build framework".) Claude asks a few questions, as
multiple choice with a recommendation first:

1. **Languages**: which languages the product supports and which one strings are written in
   first (the source language). A common set is offered as a starting point; pick what you need,
   even just one. This becomes `build/contracts/locales.json`; everything else reads it.
2. **Data residency**: where personal data may live (EU by default, a country, or none). It sets
   the regions for hosting, database, storage, backups, logs, vault and AI endpoints.
3. **Profile**: the stack (for example `dotnet-react-azure`) or "none" for stack-neutral only.
4. **Design system**: the look of everything the project makes, from
   [`design-systems/`](../design-systems/README.md): your account's org default design system when
   there is one, otherwise `neutral` ([design-systems.md](design-systems.md)).
5. **GitHub repository**: name, private (default) or public, a one-line description, topics.

Claude then scaffolds `CLAUDE.md`, `STATE.md`, `ROADMAP.md`, the contracts, the checker and
tests, runs them, creates the GitHub repository (`gh repo create … --private --description …`),
pushes, adds the profile's CI workflow and **watches the first run until it is green**. You get a
short report with what was created and the CI run's link.

## 6. Plan a first wave

Tell Claude what you want, in plain words, as a list ("people can sign up; an admin page lists
sign-ups; emails in every language"). Then:

```
/build-framework:plan-wave
```

Claude turns the list into a wave of 3–6 independent items, each with an **agent brief**
(scope, reserved migration number, own scratch database and ports, file-ownership rules, checks,
report format), shows you the plan and asks for your go. On your go it starts the agents in the
background and sends a short status update every few minutes (`/build-framework:status-update`
sets that up).

## 7. Quality gate and release

```
/build-framework:quality-gate     # tests, builds, vocabulary, contracts, a11y, with numbers
/build-framework:whats-new        # add or check What's new entries in every language
/build-framework:release          # the release flow; asks for your go at every outward step
```

The release skill commits only the relevant files, releases from a clean worktree, watches CI,
asks before running production migrations or switching cloud accounts (and switches back
afterwards), deploys with the profile's scripts, smoke-tests, tags What's new and updates
STATE.md.

## 8. Customising

- **Your project's `CLAUDE.md`** holds the standing rules. Edit it freely: project rules override
  the framework's defaults (for example the status-update interval, the release version format,
  the areas for What's new).
- **`build/framework.json`** configures the checker (string folders, glossary, `neverOne`
  exceptions, release pattern).
- **`tests/a11y/pages.json`**, **`tests/load/`**: your pages and journeys.
- Want a different flow altogether? Copy a skill into your project's `.claude/skills/` and change
  it; project skills sit beside plugin skills.

## 9. Standing rules you will notice

- Claude asks before anything outward-facing (deploy, publish, push, delete, spend, switch
  account), every time.
- Secrets are never written to files or chat; put them in your vault/secret store.
- **No AI attribution anywhere**: no `Co-Authored-By` lines naming an assistant, no "Generated
  with …" in commits or pull requests, no AI credits in docs or listings.
- Every user-visible change gets a What's new entry in every configured language.
- Status is honest: "against the stand-in only" is said out loud.

## 10. FAQ and troubleshooting

**`/plugin marketplace add` fails with an authentication or "could not read Username" error.**
git cannot fetch silently. Run `gh auth login` and `gh auth setup-git`, or set
`CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` if you have no SSH key, then retry. Test with `git ls-remote`.

**`Plugin "build-framework" not found in marketplace`.** Use the marketplace name after the `@`:
`build-framework@pruiter-plugins`. Run `/plugin marketplace update pruiter-plugins`.

**I don't see the skills.** Restart Claude Code or run `/reload-plugins`; check
`claude plugin list` shows it enabled. Plugin skills are prefixed: `/build-framework:…`.

**An update doesn't arrive.** The plugin updates when its `version` changes. Run
`/plugin marketplace update pruiter-plugins`, then `claude plugin update
build-framework@pruiter-plugins`, then restart.

**The checker fails on a language I just added.** That is the point: it lists every missing
bundle and string. Run `/build-framework:translate`.

**CI is red after `new-project`.** Claude should already be fixing it (`gh run view --log-failed`).
If you stopped it, ask "make CI green".

**Can I use it without a profile?** Yes. You get the method, the contracts, the checker, the
templates and the stack-neutral skills; you fill in your own build and deploy commands in
`CLAUDE.md`.
