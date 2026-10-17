---
name: agent-brief
description: Write one complete agent brief from the framework's template for a single piece of work (feature, fix, polish, translation, accessibility or security item), with context, scope, reserved migration slot, scratch database, ports, file ownership, the standing rules (all configured languages, WCAG 2.2 AA, light and dark, privacy, data residency, What's new, no AI attribution), the gate and the report format. Use when the user or the plan-wave skill needs a brief, or says "write a brief", "brief an agent", "delegate this".
argument-hint: "[item id and title]"
---

# Write an agent brief

Template: `${CLAUDE_PLUGIN_ROOT}/templates/agent-brief.md`. Background:
`${CLAUDE_PLUGIN_ROOT}/docs/waves-and-agents.md`.

## Steps

1. **Gather facts** (do not guess):
   - repo path, branch, stack summary (CLAUDE.md), gate commands (CLAUDE.md or the profile);
   - languages: read `build/contracts/locales.json`: count, source, the longest language (usually
     German or Finnish) and a plural-heavy one (one whose `Intl.PluralRules` needs `few`/`many`,
     if configured) for screenshots;
   - data residency (CLAUDE.md);
   - strings folder, glossary, changelog (highest id: say "next free at the moment you write it");
   - reserved migration slot, scratch DB, ports, scratch folder (from the wave plan, or pick free
     ones and record them);
   - the files to study first and the files the agent owns.
2. **Write the goal in user terms**, then concrete scope bullets and what is out of scope.
3. **Fill every placeholder** of the template. Remove sections that truly do not apply (e.g.
   screenshots for a backend-only item) and say why in one line.
4. **Keep the standing rules verbatim** from the template: all configured languages with plural
   forms, WCAG 2.2 AA, light and dark, privacy by design, data residency, one What's new entry,
   STATE.md section, small targeted edits, no commit/push/deploy/cloud, no secrets, **no AI
   attribution** in anything the agent writes.
5. **Checks with numbers** and the **report format** at the end.
6. If the item touches security-sensitive surfaces (sign-in, tokens, links, webhooks, exports,
   tenant boundaries), add the relevant lines from `${CLAUDE_PLUGIN_ROOT}/docs/security-review.md`
   as explicit acceptance criteria with tests.
7. Output the brief as one block, ready to pass as the agent's prompt.
