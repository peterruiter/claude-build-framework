# Git, GitHub and CI

## Standing rule

**Every project lives in a git repository pushed to GitHub**, with a description and topics, and
**its build workflows actually work**. A workflow that was added and never run, or is red, is not
done.

## Setting up (the `new-project` skill does this)

1. `git init -b main`, a `.gitignore` for the stack (node_modules, build output, scratch folders,
   screenshots, `.env*`, local settings).
2. First commit.
3. Ask the owner: **private (default) or public**, the repository name, a one-line description.
4. `gh repo create <name> --private --source . --description "<one line>" --push`
5. Topics: `gh repo edit --add-topic <topic> --add-topic <topic>`
6. Add the CI workflow from the chosen profile (`.github/workflows/ci.yml`) and the `commit-msg`
   hook (`.githooks/`, `git config core.hooksPath .githooks`), commit, push.
7. **Watch the run until it is green**: `gh run watch` (or `gh run list --limit 1` then
   `gh run watch <id>`). If red: `gh run view <id> --log-failed`, fix, push, watch again.

## Every change to a workflow

Push and watch the run until it is green; fix failures at the root. Never leave a red or never-run
workflow. Report the run's URL and result.

## Commits and pull requests

- Commit only the relevant files; never other agents' work in progress.
- Plain, descriptive messages: what changed for whom.
- **No AI attribution**: no `Co-Authored-By` trailer naming an AI assistant, no "Generated with
  …" line in commit messages or PR bodies, even when a tool's default adds one. Remove it. The
  plugin's hook and the project's `commit-msg` hook block such messages
  ([safety-rules.md](safety-rules.md#attribution)).
- Only the lead commits and pushes, and only with the owner's go (standing or explicit).
- Secrets never enter the repository; if one does, tell the owner at once (rotate it; history
  rewriting is the owner's call).

## Branches

Work on a branch; merge to `main` through a pull request or as the owner prefers. Releases come
from a clean worktree of the pushed commit ([release-flow.md](release-flow.md)).
