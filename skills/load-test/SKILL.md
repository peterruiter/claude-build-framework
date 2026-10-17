---
name: load-test
description: Plan and build a load test per user journey with k6 - scenarios such as a sales rush, the morning-of peak, a check-in burst, live sessions, dashboards and API clients; success criteria (p95, error rate); respecting rate limits; a test data generator with cleanup; a local trial first; and a real-run plan with costs that only runs with the owner's go, never against production users' data. Use when the user asks for a "load test", "stress test", "can it handle N users", "performance test", or as part of operations readiness.
argument-hint: "[expected peak or scenario]"
---

# Load test

Reference: `${CLAUDE_PLUGIN_ROOT}/docs/operations.md` (section 4). Templates:
`${CLAUDE_PLUGIN_ROOT}/templates/project/tests/load/` (`journeys.k6.js`, `journeys.json`,
`generate.mjs`) and `${CLAUDE_PLUGIN_ROOT}/templates/load-test-plan.md`. The .NET/Azure profile
has ready k6 scenarios in `${CLAUDE_PLUGIN_ROOT}/profiles/dotnet-react-azure/load/`.

## 1. Plan with the owner

- The peak to survive (users, per minute, when) and **success criteria** before any run:
  p95 reads/writes, error rate, live-update delay, database CPU.
- Journeys per real user type: sales rush, morning-of peak, check-in/door burst, live sessions
  (long polls/streams), organisers' dashboards, API clients/integrations. Each journey is the
  sequence a real user makes, with think time.
- **Rate limits**: how the test spreads callers (many addresses only against a local run, or an
  allowed test key) so the run measures the system, not the limiter.
- Write the plan from the template, including where, when, cost estimate (scaled resources,
  load generator, egress), who watches, how to stop, cleanup.

## 2. Build

- Copy the templates into `tests/load/`; fill `journeys.json` with the product's real paths and
  shapes; set thresholds from the success criteria.
- Fill the PROJECT functions in `generate.mjs`: a test tenant with realistic data **through the
  product's own API**, the fixture (ids, codes, cookies, keys), and `--cleanup`.
- Add `tests/load/out/` to `.gitignore` (fixtures hold test credentials).

## 3. Local trial (no approval needed)

```
node tests/load/generate.mjs --base http://127.0.0.1:<port> --customers 500
k6 run tests/load/journeys.k6.js -e FIXTURE=tests/load/out/<fixture>.json -e SCALE=0.1
node tests/load/generate.mjs --cleanup tests/load/out/<fixture>.json
```
Fix what it finds (N+1 queries, missing indexes, lock contention, chatty endpoints) with tests.

## 4. Real run (only with the owner's explicit go)

- A **separate environment/resource group**, or off-peak against a **test** tenant; in the chosen
  data region; never against real users' data; `ALLOW_REMOTE=yes` only for that run.
- Watch it live (metrics, errors); stop at the agreed limit.
- **Clean up**: test data, scaled-up resources, temporary keys.

## 5. Record

Results per scenario against the criteria, cost, and fixes in STATE.md; anything not run in Unproven.
