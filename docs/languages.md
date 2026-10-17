# Languages, plurals and vocabulary

## Choose the languages at the start

The set of languages is **a project decision, asked at the start** (`new-project` skill): which
languages, and which is the **source language** (the one strings are written in first; usually
English). Everything else reads the configured list in `build/contracts/locales.json`: the
checker, the changelog test, the translate and What's new skills, screenshots. Nothing hard-codes
a count. (A product for a European audience might ship ten or more languages, a local tool just
one. There is no default set.)

Adding a language later is a normal piece of work: add it to `locales.json`, then the checker
lists every missing bundle and string, and the `translate` skill fills them.

## `locales.json`

```json
{
  "contract": "locales",
  "source": "en",
  "default": "en",
  "locales": [
    { "code": "de", "englishName": "German", "nativeName": "Deutsch", "culture": "de-DE" },
    { "code": "en", "englishName": "English", "nativeName": "English", "culture": "en-GB" },
    { "code": "nl", "englishName": "Dutch", "nativeName": "Nederlands", "culture": "nl-NL" }
  ],
  "namespaces": [ { "id": "ui", "description": "Every string in the app." } ]
}
```

- **Order**: every language list in the product shows this order: **alphabetical by each
  language's own name, accents ignored** (Dansk, Deutsch, English, Español, …). Nobody re-sorts.
- `default` is the fallback; it is **not** "the first entry".
- `culture` drives plural rules, number and date formatting.
- A catalogue of common languages to pick from: [`templates/languages-catalog.json`](../templates/languages-catalog.json).

## Strings

- Bundles per **surface** and language (`ui.en.json`, `ui.nl.json`, `email.nl.json`, …); keys in
  code, never sentences.
- Placeholders `{0}`, `{name}` and markup (`<b>…</b>`) must match the source language exactly.
- **Accessible names are strings too** (aria-labels, alt texts, "Close"): translate them.
- Name things the way the screens do, in each language.

## Plurals (CLDR)

A counted string has a key per **CLDR plural category** its language needs besides `other`:

| Language | Needs | Example |
| --- | --- | --- |
| English, Dutch, German, Swedish… | `key.one` | 1 ticket / 2 tickets |
| Polish | `key.one`, `key.few`, `key.many` | 1 bilet / 2 bilety / 5 biletów |
| French | `key.one` (0 and 1 are "one") | 0 billet |
| Arabic | `zero`, `one`, `two`, `few`, `many` | |

The key itself is `other` and the fallback. The categories are **data-driven**: the checker asks
`Intl.PluralRules(culture)` which categories whole numbers 0–200 fall into for each configured
language. No language list is hard-coded.

- Web: [`templates/project/src/i18n/plural.ts`](../templates/project/src/i18n/plural.ts)
  (`countedText`, `countIn`, `neededCategories`) with `Intl.PluralRules` on the **culture**
  (pt-PT is not pt-BR). A count already formatted for the reader ("1 234") still counts.
- Server: if the server language has no plural API, write the rules out as a table **for the
  configured languages** and test it against `Intl.PluralRules` (the profile shows how).
- The checker holds every counted key to its language's categories, and flags English strings like
  `{0} orders` without `.one` ("1 orders"). Strings whose count is **never 1** (minimums, fixed
  durations) go in `neverOne` in `build/framework.json` **with the reason**; the list is checked
  so stale entries come off.

## One vocabulary per language (glossary)

`build/contracts/glossary.json` fixes product terms per language and lists variants to avoid:

```json
{ "terms": [ { "id": "workspace",
  "text": { "en": "workspace", "nl": "werkruimte", "de": "Arbeitsbereich" },
  "avoid": { "nl": ["werkplek"], "de": ["Workspace"] } } ] }
```

The checker fails on an avoided variant in any string (bundles and changelog). With
`"expect": true` on a term, a translation must also contain the term (or its `stem`) whenever the
source string contains it. Translate against the glossary; add a term the moment two translations
disagree. Form of address (du/Sie, tu/vous, tú/usted) is a glossary decision too: write it in
the term list's `notes`.

## The checker

`node scripts/check-vocabulary.mjs` (template: [`templates/project/scripts/check-vocabulary.mjs`](../templates/project/scripts/check-vocabulary.mjs)),
configured by `build/framework.json`. It checks:

1. `locales.json`: unique codes, valid cultures, source and default present, endonym order.
2. Every namespace exists in every language; no missing or extra keys; same value types,
   placeholders and markup as the source language.
3. Not too many strings identical to the source (default 10 %; allow-list for brand names).
4. Plural forms per CLDR category for every counted key; `{0} <plural noun>` without `.one`.
5. Glossary: avoided variants; expected terms.
6. Optional: every key used in code (`t('key')`) exists in the source bundle.
7. Changelog areas have a display string, when configured.

## Translating

- The agent that adds a string adds it in **every configured language** in the same change.
- Sweeps (a new language, a reworded feature) go to translator agents per language group, merged
  **key by key**, re-reading the bundle before every write.
- After a sweep: unify terms against the glossary (sweeps by several agents drift: "two words for
  one thing").
