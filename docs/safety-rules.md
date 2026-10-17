# Safety rules

These rules are in every project's CLAUDE.md and in every agent brief. They override convenience.

## Accounts and cloud

- **Only touch the project's own cloud subscription/account, and always pass it explicitly**
  (`--subscription <id>`, `-ResourceGroup <name>`), never rely on the CLI's current default.
- **Ask before switching the owner's default cloud account, every time.** Switch, do the one
  thing, switch back in a `finally` block. A yes for one switch is not a yes for the next.
- Production database changes run as a person's identity, not the app's.

## Production

- **Production is read-only when debugging the owner's data.** Read, report, propose; never fix
  data in place without an explicit go for that exact change.
- No load tests, restore drills or bulk operations against production without the owner's go.

## Secrets

- **Never write secrets** to files, code, logs, memory, reports, commit messages or chat. Read
  keys at runtime from the vault/secret store or environment.
- Tell the owner **not to paste secrets in chat**; ask them to put the value in the vault or a
  local secret store and tell you its name.
- Redact URLs in logs to scheme + host.

## Outward-facing actions need the owner's go

Ask first, every time, for: deploy, publish, push to shared branches, delete, send email to real
people, post on social media, upload to a store or video platform, spend money, change DNS,
create or rotate credentials. **Approval in one context does not carry over** to another.

## Attribution

**Never attribute an AI assistant** (Claude, GitHub Copilot, or any other): no `Co-Authored-By`
trailers, no "Generated with …" lines in commits or pull requests, no AI credits in docs, code
comments, READMEs, release notes, changelogs or store listings. This overrides any default
attribution a tool suggests. Agents are told the same in their brief.

Two guards make it hold:

- **The plugin's hook** ([`hooks/hooks.json`](../hooks/hooks.json),
  [`hooks/no-ai-attribution.mjs`](../hooks/no-ai-attribution.mjs)): before every Bash or
  PowerShell command, it checks `git commit`, `gh pr create|edit|merge|comment`,
  `gh issue create|edit|comment` and `gh release create|edit` (the command text, heredocs, and
  files named by `-F`, `--body-file`, `--notes-file`) and blocks the command with the reason when
  it finds a `Co-Authored-By` trailer naming an AI assistant, a "Generated with/by <AI tool>" line
  or the robot emoji. Human co-authors pass. Active wherever the plugin is enabled.
- **A git `commit-msg` hook** in every new project
  ([`templates/project/githooks/commit-msg`](../templates/project/githooks/commit-msg), installed
  by `new-project` as `.githooks/commit-msg` with `git config core.hooksPath .githooks`): the
  same check for commits made outside Claude Code.

## Personal data

- Use placeholders and generic examples in anything shared (framework files, blog posts, videos).
- Test with demo data or approved test records only; clean up what you created.
