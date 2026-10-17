# Roadmap

What is agreed, in the order it is being built. Each wave ships on its own; STATE.md records what
was proven. Status marks: `✅ 17 Oct`, `✅ 17 Oct (locally)`, `(against the stand-in only)`,
`(not yet on a real device)`, `in progress`.

## Not doing

Each decision with its reason and date, so it is not proposed again.

- **{{EXAMPLE}}.** Reason. (Decided {{DATE}}.)

## Wave 0: foundations

| | What | Notes |
| --- | --- | --- |
| 0.1 | **Repository, CI, conventions** | GitHub ({{VISIBILITY}}), CI green, CLAUDE.md rules |
| 0.2 | **Languages** | {{LANGUAGE_LIST}}; checker and plural forms from day one |
| 0.3 | **Light and dark, accessibility baseline** | Colour tokens, theme contrast test, skip link, focus ring, axe in CI-able form |
| 0.4 | **Privacy and data residency baseline** | {{DATA_RESIDENCY}} regions; privacy page; erasure skeleton; log redaction |
| 0.5 | **Local run with demo data** | Seeded idempotently with a SeedVersion |

## Wave 1: {{FIRST_FEATURE_AREA}}

| | What | Notes |
| --- | --- | --- |
| 1.1 | **…** | |

## Operations readiness (before the first real users)

Planned in every project; run before launch or the first big peak. See the framework's
operations guide.

| | What | Notes |
| --- | --- | --- |
| R.1 | **Monitoring and alerts** | Availability tests (tier chosen by the owner, with cost), alert rules to the owner's email, runbook "fires when / first look" in STATE.md |
| R.2 | **Backups** | Database point-in-time retention and long-term copies; storage soft delete; in {{DATA_RESIDENCY}} |
| R.3 | **Restore drill** | With the owner's go: restore to a new database, check, time it, delete; timing in STATE.md |
| R.4 | **Shared rate limits** | Counters shared across replicas, with a test |
| R.5 | **Load test** | Journeys and success criteria (p95, error rate); data generator; local trial; real run planned (owner's go, separate environment or off-peak against test data, cost, cleanup) |
| R.6 | **Runbook** | Every alert and data loss covered in STATE.md |

## Decisions

| For | Decided {{DATE}} |
| --- | --- |
| All | Data residency: {{DATA_RESIDENCY}}. |
