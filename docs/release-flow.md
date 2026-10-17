# Release flow

Lead only, after the owner's go (standing or explicit). Stack-neutral steps; the profile supplies
the scripts (for .NET/React/Azure: [`profiles/dotnet-react-azure/`](../profiles/dotnet-react-azure/)).

## Steps

1. **Commit only the relevant files.** Exclude other agents' work in progress. Commit message in
   plain words, **no AI attribution** (no `Co-Authored-By` naming an assistant, no "Generated
   with …"), even if a tool suggests it. Push.
2. **Release from a clean copy** while agents keep working in the main tree:
   `git worktree add --detach ../<repo>-release HEAD`.
3. **Build with the pinned toolchain** in the worktree (temporary pin, release build with a
   scratch output path, tests without it, remove the pin).
4. **Web checks in the worktree.** Reuse the main tree's `node_modules` with a junction/symlink;
   remove it afterwards.
5. **CI green.** Watch the workflow run for the pushed commit (`gh run watch`); if red, read
   `gh run view --log-failed`, fix, push, watch again. Never release on red.
6. **Database migrations on production**, run by a **person's identity**, not the app's (the app
   identity only reads and writes data). If the cloud CLI's default account is a different
   account, **ask the owner every time** before switching; switch, run, and switch back in a
   `finally` block.
7. **Infrastructure changes** (alerts, backup retention) through the deploy script, which carries
   over settings and secrets it does not know about.
8. **Publish** the image/package; poll the new revision until it is healthy and serving traffic.
9. **Smoke test** against production: liveness, readiness, main pages, an unknown id gives 404,
   the API asks for sign-in.
10. **Log check** on the new revision: errors and warnings in the last 15 minutes.
11. **Tag What's new**: `node scripts/release-tag.mjs --release <version> --from <id> --to <id>`
    (or `--untagged`). See [whats-new.md](whats-new.md).
12. **Record the release**: update the one-line "live version" record in STATE.md; commit STATE.md
    and the changelog only; push.
13. **Clean up**: remove the worktree; restore any account you switched (in `finally`).
14. **Report** to the owner in a few lines: version, what is in it, checks with numbers, anything
    unverified.

## Never

- Release without the gate, or on a red CI.
- Switch the owner's default cloud account without asking, or leave it switched.
- Run migrations with the app's identity.
- Commit secrets, other agents' half-done work, or AI attribution.
