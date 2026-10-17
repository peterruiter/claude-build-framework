# Polish rounds

After a feature wave, a **polish round** fixes what screenshots, video recordings and the owner's
"small thing, but…" feedback show. It is a wave of its own, usually one or two agents.

## Sources of issues

| Source | Typical findings |
| --- | --- |
| Screenshots matrix (languages × 390/1440 × light/dark) | Translation slips, text overflowing at 390 px, dark-mode contrast, cut-off buttons |
| Video recordings | The recorder logs console errors, failed requests and broken images **per step**; each becomes an item |
| Owner feedback | Confusing labels (two different counts both called "bookings"), empty states, wrong defaults |
| Demo walkthrough | Demo data that contradicts itself, ids that look fake, features hidden in the demo |
| Accessibility run | See [accessibility.md](accessibility.md) |

## How to run one

1. Collect issues into one list (template below), each with where, what, evidence (screenshot
   path, video step, quote).
2. Group by area and assign to agents with file ownership (no two agents on one component).
3. Each fix: the smallest change that solves it; a test when it was a logic bug; screenshots
   before/after for visual fixes.
4. Translation fixes in every configured language, against the glossary.
5. One What's new entry for the round when users would notice (e.g. "The dashboard now says how
   many bookings are confirmed, so it matches the Bookings page").
6. Demo data changes bump the SeedVersion ([testing.md](testing.md)).

## Issue list format

| # | Where | What | Evidence | Fix | Done |
| --- | --- | --- | --- | --- | --- |
| 1 | Dashboard header | Says "bookings" but counts only confirmed ones | `shots/dashboard-en-1440-light.png` | Rename label, all languages | ✅ |

Never weaken a real rule to make the demo look right; make the demo coherent.
