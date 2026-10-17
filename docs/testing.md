# Testing patterns

## Stand-ins for external services

A **stand-in** is a small local HTTP server that answers like the real service (payment provider,
accounting package, CRM, mail API, VAT check, AI endpoint…), so features are built and tested
without real accounts.

- Template: [`templates/project/tests/standins/standin.mjs`](../templates/project/tests/standins/standin.mjs)
  with routes in a module ([`example-service.mjs`](../templates/project/tests/standins/example-service.mjs)),
  and a ready Dataverse Web API stand-in ([`dataverse.mjs`](../templates/project/tests/standins/dataverse.mjs)).
  Each comes with a test (`node --test "tests/standins/*.test.mjs"`).
- Answer the way the real API does: status codes, field names, pagination, error bodies, wrong-key
  refusal, idempotency keys. Read the provider's docs first.
- **Controls** outside the API path (`/_standin/...`): what was received, reset, make the next call
  fail with a status, simulate events (a payout, a dispute, a "gone" webhook).
- The app's base URL for the service is a setting, so tests and local runs point at the stand-in.
- Reports and STATE.md say clearly: **"verified only against the stand-in"**. The Unproven table
  lists what to do with a real account.

## Databases

- Database tests run against a **local scratch database per agent** (own name), created and
  migrated from scratch, so "applies on a brand-new database" is tested every time.
- Migrations are idempotent and run twice cleanly; test that.
- Use the database clock for times that the database compares; compare timestamps at stored
  precision.

## Concurrency

Anything with "only once" or "the last one" (last ticket, once-per-person points, insert-if-not-
exists) gets a test that runs the requests **in parallel** and checks the result. Typical fix: the
right lock on the existence check, or a unique key that refuses the second.

## Demo data

- Seeded **idempotently** at start, with a `SeedVersion` string. Change the demo → bump the version
  with a suffix per feature (`2026-10-16-payments3`) so existing demo databases rebuild.
- Fixed ids for the demo's main objects, so tests, screenshots and videos can link to them.
- Realistic: real-looking names, ids in the provider's format, numbers that add up.
- Demo-only shortcuts are explicit and never weaken a real rule.

## Screenshots matrix

For every UI change, Playwright screenshots of the changed pages:

| Dimension | Values |
| --- | --- |
| Languages | the source language, the **longest** language (often German or Finnish), a **plural-heavy** one (Polish, if configured) |
| Widths | 390 and 1440 |
| Themes | light and dark |

Written to the agent's scratch folder, **looked at by the agent**, and fixes made from what they
show. Mention paths in the report.

## Node tests for contracts and front-end logic

`node --test` needs no dependencies: contract tests, pure logic (plural selection, CSV escaping,
date maths), and source-level contract tests for shared components.

## Load tests

See [operations.md](operations.md).
