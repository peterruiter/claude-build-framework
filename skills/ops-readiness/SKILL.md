---
name: ops-readiness
description: Plan and run the Operations readiness wave before the first real users or a big peak - monitoring and alert rules to the owner's email with cost-tiered availability tests (owner chooses the tier), backups (point-in-time retention, long-term copies, storage soft delete) in the chosen region, a restore drill with timing (owner's go), rate limits shared across replicas, a load test (via the load-test skill), and runbooks in STATE.md. Use when the user asks about "going live", "launch readiness", "monitoring", "alerts", "backups", "restore", "operations", or when features are done and this wave is not.
argument-hint: "[part: monitoring|backups|restore|rate-limits|load|runbook]"
---

# Operations readiness

Reference: `${CLAUDE_PLUGIN_ROOT}/docs/operations.md`. Stack pieces: the profile
(`${CLAUDE_PLUGIN_ROOT}/profiles/<profile>/`, e.g. alert rules, backup parameters, restore drill
script). Runbook template: `${CLAUDE_PLUGIN_ROOT}/templates/runbook.md`.

## 1. Decisions first (one message, multiple choice, recommendation first)

- **Availability tests tier**: lean / standard / none, with **current prices looked up** for the
  project's cloud and region.
- **Alert email** (the owner's address goes in the deploy parameters, not in the repo if private
  matters; ask).
- **Backup retention**: point-in-time days; long-term weekly/monthly copies; costs; any legal
  retention requirement.
- **Load test**: expected peak (users, per minute), the date it matters, budget for a real run.

## 2. Build (as a wave; briefs via `/build-framework:plan-wave`)

| Item | Done when |
| --- | --- |
| Monitoring and alerts | Tests and rules in infrastructure code; every alert has a runbook line |
| Backups | Retention and soft delete in infrastructure code, in the chosen region |
| Restore drill script | Restores to a **new** database at a point back, checks, times, deletes |
| Shared rate limits | Counters shared across replicas; same limits and headers; fallback with a warning; test with two limiters |
| Load test | `/build-framework:load-test`: scenarios, generator, local trial, real-run plan |
| Runbooks | STATE.md: Monitoring and alerts table; "If production data is lost or corrupted" |

## 3. Deploy and prove (each with the owner's go)

- Deploy infrastructure with the profile's script; confirm the action group's email arrived
  (check spam) and every availability test shows results.
- Run the **restore drill** with the owner's go; record date and duration in STATE.md.
- Real load run only per the approved plan (load-test skill).

## 4. Record

STATE.md: what is deployed, drill timing, load results and cost; ROADMAP.md: mark R.1–R.6.
Anything not proven goes into Unproven.
