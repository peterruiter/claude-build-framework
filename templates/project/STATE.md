# State

**Read this first when picking the project up again.** The honest record of where the build is,
including what is unproven. Update it with the work, not afterwards.

**Version:** 0.1.0
**Last updated:** {{DATE}}

## Live

| | |
| --- | --- |
| Live version | Not deployed yet |
| Before that | — |

## Honest status

Newest first. Title each section with how far it is proven: `(17 Oct, local only)`,
`(against stand-ins)`, `(live since 18 Oct)`.

### Project set up ({{DATE}}, local only)

- Repository {{GITHUB_URL}} ({{VISIBILITY}}), CI {{CI_STATUS}}.
- Languages: {{LANGUAGE_LIST}} (source {{SOURCE_LANGUAGE}}), in `build/contracts/locales.json`.
- Data residency: {{DATA_RESIDENCY}}.
- Checks: vocabulary checker and contract tests pass ({{TEST_COUNT}} tests).

## The deployment

| | |
| --- | --- |
| App | — |
| Database | — (region, backup retention) |
| Storage | — (region, soft delete) |
| Secrets | — (vault name, region; never values) |
| Sign-in | — |
| Email | — |
| Domain | — |
| Monitoring | — (availability tests, action group) |
| Cost | — per month |

## Data flows

| Data | Stored in | Seen by (service) | Region | Why |
| --- | --- | --- | --- | --- |

## Monitoring and alerts

| Alert | Fires when | What it means | First look |
| --- | --- | --- | --- |

## If production data is lost or corrupted

Who decides, which restore (point in time or long-term copy), how to point the app at it, how to
tell users. Last restore drill: not yet run (date, duration).

## Unproven

| What | What to do first |
| --- | --- |

## The rules that keep this product honest

1. Input is checked on the server, never trusted from the browser.
2. Once means once: a unique key refuses a second.
3. Credentials live in the vault, never in the database or files.
4. Personal data never appears in logs.

## Decisions worth knowing before changing them

| For | Decision | Date |
| --- | --- | --- |
