---
name: translate
description: Add or fix user-facing strings in every configured language (from build/contracts/locales.json) with the CLDR plural forms each language needs, placeholders and markup intact, against the glossary, until scripts/check-vocabulary.mjs passes. Also adds a new language to the project or runs a translation sweep with translator agents per language group. Use when strings were added, the checker reports missing strings, the user asks to "translate", "add a language", "fix translations" or "plural forms".
argument-hint: "[keys, namespace, or a language code to add]"
---

# Translate

Reference: `${CLAUDE_PLUGIN_ROOT}/docs/languages.md`.

## Read first

- `build/contracts/locales.json`: the configured languages (codes, cultures, source). Never assume
  a count or a list.
- `build/framework.json`: where the bundles are (`strings`), `neverOne`, `identicalAllowed`.
- `build/contracts/glossary.json`: terms per language, variants to avoid, form of address (`notes`).
- Plural categories per language: run
  `node -e "for (const c of process.argv.slice(1)) { const r=new Intl.PluralRules(c), s=new Set(); for (let i=0;i<=200;i++) s.add(r.select(i)); s.delete('other'); console.log(c, [...s]) }" <cultures…>`.

## Add strings

1. Add the key in the **source** bundle first. A count before a plural noun ("{0} items") gets
   `key.one` (and the source language's other needed forms); the key itself is `other`.
2. Add the key in **every** other configured language's bundle, with a small targeted edit,
   re-reading the file right before writing. Counted keys: one form per needed category
   (`key.one`, `key.few`, `key.many`, …).
3. Keep placeholders (`{0}`, `{name}`) and markup (`<b>…</b>`) exactly; use glossary terms; match
   how the screens name things; translate accessible names too.
4. A count that is never 1 (minimums, fixed durations): don't add `.one`; list
   `"<ns>:<key>": "<reason>"` in `neverOne` instead.
5. Run `node scripts/check-vocabulary.mjs` until it reports no problems.

## Add a language

1. Pick it from `${CLAUDE_PLUGIN_ROOT}/templates/languages-catalog.json` (confirm the culture
   with the owner: pt-PT or pt-BR, etc.). Add to `locales.json` **in endonym order** (the
   locales test checks it). Add glossary terms for it.
2. Run the checker: it lists every missing bundle and string.
3. Translate every namespace (sweep below for large bundles), the changelog entries, and any
   documentation the project translates.
4. Checker, contract tests, screenshots in the new language (long words, RTL if applicable).
5. One What's new entry announcing the language (in every language).

## Sweep (many strings or a new language)

- Split by namespace and language group; start `build-framework:translator` agents in the
  background, each with: the keys, the glossary, the form of address, "merge key by key, re-read
  before every write, never reformat", and the checker as its gate.
- Afterwards, unify terms across the sweep against the glossary (parallel translators drift),
  add new glossary terms where two translations disagreed, and run the checker once more.
