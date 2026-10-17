# Communication with the owner

## Status updates while work runs

The owner wants an update **at least every 5 minutes** while agents run (adjustable):

- A **recurring session cron** (the `status-update` skill sets it up) reports: what is running,
  what finished since the last update, what is next, anything waiting for the owner.
- When nothing changed: **one line** ("No change: 3 agents running (i18n, payouts, a11y).").
- It **cancels itself** when nothing runs any more.
- Format: [`templates/status-update.md`](../templates/status-update.md).

## Asking for decisions

Ask as **multiple choice, recommended option first**, with the consequence of each (cost,
behaviour, time). Example:

> Monitoring: which availability tests? (prices looked up today)
> 1. **Lean (recommended)**: 3 locations every 10 min, about €X/month. Catches an outage within ~10 min.
> 2. Standard: 5 locations every 5 min, about €Y/month.
> 3. None: alerts only on errors in logs, no extra cost.

Never assume a decision that changes cost, behaviour, privacy or anything public. Group questions
so the owner can answer in one go. Keep working on what does not depend on the answer.

## Reports

- Lead with the result, then numbers, then what is unverified, then what the owner must do.
- Short. Tables for status. No filler.
- Say plainly when something failed or was not done.

## Proposing work

When asked "what else?", propose grouped ideas (loose ends, operations, features), each one line
with its value, and recommend an order. See [waves-and-agents.md](waves-and-agents.md).

## Writing style

Plain English, concise and practical; the owner may not be a native speaker. No AI attribution in
anything written for others ([safety-rules.md](safety-rules.md)).
