---
name: whats-new
description: Add, check or tag What's new (changelog) entries in build/contracts/changelog.json - one plain sentence per user-visible change in every configured language, next free id, valid area, release null until released, then tagged with the release version via scripts/release-tag.mjs. Use when finishing a feature or release, or when the user says "what's new", "changelog", "release notes", "tag the entries".
argument-hint: "[add|check|tag <version>]"
---

# What's new

Reference: `${CLAUDE_PLUGIN_ROOT}/docs/whats-new.md`. Standing rule: every release adds its
user-visible changes, in every configured language.

## Add an entry

1. **Re-read** `build/contracts/changelog.json` and `build/contracts/locales.json` right now
   (other agents add entries too). Next id = highest id + 1, never reused.
2. Write the sentence in the source language first: what the user can now do or will notice, as
   the screens name it. No internal names, ticket/migration numbers, jargon, or AI credits.
3. Translate into **every configured language** (from `locales.json`, never an assumed list),
   using `build/contracts/glossary.json` terms and the form of address in its `notes`. One
   sentence each, ending with punctuation.
4. Insert at the **top** of `entries` (newest first) with a small targeted edit:
   `{ "id": N, "date": "<today yyyy-MM-dd>", "release": null, "area": "<one of areas>", "text": { … } }`.
5. Run `node --test "tests/contracts/*.test.mjs"` and `node scripts/check-vocabulary.mjs`.

## Check before a release

- List entries with `release: null`. Compare with what is in the release (agent reports, commits
  since the last release). Add missing entries; merge duplicates; drop entries for changes not in
  this release (keep them null).

## Tag at release

```
node scripts/release-tag.mjs --release <version> --untagged --date today
node scripts/release-tag.mjs --release <version> --from <id> --to <id>   # a range
```
`--dry-run` first if unsure. Then run the contract tests and commit with STATE.md (release skill).
