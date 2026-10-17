---
name: plan-wave
description: Turn a list of wishes into a wave of 3-6 parallel agent briefs with reserved migration slots, scratch databases, port ranges, file ownership and "small targeted edits" rules, then (on the owner's go) start the agents in the background. Also proposes what to build next in groups (loose ends, operations, features) and reminds about the Operations readiness wave. Use when the user lists features to build, asks "what's next", "what else can we build", "plan the next wave" or "split this over agents".
argument-hint: "[wishes or roadmap items]"
---

# Plan a wave

Method: `${CLAUDE_PLUGIN_ROOT}/docs/waves-and-agents.md`. Brief template:
`${CLAUDE_PLUGIN_ROOT}/templates/agent-brief.md`.

## 1. Read

- STATE.md (what exists, what is unproven), ROADMAP.md (agreed items, Not doing, Decisions),
  CLAUDE.md (rules, gate commands), `build/contracts/locales.json` (languages),
  `build/contracts/changelog.json` (highest id).
- The code areas the wishes touch, enough to judge independence and file ownership.
- Highest migration number in use, ports and scratch databases used by earlier briefs.

## 2. If the owner asked "what else?"

Propose ideas in three groups, one line each with its value, and recommend an order:
1. **Loose ends**: half-done items, Unproven rows that can be proven locally.
2. **Operations and reliability**: see step 3.
3. **Features**.
Let the owner pick. Do not plan items from "Not doing".

## 3. Operations readiness check

If the features for a first launch are (nearly) done and the **Operations readiness** wave in
ROADMAP.md is not, say so and offer it (`/build-framework:ops-readiness`). It must be done before
the first real users or the first big peak.

## 4. Shape the wave

- **3–6 independent items.** Split or merge until each agent can work without waiting for another.
- Items that touch everything (translation sweep, accessibility pass, renames) go in a wave with
  few others, with strict small-edit rules.
- Anything that changes cost, behaviour, privacy, data residency or anything public: ask the owner
  first, multiple choice with a recommendation.
- Per item reserve:
  - a **migration slot** (next free hundred, e.g. 8200, 8300; idempotent, runs twice cleanly);
  - a **scratch database** name (`<Project>_<Item>_Scratch`);
  - a **port range** (e.g. 5610–5619, 5620–5629);
  - a **scratch folder** (`scratch/<item>/`);
  - **owned files** (new files and the components only it changes) and **shared files** it may
    touch with small targeted edits (string bundles, registries, STATE.md, changelog).

## 5. Write the briefs

One brief per item with `/build-framework:agent-brief` (or directly from the template). Every
brief includes: languages from `locales.json` (no hard-coded count), WCAG 2.2 AA, light and dark,
privacy checklist, data residency, one What's new entry, a STATE.md section, no commit/push/cloud,
no secrets, **no AI attribution**, the gate with numbers, the screenshot matrix, the report format.

## 6. Show the plan and ask for the go

A table: item, agent type, migration slot, ports, owned files, risks. Ask "Start these N agents?"
with any open decisions.

## 7. Start (on the go)

- Start each agent **in the background** with the Agent tool, `subagent_type`
  `build-framework:feature-builder` (or a better-suited plugin agent), the brief as the prompt.
- Set up status updates: `/build-framework:status-update`.
- Mark the items `in progress` in ROADMAP.md.
- While they run: answer questions, check partial work, send precise follow-ups (security gaps
  first). Resume a stalled agent with where it was and what is left.
