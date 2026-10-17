---
name: release
description: Release the current work to production with the owner's approvals - commit only relevant files (no AI attribution), push, release from a clean git worktree, pinned-toolchain build, CI green, production migrations as a person's identity (asking before switching the cloud account and restoring it in a finally block), infrastructure via the profile's deploy script, publish, health poll, smoke test, log check, tag What's new entries, update STATE.md, clean up. Use when the user says "release", "deploy", "ship it", "go live", "push to production".
argument-hint: "[version]"
disable-model-invocation: true
---

# Release

Reference: `${CLAUDE_PLUGIN_ROOT}/docs/release-flow.md`. Stack commands: the profile in CLAUDE.md
(`${CLAUDE_PLUGIN_ROOT}/profiles/<profile>/`).

## 0. Go and scope

- Confirm the owner's go **for this release** (a standing go in CLAUDE.md counts only if it says
  so). Each outward step below that is marked **ASK** needs its own yes unless the owner said
  "go for all of it".
- Decide the version (`$ARGUMENTS` or ask). List what goes in: finished agent reports, What's new
  entries with `release: null`.
- Every user-visible change has a What's new entry in every configured language
  (`/build-framework:whats-new` if not).

## 1. Commit and push

- `git status`; stage **only** the files of finished work. Other agents' work in progress stays out.
- Plain message. **No AI attribution**: no `Co-Authored-By` naming an assistant, no "Generated
  with" line, even if a tool adds it by default.
- **ASK** before pushing (if not covered). `git push`.

## 2. Clean worktree and gate

```
git worktree add --detach ../<repo>-release HEAD
```
Run `/build-framework:quality-gate --release` in the worktree (pinned toolchain, release build with
a scratch output path, tests without it, web checks with `node_modules` linked from the main tree,
remove the link and the pin afterwards). Watch CI for the pushed commit: `gh run watch <id>
--exit-status`. **Stop on red.**

## 3. Production database migrations (if any)

- Run as a **person's identity**, never the app's.
- If the cloud CLI's current account/subscription is not this project's: **ASK every time** before
  switching. Then:
  ```
  try { switch to the project's account; run migrations } finally { switch back to the original }
  ```
  (PowerShell `try/finally`, bash `trap`). Record the original account first; confirm it is
  restored at the end.

## 4. Infrastructure, publish, verify

- **ASK**, then infrastructure changes through the profile's deploy script (it keeps settings and
  secrets it does not know).
- **ASK**, then publish the image/package with the profile's script; poll the new revision until
  healthy and serving traffic.
- Smoke test (profile's script): liveness, readiness, main pages, unknown id → 404, API asks for
  sign-in.
- Log check on the new revision: errors and warnings in the last 15 minutes.

## 5. Record

```
node scripts/release-tag.mjs --release <version> --untagged --date today
```
(or `--from/--to`). Update the "Live" line in STATE.md (new version first, previous after it).
Commit **only** STATE.md and the changelog, plain message, no AI attribution; push (covered by the
release go). Watch that CI run too.

## 6. Clean up and report

- `git worktree remove ../<repo>-release`. Confirm the cloud account is back to the original.
- Report in a few lines: version, what is in it, checks with numbers, migrations applied, CI run,
  smoke/log results, anything unverified, anything the owner must do.
