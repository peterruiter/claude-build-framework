# Load test plan: {{PRODUCT}} {{DATE}}

**Needs the owner's go before any run that is not local.**

## Why and when

{{e.g. Before the first large customer: 3,000 users in one morning.}}

## Journeys and shapes

| Scenario | Journey | Shape | Peak |
| --- | --- | --- | --- |
| Sales rush | browse → offer → order | ramping arrival rate | {{N}}/s for 3 min |
| Morning peak | open my page → schedule | constant arrival rate | {{N}}/s for 5 min |
| Check-in burst | scan | constant arrival rate | {{N}}/s for 10 min |
| Live sessions | long poll / stream | constant VUs | {{N}} open |
| Dashboards | report refresh | constant VUs | {{N}} |
| API clients | list/push with keys | constant VUs | {{N}} |

Rate limits: {{how the test spreads callers or which test key is allowed}}.

## Success criteria (agreed before the run)

| Measure | Target |
| --- | --- |
| p95 reads | < {{500}} ms |
| p95 writes | < {{1000}} ms |
| Error rate | < {{0.5}} % |
| Live updates reach all clients | within {{5}} s |
| Database CPU | < {{70}} % |

## Where

- [ ] Local trial: `k6 run tests/load/journeys.k6.js -e SCALE=0.1` against a local run. Result: {{…}}
- [ ] Real run: {{separate environment / off-peak against a test tenant}}, region {{DATA_RESIDENCY}},
      at {{DATE_TIME}}, watched by {{WHO}}. Stop: {{how}}.

## Cost

{{Scaled-up resources × hours, load generator, data egress: about €…}}

## Cleanup

- [ ] `node tests/load/generate.mjs --cleanup <fixture>`
- [ ] Scale back; remove temporary keys and resources.

## Results

| Scenario | p95 | Errors | Notes |
| --- | --- | --- | --- |

Record the summary and cost in STATE.md.
