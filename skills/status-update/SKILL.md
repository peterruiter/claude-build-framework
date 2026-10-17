---
name: status-update
description: Set up (or stop) the recurring status update while background agents run - a session cron or loop every 5 minutes (or the interval in CLAUDE.md) that reports what is running, what finished, what's next and what waits for the owner, one line when nothing changed, and cancels itself when nothing runs. Use right after starting background agents, or when the user says "keep me posted", "status every N minutes", "stop the updates".
argument-hint: "[interval, e.g. 5m] | stop"
---

# Status updates

Reference: `${CLAUDE_PLUGIN_ROOT}/docs/communication.md`. Format:
`${CLAUDE_PLUGIN_ROOT}/templates/status-update.md`.

## Start

1. Interval: `$ARGUMENTS`, else CLAUDE.md's setting, else **5 minutes**.
2. Create a recurring job in this session with the scheduling the session offers: the cron tool
   (e.g. CronCreate) if available, otherwise the built-in loop command
   (`/loop 5m <prompt>`). Only one status job at a time: list existing ones first and replace.
3. The job's prompt:

   > Status update. Check the background agents and tasks of this session. If none is running any
   > more: send the final line ("all agents done; next: …; status updates stopped") and delete
   > this recurring job. Otherwise send an update in the format of
   > `${CLAUDE_PLUGIN_ROOT}/templates/status-update.md`: running (with minutes), finished since the
   > last update (with key numbers), next, waiting for the owner. If nothing changed since the
   > last update, send exactly one line: "<time> no change: N running (<names>)."

4. Tell the owner in one line: "Status every 5 min while agents run; it stops by itself."

## Stop

List the session's scheduled jobs and delete the status job; confirm in one line.

## Rules

Short, facts and numbers; name agents by their work; anything needing the owner goes last on its
own line; never include secrets or personal data.
