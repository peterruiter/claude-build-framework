---
name: owner-checklist
description: Write or update a checklist of steps only the owner (a person) can do - store submissions, OAuth app registrations, DNS records, payment or legal steps, console settings - with exact click paths, values to enter, where each secret goes (never the secret itself), a status table updated row by row, kept in a private location. Use when work is blocked on the owner, or the user says "what do I need to do", "owner steps", "checklist for me", "registration steps".
argument-hint: "[topic]"
---

# Owner checklist

Template: `${CLAUDE_PLUGIN_ROOT}/templates/owner-checklist.md`. Reference:
`${CLAUDE_PLUGIN_ROOT}/docs/docs-and-writing.md`.

## Steps

1. **Where it lives**: ask the owner for the private location (a private repo or folder) if
   CLAUDE.md does not say; never in a public repo. One file per topic.
2. **Research the current steps** in the provider's official docs (consoles change). Note the
   doc link per step.
3. **Write each step** from the template: why, where (URL or console path), exact clicks, a table
   of values to enter (redirect URLs, bundle ids, scopes), and where a generated secret goes
   (vault + secret name). **Never** write a secret value; tell the owner not to paste secrets in
   chat.
4. **Status table** at the top: `⬜ to do`, `⏳ waiting on …`, `✅ done <date>`. Update row by row
   as the owner reports progress.
5. **Done when**: an observable result per step (a verification page, a green check, a test
   call the lead can make).
6. Link the checklist from STATE.md's Unproven row or the relevant section.
7. Tell the owner the next step in one line, not the whole list, unless asked.
