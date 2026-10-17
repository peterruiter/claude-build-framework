# Changelog

All notable changes to the `build-framework` plugin. Users receive a new copy only when the
`version` in `.claude-plugin/plugin.json` changes, so bump it with every change worth shipping and
add a section here.

## 0.1.0 (2026-10-17)

First version.

- Plugin and marketplace manifests (`build-framework@pruiter-plugins`), installable from the git
  repository or a local clone.
- The method in `docs/`: principles and roles, waves and parallel agents, the quality gate,
  release flow, contracts, languages and plurals, What's new, polish rounds, security review,
  accessibility (WCAG 2.2 AA from day one), light and dark themes, privacy and data sovereignty,
  testing, operations readiness, docs and writing, git and CI, videos, safety rules,
  communication, and a getting-started guide.
- Skills: new-project, plan-wave, agent-brief, quality-gate, release, whats-new, translate,
  polish-round, security-review, privacy-review, a11y-pass, video-tour, write-docs, status-update,
  owner-checklist, ops-readiness, load-test (plus mobile-app and dataverse-integration).
- Agents: feature-builder, polish-reviewer, security-reviewer, translator, a11y-auditor,
  release-checker.
- Project templates: CLAUDE.md, STATE.md, ROADMAP.md (with Operations readiness), contracts for
  languages, glossary and changelog (with schema), a configurable vocabulary checker with
  data-driven CLDR plural checks, release tagging, plural helper, light/dark tokens with a
  contrast test, stand-in servers, an axe-core page runner, k6 journeys and a test data generator.
- A PreToolUse hook that blocks git commits, pull requests, issues and release notes carrying AI
  attribution, and a `commit-msg` git hook for new projects.
- Profile `dotnet-react-azure` and the `video-tour` tool.
- Self-test (`npm test`) and CI.
