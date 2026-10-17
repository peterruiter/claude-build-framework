# Contracts

A **contract** is a JSON file in `build/contracts/` that is the single source of truth for
something several surfaces share. A test fails when code and contract disagree. Contracts are how
parallel agents stay consistent without talking to each other.

## Typical contracts

| File | Holds | Enforced by |
| --- | --- | --- |
| `locales.json` | The configured languages: code, English name, own name (endonym), culture, the source language and the fallback; in picker order | `tests/contracts/locales.test.mjs`, `scripts/check-vocabulary.mjs` |
| `changelog.json` | What's new entries, every language, area, release | `tests/contracts/changelog.test.mjs` (+ `changelog.schema.json` for editors) |
| `glossary.json` | One vocabulary per language: product terms and variants to avoid | `scripts/check-vocabulary.mjs` |
| `modules.json` (example) | Feature modules: owned tabs, views, emails, setup steps, names in every language | A project test that reads the code's tab tables and the registry |
| `developer-api.json` (example) | API scopes and error codes | A test that compares with the routes and the OpenAPI description |
| `videos.json` (example) | The video catalogue | See [videos.md](videos.md) |

The first three come with the framework (`templates/project/build/contracts/`). Add others when
two or more places must agree on a list.

## How to write one

1. Top-level `contract` (name), `version`, `description` (the rules, in plain words: who adds
   entries, when, which fields mean what).
2. The data, as flat and boring as possible. Ids that are stored somewhere are **never reused**.
3. A test that loads the contract and checks both directions: everything in code is in the
   contract, everything in the contract exists in code.
4. Optional: a JSON Schema next to it (`<name>.schema.json`) for editor autocomplete.
5. Embed or copy the contract into the build when the running app needs it (do not hand-copy
   values into code).

## Good contract tests

- Every API operation is documented, with examples complete enough for a low-code connector.
- Every scope and error code the code uses is in the registry, and none in the registry is unused.
- Every module's owned tabs exist in the UI's tab table.
- Every changelog entry has every configured language and a valid area.
- A failing test says **what to do**: "add `tab.reports` to ui.en.json" beats "assertion failed".
