# Operations readiness

Every project plans an **Operations readiness** wave **before the first real users** (or before
the first big event, launch or campaign). It is in the ROADMAP template from day one, and the
`plan-wave` skill reminds you when features are done and this wave is not. Skills:
`ops-readiness` (the whole wave) and `load-test` (the load part).

Stack-specific pieces for .NET/React/Azure are in
[`profiles/dotnet-react-azure/`](../profiles/dotnet-react-azure/) (alert rules as Bicep, SQL
backup parameters, a restore drill script, k6 scenarios under `load/`). The stack-neutral load
template is [`templates/project/tests/load/`](../templates/project/tests/load/).

## 1. Monitoring and alerts

- **Availability tests** on the main entry points (API health incl. database, public site, app).
  **Ask the owner which tier**, as multiple choice with costs (look up current prices; figures
  change):
  1. *Lean (recommended to start)*: few locations, every 10 minutes.
  2. *Standard*: more locations, every 5 minutes.
  3. *None*: log-based alerts only.
- **Alert rules** with an **owner email** in one action group: app down, 5xx rate, slow
  responses, restarts/crash loops, database CPU/storage/deadlocks, queue backlog per
  integration, failed background jobs, certificate expiry, spend.
- Every alert has a runbook line: **fires when → what it means → first look**.
- After deploying: confirm the "you were added" email arrives (check spam), and that each test
  shows its first results.

## 2. Backups and restore

- Database **point-in-time restore** retention (e.g. 14 days) plus **long-term copies** (e.g.
  weekly for 4 weeks, monthly for 6 months). Choose with the owner (cost and legal retention).
- File storage: **blob/object soft delete** and container soft delete; versioning where cheap.
- **Restore drill**: restore production to a *new* database at a point an hour back, check row
  counts and a few known records, **record how long it took**, delete the copy. Only with the
  owner's go; never overwrite production.
- Runbook "If production data is lost or corrupted": who decides, which restore, how to point the
  app at it, how to tell users. Record the last drill's date and timing in STATE.md.

## 3. Shared rate limits

Rate limits must hold **across replicas**: a counter per partition in the database (one small row
on a primary key, one upsert per check) or a shared cache. Keep the limit numbers and headers
unchanged; let a replica answer locally when it clearly can (window known to be used up); fall back
to local counting with a logged warning if the store is down; delete ended windows in batches;
store partitions as a hash (no addresses). Test: two limiters on one database share one budget.

## 4. Load tests

Plan per **user journey**, not per endpoint. Typical scenarios (adapt to the product):

| Scenario | Shape |
| --- | --- |
| Sales rush | Many visitors open the page and buy in the same minutes (ramp up fast) |
| Morning of the event | Everybody opens their ticket and the agenda |
| Check-in burst | Door scans at a steady high rate for 30–60 minutes |
| Live sessions | Many open live streams/long polls; a change must reach all within N seconds |
| Dashboards | Organisers refreshing reports during the peak |
| API clients | Integrations polling and pushing with their keys |

Rules:

- **Respect rate limits**: the test spreads callers like real ones do, or uses an allowed test
  key; a wall of 429s measures the limiter, not the system.
- **Test data generator**: creates a realistic test tenant/event through the real API, writes a
  fixture file (ids, codes, cookies) the scenarios read, and has a `--cleanup`.
- **Local trial first** against a local run with a local database: proves the scripts and finds
  the obvious (N+1 queries, missing indexes, lock contention).
- **Planned real run**, only with the **owner's go**: a separate resource group/environment, or
  off-peak against a **test** tenant/event; never against real users' data. Write the plan: what,
  where, when, expected cost, who watches, how to stop.
- **Success criteria** up front: e.g. p95 < 500 ms for reads, < 1 s for writes, error rate
  < 0.5 %, no 5xx, live updates reach all clients within 5 s, database CPU < 70 %.
- **Clean up** after: test data, scaled-up resources, temporary keys. Record results and cost in
  STATE.md.

## 5. Runbook

STATE.md gets a "Monitoring and alerts" table and a restore runbook. Template:
[`templates/runbook.md`](../templates/runbook.md).

| Alert | Fires when | What it means | First look |
| --- | --- | --- | --- |
| App down | Availability test fails from 2+ locations for 10 min | Users cannot reach the app | Revision health and last deployment; app logs for start-up errors |

## Done when

- [ ] Availability tests and alert rules deployed; owner received the action group email.
- [ ] Backup retention and soft delete set; restore drill done with timing recorded.
- [ ] Rate limits shared across replicas, with a test.
- [ ] Load scenarios written; local trial passed; real run planned (and run, with the owner's go).
- [ ] Runbook in STATE.md for every alert and for data loss.
