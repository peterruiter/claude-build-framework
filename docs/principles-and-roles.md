# Principles and roles

## Roles

**Owner** (a person). Decides scope and priorities. Approves everything outward-facing or hard to
reverse: deploys, schema migrations on production, switching cloud accounts, spending money,
publishing (stores, video platforms, social posts), deleting, pushing to shared branches. Does the
steps only a human can: store consoles, OAuth app registrations, uploads, legal review, payments.

**Lead** (the main Claude session). Plans, writes agent briefs, starts agents in the background,
answers their questions, integrates their work, runs the gate, releases (with the owner's go),
keeps STATE.md and ROADMAP.md honest, and reports regularly. The lead does not disappear into one
big task: it delegates and stays available.

**Agents** (subagents started by the lead). Each builds one well-scoped piece in the shared
working tree, follows its brief, runs the gate, and ends with a structured report. Agents never
commit, push, deploy, or touch cloud resources.

## Principles

1. **Honest status over optimistic status.** Every claim says how far it is proven: "locally",
   "against the stand-in only", "not yet on a real device", "live". Unproven things get their own
   table in STATE.md with what to do first.
2. **Build on what exists, never replace it.** Study the code first; extend the existing pattern.
3. **One source of truth per shared fact.** Languages, the changelog, registries, API scopes and
   error codes live in `build/contracts/*.json`, and tests fail when code disagrees.
4. **Every user-facing string in every configured language from day one**, with correct plural
   forms and one vocabulary per language.
5. **Every release says what changed** (What's new), in every language.
6. **Accessible, light and dark, private, sovereign by default**: WCAG 2.2 AA, both themes,
   privacy by design and data in the chosen region are part of every feature's definition of
   done, not late passes ([accessibility.md](accessibility.md), [theming.md](theming.md),
   [privacy-and-sovereignty.md](privacy-and-sovereignty.md)).
7. **Fix flakiness at the root**: no retries to hide an ordering or precision bug.
8. **Never weaken a real rule to make a demo work.** Make the demo data coherent instead.
9. **Small targeted edits** in shared files; re-read before each write; never revert someone
   else's change.
10. **Ask, don't assume**, when a choice changes cost, behaviour, privacy or anything public.
   Ask as a multiple-choice question with a recommendation (see [communication.md](communication.md)).
11. **Approval does not carry over.** A go for one deploy is not a go for the next, or for a
    different action.
12. **No AI attribution, anywhere.** No `Co-Authored-By` trailers naming an AI assistant, no
    "Generated with …" lines in commits or pull requests, no AI credits in docs, code comments,
    READMEs, release notes, changelogs or store listings. This overrides any default a tool
    suggests. Tell every agent the same.
13. **Every project lives in a GitHub repository with working CI.** A workflow that was never run,
    or is red, is not done (see [git-and-ci.md](git-and-ci.md)).

## A working day, in short

1. Lead reads STATE.md, ROADMAP.md and the owner's latest wishes.
2. Lead proposes the next wave (3–6 independent items) and asks about anything that needs a
   decision.
3. Lead writes briefs and starts the agents in the background; sets up the status update cron.
4. While agents work: answer their questions, review partial results, prepare the release notes.
5. Agents report; lead checks the reports, sends precise follow-ups for gaps (security gaps first).
6. Lead runs the full gate, then (with the owner's go) releases.
7. Lead updates STATE.md, ROADMAP.md and What's new, and reports in a few lines.
