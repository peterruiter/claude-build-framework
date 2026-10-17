# Waves and parallel agents

## ROADMAP.md

- Lists waves and items with a status marker: `✅ 9 Oct`, `✅ 9 Oct (locally)`, `(against the
  stand-in only)`, `(not yet on a real device)`, `in progress`, nothing yet.
- Has a **Not doing** section: each decision with its reason and date, so it is not re-proposed.
- Has a **Decisions** table for choices worth knowing before changing them.
- Template: [`templates/project/ROADMAP.md`](../templates/project/ROADMAP.md).

## Waves

- A wave is **3–6 independent items** that can run as parallel agents.
- Items that touch everything (a translation sweep, an accessibility pass, a large rename) run
  when few others run, or with strict "small targeted edits" rules.
- When the owner asks "what else can we build?", propose ideas in groups and let the owner pick:
  1. **Loose ends**: what is half-done or unproven.
  2. **Operations and reliability**: monitoring, backups, rate limits, restore drills.
  3. **Features**: new things users would notice.
- After a feature wave, run a **polish round** ([polish-rounds.md](polish-rounds.md)).

## Rules that make parallel agents work in one tree

| Shared thing | Rule |
| --- | --- |
| Database migrations | Each agent gets a **numbered slot** (e.g. 8200, 8300). Migrations are idempotent, apply on a brand-new database, and run twice cleanly. |
| Scratch database | Each agent has its **own database name** (e.g. `<Project>_<Feature>_Scratch`). |
| Ports | Each agent has its **own port range** for the local API and stand-ins. |
| Scratch files | Each agent has its **own scratch folder** (screenshots, notes). |
| Shared files (bundles, registries, STATE.md, changelog) | **Small targeted edits**, re-read immediately before each write, never revert someone else's edit, never reformat a whole file. |
| What's new | One entry per agent: next free id **at the moment of writing** (re-read first), `release: null`. |
| Git and cloud | Agents never commit, push, deploy, or change cloud resources. Only the lead does, with the owner's go. |
| Secrets | Never written to files, logs, memory or reports. |
| Attribution | No AI attribution in any file, comment, commit message or text the agent writes. |

When agents break each other's build in the shared tree, an agent may run its checks in a clean
copy: `git archive HEAD | tar -x -C <scratch>` plus its own changed files.

If an agent stalls (no progress for a long time), resume it with a message that says where it was
and what is left.

When an agent reports a gap with security impact, send it back immediately with a precise
follow-up (what, where, what the test must prove).

## The agent brief

Template: [`templates/agent-brief.md`](../templates/agent-brief.md). Every brief has:

1. **Context**: repo path, branch, "read STATE.md first", the stack in two lines, where strings
   live, the configured languages (from the languages config, never a hard-coded count).
2. **Goal and scope**: concrete bullets, what to study first, "build on what exists".
3. **Reserved resources**: migration slot, scratch database, port range, scratch folder.
4. **Rules**: all strings in all configured languages with plural forms; WCAG 2.2 AA; light and
   dark; privacy by design (erasure covers new tables, no personal data in logs); data stays in
   the configured region; one What's new entry (next free id, release null, re-read first); a
   short STATE.md section; small targeted edits in shared files; no commit, push or cloud
   changes; no secrets; no AI attribution.
5. **Checks before reporting**: the gate ([quality-gate.md](quality-gate.md)) with numbers.
6. **Screenshots**: Playwright, several languages (including the longest and a plural-heavy
   one), widths 390 and 1440, light and dark, into the scratch folder; look at them and fix what
   they show.
7. **Report format** (below).

## The agent report

Template: [`templates/agent-report.md`](../templates/agent-report.md).

- **Built**: what, in user terms.
- **Design decisions**: and why.
- **Checks**: each gate step with numbers (`412 tests passed, 0 failed`).
- **Unverified**: honest list ("tested only against the stand-in", "no real device").
- **Changed files**: full list, new files marked.
- **Follow-ups**: anything the lead must decide or do.

The lead reads every report critically: are the numbers there, is anything claimed without proof,
did the agent touch files outside its scope?
