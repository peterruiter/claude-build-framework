---
name: quality-gate
description: Run the full quality gate and report every step with numbers - tests, release build with the pinned toolchain, front-end builds, vocabulary/translation checker for every configured language, contract tests (changelog, languages, plurals, light/dark theme contrast), accessibility (axe in light and dark at 390/1440), screenshots, privacy and data-residency checks, What's new, and CI green. Profile-aware. Use before reporting work as done, before a release, or when the user says "run the gate", "run all checks", "is it green", "verify".
argument-hint: "[--release] [scope]"
---

# Quality gate

Reference: `${CLAUDE_PLUGIN_ROOT}/docs/quality-gate.md`.

## 0. Know the commands

- Read CLAUDE.md for the project's gate commands and profile. If a profile is used, read its
  README in `${CLAUDE_PLUGIN_ROOT}/profiles/<profile>/` for the exact build/test commands and the
  pinned toolchain (`dotnet-react-azure`, `dataverse-solution`, `power-platform-pcf`,
  `dataverse-plugins`; a project may use several, run every one's gate).
- For a release (`--release`), run everything in the clean release worktree, not the shared tree.
- Check the tools first: `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-prereqs.mjs" <profile>`. A
  required tool missing or too old fails the gate before any step runs; report the install
  commands it prints.

## 1. Run, in order, and record numbers

| # | Step | Command (stack-neutral part) |
| --- | --- | --- |
| 1 | Tests (unit, database on a scratch DB, node) | profile |
| 2 | Release build with the image's exact toolchain (temporary pin, removed afterwards) | profile |
| 3 | Front-end type check and production builds | profile |
| 4 | Vocabulary | `node scripts/check-vocabulary.mjs` |
| 5 | Contracts | `node --test "tests/contracts/*.test.mjs"` |
| 6 | Stand-ins | `node --test "tests/standins/*.test.mjs"` |
| 7 | Accessibility (UI changed) | `node tests/a11y/axe-pages.mjs --probes` against a local run (light/dark, 390/1440) |
| 8 | Screenshots (UI changed) | languages × 390/1440 × light/dark; look at them |
| 9 | Privacy | the checklist in `${CLAUDE_PLUGIN_ROOT}/docs/privacy-and-sovereignty.md` for each new feature; erasure covers new tables |
| 10 | Data residency | no new service/endpoint outside the configured region without a recorded owner decision |
| 11 | What's new | an entry per user-visible change, every configured language, `release: null` |
| 12 | CI (after the lead pushes) | `gh run watch <id> --exit-status`; on red `gh run view <id> --log-failed`, fix, push, watch |

Run independent steps in parallel where safe (background Bash). Never weaken a check to pass.

## 2. On failure

- Fix at the root (flaky test: find the ordering/precision/clock cause; don't add retries).
- If the shared tree is broken by someone else's work in progress, run in a clean copy
  (`git archive HEAD | tar -x -C <scratch>` plus your files) and say so.
- A step that cannot run (no local database, no browser): report **not run, with the reason**.

## 3. Report

| Step | Result |
| --- | --- |
| Tests | 412 passed, 0 failed |
| … | … |

End with: green / not green, and what is unverified.
