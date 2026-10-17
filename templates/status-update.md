# Status update format

Sent by the recurring status cron at least every 5 minutes while agents run (the interval is a
project setting in CLAUDE.md). The cron cancels itself when nothing runs any more.

## When something changed

```
Status 14:35
Running (3): payments refunds (12 min), translations nl/de (5 min), a11y pass (20 min)
Finished: export to CSV, 412 tests pass, report reviewed, 1 follow-up sent (erasure of export files)
Next: release gate once refunds reports
Waiting for you: choose the monitoring tier (question above)
```

## When nothing changed

```
14:40 no change: 3 running (refunds, translations, a11y).
```

## When the last agent finished

```
14:55 all agents done. Next: quality gate and release, on your go. Status updates stopped.
```

Rules: short, facts, numbers; name the agent by its work, not its id; anything that needs the
owner goes last, on its own line.
