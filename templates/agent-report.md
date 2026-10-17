# Report: {{ITEM_ID}} {{TITLE}}

## Built
- {{WHAT_USERS_CAN_NOW_DO}}

## Design decisions
- {{DECISION}}: {{WHY}}

## Checks
| Check | Result |
| --- | --- |
| Tests | {{N}} passed, 0 failed |
| Release build (pinned toolchain) | clean |
| Front-end type check and builds | clean |
| Vocabulary checker | no problems, {{LANGUAGE_COUNT}} languages |
| Contract tests | {{N}} passed |
| Accessibility (axe + probes, light/dark, 390/1440) | {{N}} pages, 0 violations outside known.json |
| Screenshots | `{{PATH}}` ({{N}} images), looked at; fixed: {{WHAT}} |
| Not run | {{STEP}}: {{REASON}} |

## Privacy and data residency
- New personal data: {{FIELDS_AND_PURPOSE}}
- Erasure: {{HOW_NEW_TABLES_ARE_COVERED}}
- Logs: {{REDACTION}}
- Residency: no new service outside {{DATA_RESIDENCY}} / {{EXCEPTION_FOR_THE_OWNER}}

## Unverified
- {{e.g. Tested only against the stand-in; not with a real account.}}

## Changed files
- `path/to/file` (new)
- `path/to/other`

## Follow-ups
- {{DECISION_OR_ACTION_FOR_THE_LEAD}}
