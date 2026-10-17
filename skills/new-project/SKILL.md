---
name: new-project
description: Start a new project with the build framework in the current folder or repository. Asks the owner for the languages (and source language), data residency, stack profile and GitHub repository visibility/description, then scaffolds CLAUDE.md, STATE.md, ROADMAP.md (with the Operations readiness wave), build/contracts (languages, glossary, changelog), the vocabulary checker, release script, contract and stand-in tests, light/dark tokens, accessibility and load-test templates, creates the GitHub repo with gh, pushes and watches CI until green. Use when the user says "new project", "start a project", "scaffold", "set up the framework here" or "bootstrap".
argument-hint: "[project name]"
---

# New project

Scaffold a project that follows the build framework. Method: `${CLAUDE_PLUGIN_ROOT}/docs/README.md`.
Templates: `${CLAUDE_PLUGIN_ROOT}/templates/project/` (index: `${CLAUDE_PLUGIN_ROOT}/templates/README.md`).

## 1. Look before you write

- Is this folder empty, an existing repo, or an existing project? `git status`, list files. If
  CLAUDE.md, STATE.md or `build/contracts/` exist, **merge** (add what is missing), never overwrite.
- Check tools: `git --version`, `gh auth status`, `node --version` (22.18+). Report what is missing
  and stop if `gh` is not signed in (the owner runs `gh auth login`).

## 2. Ask the owner (one message, multiple choice, recommendation first)

Ask with the AskUserQuestion tool if available, otherwise as a numbered list:

1. **Project name and one-line description** (the description goes on GitHub too).
2. **Languages**: which languages, and which is the **source language** (strings written first).
   Offer the `common: true` set from `${CLAUDE_PLUGIN_ROOT}/templates/languages-catalog.json` as a
   *starting point*, plus "only one language" and "other (name them)". There is no default set.
   For Portuguese/English/Chinese ask which variant (culture). Note RTL languages need RTL layout.
3. **Data residency**: EU (recommended default), a specific country, or none. This sets the
   regions for hosting, database, storage, backups, logs, vault and AI endpoints.
4. **Profile**: list the folders in `${CLAUDE_PLUGIN_ROOT}/profiles/` (read each README's first
   lines), plus "none (stack-neutral)".
5. **GitHub repository**: name (default: folder name), **private (recommended) or public**,
   topics (suggest 3–5).

Do not continue until these are answered. Record the answers.

## 3. Scaffold

Copy from `${CLAUDE_PLUGIN_ROOT}/templates/project/` into the project root:

| Template | Target |
| --- | --- |
| `CLAUDE.md`, `STATE.md`, `ROADMAP.md` | same; fill every `{{…}}` placeholder (dates as today) |
| `gitignore.template` | `.gitignore` (merge with an existing one) |
| `package.json` | `package.json` (merge scripts if one exists; keep `"type": "module"` or rename scripts to `.mjs`) |
| `github/workflows/ci.yml` | `.github/workflows/ci.yml`, unless the profile supplies its CI (then make sure the profile's CI also runs the checker and contract tests) |
| `githooks/commit-msg` | `.githooks/commit-msg`, then `git config core.hooksPath .githooks` and `git update-index --chmod=+x .githooks/commit-msg` after the first `git add` (refuses commit messages with AI attribution) |
| `build/`, `scripts/`, `tests/`, `src/` | same paths, then adjust `build/framework.json` to where the app really keeps strings, styles and i18n |

Then:

- **Write `build/contracts/locales.json`** from the answers: `source`, `default` (= source unless
  told otherwise), and one entry per language (code, englishName, nativeName, culture from the
  catalogue), **sorted by nativeName with `new Intl.Collator('en', {sensitivity:'base'})`**.
- **Create string bundles** for every configured language and namespace (`src/strings/ui.<code>.json`),
  translating the sample strings; counted keys get every CLDR form each language needs
  (`pluralForms` in the catalogue).
- **Glossary**: keep the example term only if it fits; add the product's key terms per language and
  the form of address (`notes`).
- **What's new areas**: ask or propose 3–5 areas for `changelog.json`; leave `entries` empty.
- Add the data residency to CLAUDE.md, STATE.md (data flows) and ROADMAP.md (Decisions).
- **Profile**: if chosen, follow that profile's README to add its scaffold (build, database,
  infrastructure, CI, gate commands), and put its gate and run commands into CLAUDE.md
  (`{{GATE_COMMANDS}}`, `{{PROFILE_COMMANDS}}`). Do not copy anything the profile marks optional
  without asking.
- Remove sample files the project does not need (e.g. `dataverse.mjs` if there is no Dataverse).

## 4. Check locally

```
node scripts/check-vocabulary.mjs
node --test "tests/contracts/*.test.mjs"
node --test "tests/standins/*.test.mjs"
```

All must pass before the first commit. Fix, do not skip.

## 5. GitHub and CI (standing rule: every project on GitHub with green CI)

```
git init -b main            # if not a repo yet
git add -A && git commit -m "Project set up with languages, contracts and checks"
gh repo create <name> --private --source . --description "<one line>" --push   # or --public if chosen
gh repo edit --add-topic <t1> --add-topic <t2> ...
gh run list --limit 1
gh run watch <run-id> --exit-status
```

- **No AI attribution** in the commit message or anywhere else (remove any `Co-Authored-By` or
  "Generated with" line a tool adds).
- Creating the repository and pushing is outward-facing: the owner's answers in step 2 are the go
  for this repository only.
- If the run is red: `gh run view <id> --log-failed`, fix, commit, push, watch again, until green.
  Never leave a red or never-run workflow.

## 6. Report

A short report: what was created (tree of top-level files), the languages (in picker order) and
source, data residency, profile, the repo URL and visibility, CI run URL and result, and next
steps: "tell me what to build first, then `/build-framework:plan-wave`". Mention that the
Operations readiness wave is in ROADMAP.md for before the first real users.
