# The quality gate

Every agent runs the gate before reporting. The lead runs it again, on a clean copy, before every
release. Report each step **with numbers**. A step that cannot run is reported as **not run, with
the reason**, never as passed.

## Steps (stack-neutral)

| # | Step | Passes when |
| --- | --- | --- |
| 1 | Full test suite: unit, database tests on a local scratch database, node tests | 0 failures, count reported |
| 2 | Release build with the **exact toolchain** the production image uses | Clean (warnings as errors) |
| 3 | Front-end: type check and production builds of every app | Clean |
| 4 | Vocabulary and translations: `node scripts/check-vocabulary.mjs` | "no problems", every configured language |
| 5 | Contract tests: `node --test "tests/contracts/*.test.mjs"` (changelog, languages, plurals, **theme contrast in light and dark**) | All pass |
| 5b | **Design system** check: `design-system.mjs check <id>` from the plugin, for the project's system ([design-systems.md](design-systems.md)) | No problems; known exceptions and findings reported as they are |
| 6 | **Accessibility** (every UI change): `node tests/a11y/axe-pages.mjs --probes` on the changed pages, light and dark, 390 and 1440 | 0 violations outside `known.json` |
| 7 | **Screenshots matrix** (every UI change): languages × 390/1440 × **light/dark**, looked at | Fixes made for what they show |
| 8 | **Privacy checklist** for the feature ([privacy-and-sovereignty.md](privacy-and-sovereignty.md)) | Every item answered; erasure covers new tables |
| 9 | **Data residency**: no new service or endpoint that moves personal data outside the chosen region without the owner's decision | Nothing new, or decision recorded |
| 10 | What's new entry for user-visible changes, every configured language | Present, `release: null` |
| 11 | CI workflow green on the pushed commit (lead only, after pushing) | `gh run watch` ends green |

The profile fills in the exact commands for steps 1–3. For the .NET/React/Azure profile see
[`profiles/dotnet-react-azure/`](../profiles/dotnet-react-azure/).

## Definition of done for a feature

- Works, with tests (including concurrency where "once" or "last" matters).
- Every string in every configured language, plural forms, glossary terms.
- **Accessible (WCAG 2.2 AA)**: keyboard, visible and unobscured focus, labels, contrast, 24 px
  targets, reduced motion, `lang`, status messages ([accessibility.md](accessibility.md)).
- **Light and dark** both right, tokens only ([design-systems.md](design-systems.md)).
- **Privacy by design** answered; erasure covers it; no personal data in logs.
- **Data stays in the chosen region**, or the owner decided otherwise.
- What's new entry; short STATE.md section with honest status.

## Lessons that are now rules

- **Pin the toolchain to the image's version** for the release build. A newer local SDK can have
  different analyzers; the image treats warnings as errors. Use a temporary pin (for .NET a
  temporary `global.json`) and remove it afterwards.
- **Some tests locate the repo from the build output**: run them without a custom output path.
- **Fix flaky tests at the root.** Typical causes: comparing timestamps at a different precision
  than stored, using the app clock instead of the database clock, a static field that remembers
  one request's host.
- **Concurrency bugs need a concurrency test.** Example: insert-if-not-exists under concurrent
  requests deadlocked; fixed with an update lock on the existence check (SQL Server:
  `WITH (UPDLOCK, HOLDLOCK)`), and a test that runs the requests in parallel.
