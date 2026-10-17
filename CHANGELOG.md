# Changelog

All notable changes to the `build-framework` plugin. Users receive a new copy only when the
`version` in `.claude-plugin/plugin.json` changes, so bump it with every change worth shipping and
add a section here.

## 0.3.0 (2026-10-17)

- Every profile scaffold takes its look only from the chosen design system (scaffold.ps1
  -DesignSystem <id>): the web app uses the generated tokens and roles with no colour literals of
  its own, PCF controls fall back to the design system's Fluent theme outside Power Apps,
  Dataverse solutions ship the model-driven app theme as a web resource, and contract tests check
  that the generated files match the recorded design system.
- The corporate design system's error text and links on its heavy surfaces now meet 4.5:1 in both
  themes (1.0.1).
- CI generates projects with both design systems.

## 0.2.0 (2026-10-17)

- Profiles for Power Apps component framework (PCF) controls, Dataverse plug-ins and large Dataverse
  solutions, next to .NET + React + Azure; a CI workflow generates a project from every profile and
  runs its own gate on GitHub runners.
- Tools check: every profile lists its tools with minimum versions and install commands per OS;
  new-project and quality-gate check them first; skill check-tools.
- Design systems: design-systems/ with a corporate design system and a neutral default; one generator
  (scripts/design-system.mjs) turns the tokens into CSS (light and dark), TypeScript, a Fluent UI
  theme, a model-driven app theme, email and chart palettes, the video tour brand and an Office
  theme mapping; new-project asks which design system; the quality gate checks contrast in both
  themes; skill design-system.
- A commit guard (plugin hook and a project commit-msg hook) refuses AI attribution lines.

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
