---
name: polish-round
description: Run a polish round after a feature wave - collect issues from screenshots (languages x 390/1440 x light/dark), video recordings (console errors, failed requests, broken images per step), accessibility runs, demo walkthroughs and the owner's "small thing, but..." feedback into one list, assign them with file ownership, fix with the smallest change, and verify with before/after screenshots. Use when the user says "polish", "small things", "clean up the UI", "fix what the videos show", or after a wave finishes.
argument-hint: "[source of issues]"
---

# Polish round

Reference: `${CLAUDE_PLUGIN_ROOT}/docs/polish-rounds.md`.

## 1. Collect

- **Owner feedback**: quote each point.
- **Screenshots**: run the matrix for the pages the last wave touched (source, longest and
  plural-heavy configured languages; 390 and 1440; light and dark). Look at every image: untranslated
  text, overflow at 390, dark-mode contrast, cut-off buttons, empty states, confusing labels.
- **Video recordings** (`${CLAUDE_PLUGIN_ROOT}/tools/video-tour/`): the recorder's per-step list of
  console errors, failed requests and broken images.
- **Accessibility**: `node tests/a11y/axe-pages.mjs --probes` findings.
- **Demo walkthrough**: data that contradicts itself, fake-looking ids, numbers that don't add up.

## 2. List

One table: `# | Where | What | Evidence | Fix | Owner | Done`. Group by area. Ask the owner only
about items that change behaviour or wording users already know.

## 3. Assign and fix

- One or two `build-framework:polish-reviewer` (or feature-builder) agents, each owning distinct
  components (no two agents on one file).
- Each fix: smallest change that solves it; a test for logic bugs; text fixes in **every configured
  language** against the glossary; demo data changes bump the SeedVersion.
- **Never weaken a real rule to make the demo look right**; make the demo coherent.

## 4. Verify and record

- Before/after screenshots for visual fixes; the gate (`/build-framework:quality-gate`).
- One What's new entry if users would notice.
- STATE.md: a short "Polish round <letter>" section with the list and what is left.
