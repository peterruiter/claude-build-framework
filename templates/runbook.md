# Runbook: {{SITUATION}}

For someone under pressure. Keep each entry short and exact.

| | |
| --- | --- |
| **Applies when** | {{TRIGGER, e.g. alert "5xx rate" fires}} |
| **What it means** | {{PLAIN_EXPLANATION}} |
| **First look** | {{EXACT_COMMAND_OR_SCREEN}} |
| **Likely causes** | {{CAUSE_1}}; {{CAUSE_2}} |
| **Do** | 1. {{STEP}} 2. {{STEP}} |
| **Do not** | {{e.g. restart the database; fix data in place without the owner's go}} |
| **Tell** | {{WHO, HOW}} |
| **Last practised** | {{DATE, DURATION}} |

## Alerts table (for STATE.md)

| Alert | Fires when | What it means | First look |
| --- | --- | --- | --- |
| App down | Availability test fails from 2+ locations for 10 min | Users cannot reach the app | Revision health, last deployment, start-up errors in the app log |
| 5xx rate | More than 2 % of requests fail for 5 min | A code path or dependency fails | App log errors in the last 15 min, grouped by route |
| Slow responses | p95 above 2 s for 10 min | Database or a dependency is slow | Database CPU and slowest queries; dependency latency |
| Queue backlog | An integration queue older than 30 min | An external service refuses or is down | The queue's last error; the service's status page |
