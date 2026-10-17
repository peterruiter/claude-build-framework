# Brief: {{ITEM_ID}} {{TITLE}}

You are building one piece of {{PROJECT_NAME}} in a shared working tree, in parallel with other
agents. Work carefully, stay in scope, and end with the report described at the bottom.

## 1. Context

- Repository: `{{REPO_PATH}}`, branch `{{BRANCH}}`. **Read STATE.md first**, then the files named
  below.
- Stack: {{STACK_SUMMARY_TWO_LINES}}
- Strings live in `{{STRINGS_FOLDER}}`; languages are configured in
  `build/contracts/locales.json` ({{LANGUAGE_COUNT}} languages, source `{{SOURCE_LANGUAGE}}`).
- Data residency: {{DATA_RESIDENCY}}.

## 2. Goal and scope

{{GOAL_IN_USER_TERMS}}

In scope:
- {{SCOPE_BULLET}}

Not in scope: {{OUT_OF_SCOPE}}

Study first (build on what exists, do not replace it): {{FILES_TO_STUDY}}

## 3. Reserved for you

| Resource | Yours |
| --- | --- |
| Migration slot | `{{MIGRATION_SLOT}}` (idempotent; applies on a brand-new database; runs twice cleanly) |
| Scratch database | `{{SCRATCH_DB}}` |
| Ports | `{{PORT_RANGE}}` |
| Scratch folder | `{{SCRATCH_FOLDER}}` |
| Files you own | {{OWNED_FILES}} |
| Shared files you may touch | {{SHARED_FILES}} (small targeted edits only) |

## 4. Rules

- **Every user-facing string in every configured language** (read `locales.json`; do not assume a
  count), with plural forms per CLDR category, against `build/contracts/glossary.json`.
  Accessible names are strings too.
- **WCAG 2.2 AA** for everything you add: keyboard, visible and unobscured focus, labels, contrast,
  24 px targets, reduced motion, `lang`, status messages.
- **Light and dark**: colour tokens only, both themes checked.
- **Privacy by design**: only the fields needed, purpose per field, consent where needed, no
  personal data in logs, "Delete my data" covers every new table, retention stated.
- **Data residency**: do not add a service or endpoint that moves personal data outside
  {{DATA_RESIDENCY}}; if you think one is needed, stop and say so in your report.
- **One What's new entry** in `build/contracts/changelog.json`: the next free id **at the moment
  you write it** (re-read the file first), `release: null`, one sentence per configured language.
- **A short STATE.md section** for your work, honest about what is proven.
- **Other agents work in the same tree.** Small targeted edits in shared files; re-read right
  before each write; never revert, reformat or "fix" someone else's change.
- **No commit, push, deploy or cloud changes.** Never write secrets anywhere.
- **No AI attribution** in any file, code comment, doc or text you write.
- If the shared tree's build is broken by someone else, run your checks in a clean copy
  (`git archive HEAD` plus your changed files) and say so.

## 5. Checks before reporting (report each with numbers)

{{GATE_COMMANDS}}
- `node scripts/check-vocabulary.mjs`
- `node --test "tests/contracts/*.test.mjs"`
- `node tests/a11y/axe-pages.mjs --probes --page {{PAGE_FILTER}}` against your local run
- Privacy checklist answered (docs: privacy-and-sovereignty)

## 6. Screenshots

Playwright screenshots of every page you changed: languages `{{SOURCE_LANGUAGE}}`,
`{{LONGEST_LANGUAGE}}` (longest) and `{{PLURAL_HEAVY_LANGUAGE}}` (plural-heavy, if configured);
widths 390 and 1440; light and dark. Save to `{{SCRATCH_FOLDER}}/screenshots/`. **Look at them**
and fix what they show (overflow, untranslated text, contrast, focus).

## 7. Report (your final message)

- **Built**: what, in user terms.
- **Design decisions**: and why.
- **Checks**: each step above with numbers (`412 passed, 0 failed`); anything not run, with the
  reason.
- **Privacy and residency**: the checklist answers; new tables and how erasure covers them.
- **Unverified**: honestly ("tested only against the stand-in", "no real device").
- **Changed files**: full list, new files marked.
- **Follow-ups**: anything the lead must decide or do.
