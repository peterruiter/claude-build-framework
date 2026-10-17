# Docs: STATE, ROADMAP, runbooks, owner checklists, writing for an audience

## STATE.md: the honest status

Template: [`templates/project/STATE.md`](../templates/project/STATE.md). Read first by every
session and every agent. Sections:

- **Live**: one line with the live version/image and date, and the ones before it.
- **Honest status**: a section per piece of work, newest first, titled with how far it is proven
  (`(16 Oct, local only)`, `(against stand-ins)`, `(live)`). What was built, decisions, checks
  with numbers, what is not done.
- **The deployment**: resources, regions, sign-in, email, domain, cost per month. No secrets.
- **Monitoring and alerts** runbook: per alert, "fires when / first look".
- **If production data is lost**: the restore runbook, with the last drill's timing.
- **Unproven**: table "What | What to do first" for everything not verified for real.
- **Rules that keep this product honest**: the invariants (server-side validation, once means
  once, credentials only in the vault…).
- **Decisions worth knowing before changing them.**

Update STATE.md **with the work**, not afterwards. Agents add a short section; the lead keeps it
coherent.

## ROADMAP.md

See [waves-and-agents.md](waves-and-agents.md). Template:
[`templates/project/ROADMAP.md`](../templates/project/ROADMAP.md), including the **Operations
readiness** wave and **Not doing**.

## Runbooks

A runbook is for someone under pressure. Per situation: **when it applies, what it means, first
look (exact command or screen), what to do, who to tell.** Template:
[`templates/runbook.md`](../templates/runbook.md).

## Owner checklists

Steps only the owner can do (store submissions, OAuth app registrations, DNS, legal review,
payments). Kept in a **private** place (a private repo or folder), never with secrets. Each
checklist has a status table updated row by row, and each step says exactly where to click and
what to paste (no secret values: name where the secret goes). Template:
[`templates/owner-checklist.md`](../templates/owner-checklist.md).

## Developer docs

Generate API docs from the OpenAPI description, with examples complete enough for a low-code
connector. A contract test keeps the description and the routes in step.

## Writing for an audience

When the owner hands something to someone else (blog post, LinkedIn post, team message, customer
email, store listing), write **for that reader**:

- Who reads it, what they know, what they should do or feel afterwards.
- Their words, not the project's internal names. No migration numbers, ticket ids or jargon.
- Short. Lead with the point. Concrete examples over adjectives.
- Right length for the channel (a LinkedIn post is not a README).
- **No AI attribution or "written with AI" credits.**
- Offer one version, not five; mention what you would change for a different audience.

## Style for all docs

Plain English, short sentences, practical. Tables for status. Exact commands in code blocks.
Dates as "16 Oct" in status, `yyyy-MM-dd` in data.
