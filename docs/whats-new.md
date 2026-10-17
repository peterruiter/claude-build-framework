# What's new (changelog per release)

**Standing rule: every release adds its user-visible changes to What's new**, one sentence each,
in every configured language. A release without entries is noticed by a test.

## The contract

`build/contracts/changelog.json` (template and schema in
[`templates/project/build/contracts/`](../templates/project/build/contracts/)):

```json
{
  "contract": "changelog",
  "areas": ["app", "website", "platform"],
  "entries": [
    { "id": 12, "date": "2026-10-17", "release": null, "area": "app",
      "text": { "en": "You can now copy a booking to start the next one.", "nl": "…" } }
  ]
}
```

- **id**: one higher than the highest so far; **never reused** (the app may store "seen up to").
  Re-read the file right before choosing it: other agents add entries too.
- **date**: `yyyy-MM-dd`, the day it was built; set to the release day when tagged.
- **release**: `null` until released, then the release version (`0.4.0`, or an image tag).
- **area**: one of `areas` (the project chooses them).
- **text**: one plain sentence per configured language, ending with punctuation. No internal
  names, ticket numbers, migration numbers or jargon. Say what the user can now do or will notice.
- Newest first in the file.

## Who writes entries

- Each agent adds **one** entry for its feature (`release: null`).
- The lead checks at release time that every user-visible change has an entry, and adds missing
  ones.

## Tagging at release

```
node scripts/release-tag.mjs --release 0.4.0 --from 181 --to 184 [--date 2026-10-17]
node scripts/release-tag.mjs --release 0.4.0 --untagged
```

Then commit the changelog with STATE.md (see [release-flow.md](release-flow.md)).

## Tests

`tests/contracts/changelog.test.mjs`: every entry has every configured language and nothing else,
unique positive ids, valid area, valid date, `release` null or matching the release pattern, one
sentence. A project can add: "the newest entry is not older than the live release recorded in
STATE.md".
