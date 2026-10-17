# The method

How to build a product with Claude: one **lead** session plans and integrates, **agents** build in
parallel, the **owner** decides and approves. It is a way of working that took a multi-language
product from nothing to live in waves over a few weeks.

New here? Start with [getting-started.md](getting-started.md).

Read in this order the first time; afterwards use it as a reference.

| Topic | File |
| --- | --- |
| **Getting started** (install, first project, FAQ) | [getting-started.md](getting-started.md) |
| Principles and roles | [principles-and-roles.md](principles-and-roles.md) |
| Waves and parallel agents (brief and report format) | [waves-and-agents.md](waves-and-agents.md) |
| The quality gate | [quality-gate.md](quality-gate.md) |
| Release flow | [release-flow.md](release-flow.md) |
| Contracts | [contracts.md](contracts.md) |
| Languages, plurals and vocabulary | [languages.md](languages.md) |
| What's new per release | [whats-new.md](whats-new.md) |
| Polish rounds | [polish-rounds.md](polish-rounds.md) |
| Security review checklist | [security-review.md](security-review.md) |
| Accessibility (WCAG 2.2 AA from day one) | [accessibility.md](accessibility.md) |
| Design systems: one system for every output, light and dark themes | [design-systems.md](design-systems.md) |
| Privacy by design and data sovereignty | [privacy-and-sovereignty.md](privacy-and-sovereignty.md) |
| Testing patterns | [testing.md](testing.md) |
| Operations readiness: monitoring, backups, restore drill, rate limits, load tests | [operations.md](operations.md) |
| Docs: STATE, ROADMAP, runbooks, owner checklists, writing for an audience | [docs-and-writing.md](docs-and-writing.md) |
| Git, GitHub and CI | [git-and-ci.md](git-and-ci.md) |
| Videos | [videos.md](videos.md) |
| Mobile apps | [mobile-apps.md](mobile-apps.md) |
| Dataverse / Dynamics 365 integrations | [integrations-dynamics.md](integrations-dynamics.md) |
| Safety rules | [safety-rules.md](safety-rules.md) |
| Communication with the owner | [communication.md](communication.md) |

Stack-specific scripts (build, database, deploy, smoke test) live in a **profile**:
[`dotnet-react-azure`](../profiles/dotnet-react-azure/) (.NET, React, Azure),
[`dataverse-solution`](../profiles/dataverse-solution/) (a full product on Dataverse / Dynamics
365), [`power-platform-pcf`](../profiles/power-platform-pcf/) (PCF code components) and
[`dataverse-plugins`](../profiles/dataverse-plugins/) (plug-ins and custom APIs). The docs here
are stack-neutral and say "the profile's script" where a profile fills in the detail.

Templates for everything the docs mention are in [`templates/`](../templates/README.md).
