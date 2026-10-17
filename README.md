# Build Framework for Claude Code

A Claude Code plugin for building a product the way it works best with Claude: one **lead**
session plans and integrates, **agents** build in parallel in waves, the **owner** decides and
approves. Every string in every configured language, accessible (WCAG 2.2 AA) and in light and
dark from day one, private by design, honest status docs, a quality gate before every report, and
releases only with the owner's go.

> **New here? Read [docs/getting-started.md](docs/getting-started.md)**: prerequisites, access to
> this private repository, installing, a 10-minute first project, and FAQ.

## Install

The repository is both a plugin marketplace (`pruiter-plugins`) and the plugin (`build-framework`).

```
/plugin marketplace add peterruiter/claude-build-framework
/plugin install build-framework@pruiter-plugins
```

From a local clone instead: `/plugin marketplace add ./claude-build-framework`. Private repository:
git on your machine must be able to fetch it without prompting (`gh auth login` and
`gh auth setup-git`); see [getting started](docs/getting-started.md#2-get-access-to-the-private-repository).

## Quick start

In an empty folder:

```
/build-framework:new-project
```

Claude asks for the **languages** (and the source language), the **data residency** (EU by
default), the **profile** (stack) and the **GitHub repository** (private by default), then
scaffolds CLAUDE.md, STATE.md, ROADMAP.md, contracts, checks and tests, creates the repository and
watches CI until it is green. Then tell it what to build and run `/build-framework:plan-wave`.

## What is in it

### Skills (`/build-framework:<name>`)

| Skill | What it does |
| --- | --- |
| `new-project` | Asks languages, residency, profile, repo; scaffolds the project; GitHub repo with green CI |
| `plan-wave` | Turns wishes into 3–6 parallel agent briefs with reserved slots and file ownership; starts them on your go |
| `agent-brief` | Writes one brief from the template |
| `quality-gate` | Runs every check with numbers (tests, builds, vocabulary, contracts, a11y, privacy, CI) |
| `release` | The release flow with owner approvals, clean worktree, production migrations, smoke test, What's new tags (manual only) |
| `whats-new` | Adds, checks and tags What's new entries in every configured language |
| `translate` | Strings in every configured language with CLDR plural forms and the glossary; adds a language |
| `polish-round` | Collects issues from screenshots, videos and feedback, and fixes them |
| `security-review` | The checklist as practised; findings H/M/L with tests |
| `privacy-review` | Privacy by design (GDPR) and data residency |
| `a11y-pass` | Full WCAG 2.2 AA pass with axe, probes, keyboard and manual checks |
| `video-tour` | Plans and scripts short feature videos for the pipeline in `tools/video-tour` |
| `write-docs` | STATE, ROADMAP, runbooks, audience-specific texts |
| `status-update` | Recurring status while agents run; stops by itself |
| `owner-checklist` | Steps only the owner can do, with exact click paths, no secrets |
| `ops-readiness` | Monitoring, alerts, backups, restore drill, shared rate limits, runbooks |
| `load-test` | k6 journeys, test data generator, local trial, real-run plan |
| `mobile-app` | Mobile apps around the web app ([docs](docs/mobile-apps.md)) |
| `dataverse-integration` | Dataverse / Dynamics 365 connection practices ([docs](docs/integrations-dynamics.md)) |

### Agents (started by the lead)

| Agent | Role |
| --- | --- |
| `feature-builder` | Builds one item from a brief, runs the gate, reports |
| `polish-reviewer` | Finds and fixes small issues from screenshots and feedback |
| `security-reviewer` | Read-only security and privacy review, findings H/M/L |
| `translator` | Translates into the configured languages, key by key |
| `a11y-auditor` | WCAG 2.2 AA audit, fixes when allowed |
| `release-checker` | Read-only verification before and after a release |

### Docs, templates, profiles, tools

- [docs/](docs/README.md): the method, one file per topic.
- [templates/](templates/README.md): stack-neutral project templates (contracts, checker, tests,
  stand-ins, a11y and load-test scripts) and document templates (brief, report, status update,
  owner checklist, runbook, load-test plan).
- [profiles/dotnet-react-azure/](profiles/dotnet-react-azure/): .NET + React + Azure scaffolding,
  build, deploy, infrastructure and load-test scenarios.
- [tools/video-tour/](tools/video-tour/README.md): the video pipeline (YAML scripts, Playwright
  recording, voice, subtitles, self-hosted library, YouTube publishing).
- [hooks/](hooks/hooks.json): a guard that blocks `git commit` and `gh pr create/edit` commands
  carrying AI attribution (see [safety rules](docs/safety-rules.md#attribution)).

## Standing rules (also in every project's CLAUDE.md)

Ask before anything outward-facing; never write secrets; production read-only when debugging;
ask before switching cloud accounts; every string in every configured language; WCAG 2.2 AA;
light and dark; privacy by design; data in the chosen region; What's new with every release;
honest status; GitHub with green CI; **no AI attribution anywhere**.

## Update

```
/plugin marketplace update pruiter-plugins
claude plugin update build-framework@pruiter-plugins
```

Restart Claude Code afterwards. Updates arrive when `version` in `.claude-plugin/plugin.json`
changes; see [CHANGELOG.md](CHANGELOG.md).

## Working on the framework

```
npm test                          # self-test: manifests, skills, agents, links, templates
claude plugin validate . --strict # marketplace; also .claude-plugin/plugin.json, skills, agents
```

Bump the version in `.claude-plugin/plugin.json`, add a CHANGELOG.md section, push, and watch CI.
