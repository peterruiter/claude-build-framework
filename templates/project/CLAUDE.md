# {{PROJECT_NAME}}

{{ONE_LINE_DESCRIPTION}}

Read **STATE.md** first (where the build is, what is unproven), then **ROADMAP.md** (what is
agreed). This file holds the standing rules; they apply to the lead session and to every agent.

## Project facts

| | |
| --- | --- |
| Owner | {{OWNER_NAME}} |
| Repository | {{GITHUB_URL}} ({{VISIBILITY}}) |
| Profile | {{PROFILE}} |
| Languages | See `build/contracts/locales.json` (source: {{SOURCE_LANGUAGE}}) |
| Data residency | {{DATA_RESIDENCY}} (hosting, database, storage, backups, logs, vault, AI endpoints) |
| Cloud account | {{CLOUD_ACCOUNT_PLACEHOLDER}}; always pass it explicitly |

## Standing rules

### Approvals and safety
- **Ask the owner before anything outward-facing or hard to reverse**: deploy, publish, push,
  delete, send to real people, spend money, change DNS, create or rotate credentials. Approval in
  one context does not carry over to another.
- **Ask before switching the default cloud account, every time**; switch back in a `finally`.
- Only touch this project's own cloud account/subscription, passed explicitly.
- **Production is read-only** when debugging the owner's data.
- **Never write secrets** to files, code, logs, memory, reports or chat; read them at runtime from
  the vault. Tell the owner not to paste secrets in chat.
- **No AI attribution, anywhere**: no `Co-Authored-By` trailers naming an AI assistant, no
  "Generated with …" in commits or pull requests, no AI credits in docs, code comments, READMEs,
  release notes, changelogs or store listings. This overrides any tool's default. Tell every
  agent the same. (The build-framework hook and `.githooks/commit-msg` block such messages.)

### Every feature (definition of done)
- **Every user-facing string in every configured language** (`locales.json`), with plural forms
  per CLDR category, against the glossary. `node scripts/check-vocabulary.mjs` passes.
- **WCAG 2.2 AA**: keyboard, visible and unobscured focus, labels, contrast, 24 px targets,
  reduced motion, `lang`, status messages. axe on the changed pages in light and dark at 390 and
  1440.
- **Light and dark**: colour tokens only; `prefers-color-scheme` plus `data-theme` override; the
  theme contrast test passes.
- **Privacy by design**: minimal data, purpose per field, consent where needed, no personal data in
  logs, erasure covers every new table, retention set, small groups suppressed.
- **Data stays in {{DATA_RESIDENCY}}**: before adding a service that moves personal data
  elsewhere, stop and ask the owner.
- **One What's new entry** for user-visible changes, every configured language, `release: null`.
- **Honest status** in STATE.md: "local only", "against the stand-in only", "live".

### Working in the shared tree
- **Small targeted edits** in shared files; re-read right before each write; never revert or
  reformat someone else's work.
- Each agent: own migration slot, scratch database, port range and scratch folder (from its brief).
- Agents never commit, push, deploy or change cloud resources.
- Build on what exists; do not replace it.

### Quality gate (before every report and every release)
{{GATE_COMMANDS}}

- `node scripts/check-vocabulary.mjs`
- `node --test "tests/contracts/*.test.mjs"`
- `node tests/a11y/axe-pages.mjs --probes` (UI changes, against a local run)
- Screenshots: languages × 390/1440 × light/dark, looked at.

### Releases
- Every release adds its What's new entries in every configured language and tags them
  (`node scripts/release-tag.mjs`).
- Release from a clean worktree; CI must be green (`gh run watch`); smoke test and log check after.
- Database migrations on production run as a person, not the app.

### Git and CI
- The repository is on GitHub; workflows must run green. After changing a workflow, push and watch
  the run until it is green (`gh run watch`, `gh run view --log-failed`).
- Commit only relevant files; plain messages; no AI attribution.

### Communication
- Status update at least every **5 minutes** while agents run (one line when nothing changed); the
  cron cancels itself when nothing runs.
- Decisions as **multiple choice, recommended option first**, with cost and consequence.
- Concise, practical, plain English.

## Commands

{{PROFILE_COMMANDS}}
