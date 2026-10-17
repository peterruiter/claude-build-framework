---
name: check-tools
description: Check that every tool a profile needs is installed and recent enough (git, GitHub CLI, Node.js, npm, plus the profile's own - e.g. .NET SDK, PowerShell 7, Azure CLI, Power Platform CLI, LocalDB, k6) and give the exact install command per OS for anything missing. Runs automatically at the start of new-project and quality-gate. Use when the user says "check my tools", "what do I need to install", "is my machine ready", or when a command fails with "not recognized" / "command not found".
argument-hint: "[profile ...]"
---

# Check tools

1. Pick the profile(s): the arguments, else the profile named in the project's CLAUDE.md, else ask
   (list the folders in `${CLAUDE_PLUGIN_ROOT}/profiles/`). Several profiles can be checked at once,
   e.g. `dataverse-solution power-platform-pcf dataverse-plugins`.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-prereqs.mjs" <profile ...>`.
   - Exit 0: everything required is there (optional tools may still be listed).
   - Exit 1: a required tool is missing or older than its minimum.
   - Node.js missing (the command itself fails): give the Node.js install command for the OS and stop.
3. Report as a short table: tool, found version, needed, status. Then, only for what's missing or
   too old, the install command printed for this OS and the docs link.
4. Don't install system-wide tools yourself unless the owner asks; after they install, ask them to
   open a new terminal (PATH) and run the check again.

Each profile's list is `${CLAUDE_PLUGIN_ROOT}/profiles/<profile>/prerequisites.json`; the
framework's own is `${CLAUDE_PLUGIN_ROOT}/prerequisites.json`. To add a tool, add an entry with
`id`, `name`, `command`, `args`, `pattern` (version in group 1), optional `min`, `required`, `why`,
`install` for windows/macos/linux and `docs`; the self-test checks every entry.
