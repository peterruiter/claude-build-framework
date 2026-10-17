---
name: write-docs
description: Write or update project documentation the framework's way - STATE.md (honest status, live version, deployment, data flows, alerts runbook, restore runbook, Unproven table, rules, decisions), ROADMAP.md (waves with status marks, Not doing, Operations readiness, Decisions), runbooks, owner checklists, developer docs, and audience-specific texts (blog, LinkedIn, team message, customer email, store listing) without AI credits. Use when the user asks to "update STATE", "write a runbook", "document this", "write a blog post / LinkedIn post / announcement", or at the end of a piece of work.
argument-hint: "[STATE|ROADMAP|runbook|checklist|audience text] [topic]"
---

# Write docs

Reference: `${CLAUDE_PLUGIN_ROOT}/docs/docs-and-writing.md`. Templates:
`${CLAUDE_PLUGIN_ROOT}/templates/project/STATE.md`, `…/ROADMAP.md`,
`${CLAUDE_PLUGIN_ROOT}/templates/runbook.md`, `${CLAUDE_PLUGIN_ROOT}/templates/owner-checklist.md`.

## STATE.md

- Add a section at the top of "Honest status", titled with how far it is proven
  (`(17 Oct, local only)`, `(against stand-ins)`, `(live since …)`): what was built, decisions,
  checks with numbers, what is not done.
- Move anything unverified into **Unproven** with "what to do first".
- Update **Live**, **The deployment**, **Data flows**, **Monitoring and alerts**, **If production
  data is lost** when they change. Never secrets; names of vault entries are fine.
- Small targeted edits; other agents edit STATE.md too.

## ROADMAP.md

Status marks on items (`✅ 17 Oct (locally)`), new items in the right wave, **Not doing** with
reason and date, **Decisions** with date. Keep the **Operations readiness** wave.

## Runbook

From the template: applies when, what it means, first look (exact command/screen), likely causes,
do, do not, tell, last practised. Short and exact; for someone under pressure.

## Owner checklist

Use `/build-framework:owner-checklist`.

## Text for an audience

1. Ask (or infer) who reads it, what they know, what they should do or feel, the channel and length.
2. Write in their words, lead with the point, concrete examples, no internal names or jargon.
3. **No AI attribution or "written with AI" lines.** No secrets, no personal data, no client names
   without the owner's say.
4. Give one version; say in one line what you'd change for another audience.
