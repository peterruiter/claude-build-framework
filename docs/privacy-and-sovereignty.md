# Privacy by design and data sovereignty

Privacy (GDPR) and data residency are decided **at the start** (`new-project` asks the data
residency question; default EU) and checked **for every feature** (quality gate step 8 and 9,
`privacy-review` skill).

## Privacy by design: per feature

Answer these in the brief and again in the report:

- [ ] **Minimisation**: only the fields the feature needs. No "might be useful later".
- [ ] **Purpose per field**: written down (in the data model docs or the privacy register).
- [ ] **Lawful basis / consent**: where consent is needed (marketing, optional sharing), it is
      asked explicitly, recorded with time and wording, and can be withdrawn.
- [ ] **No personal data in logs or analytics**: redact (URLs to scheme + host, ids instead of
      addresses, no names, no codes or tokens). Analytics cookie-free by default where possible.
- [ ] **Erasure**: "Delete my data" covers **every new table**, files, caches, search indexes,
      external copies (CRM, mailing lists, spreadsheets) and log lines that hold the person. A test
      lists the tables with personal data and fails on a new one that erasure does not handle.
- [ ] **Retention**: how long each kind of data is kept, and a job that deletes it after that.
- [ ] **Small-group suppression** in reports and exports (groups under 5 are not shown alone).
- [ ] **Public surfaces show counts, not names**, unless the person chose to be visible.
- [ ] **Signed, expiring, revocable links** for anything shared by link.
- [ ] **Hashes of personal data are keyed** (HMAC with a secret), never plain hashes.
- [ ] **Secrets** in the vault only ([safety-rules.md](safety-rules.md)).
- [ ] **Export / access request**: the person's data can be exported if the product holds a
      profile.

## Product-level privacy

- A **privacy page** listing: what is collected and why, the processors and sub-processors (name,
  purpose, country/region), where data lives, retention, rights and contact.
- **DPA readiness**: for B2B, a data processing agreement template and the list of
  sub-processors kept current; tell customers before adding one.
- Cookie-free by default where possible; if cookies are needed beyond the strictly necessary, a
  real choice, not a wall.
- A record of processing activities kept with the docs (who, what, why, how long, where).

## Data sovereignty (where possible)

1. **Ask at project start**: data residency requirement (default **EU**; options: EU, a specific
   country, none). Record it in CLAUDE.md and STATE.md.
2. **Regions**: hosting, database, storage, **backups**, **logs/monitoring** and the **key vault**
   all in the chosen region. Note any piece that cannot be (and why) in STATE.md.
3. **AI services**: use EU data zones or regional endpoints (and no-training/no-retention settings
   where offered). Document the endpoint and its data handling.
4. **Providers**: prefer providers established and hosting in the chosen region. When a non-EU
   provider is the right choice, document it and why (and the transfer mechanism) on the privacy
   page.
5. **Data flows**: keep a short table "kind of data → where it is stored → which services see it →
   region". Update it with every integration.
6. **Before adding any service that moves personal data outside the chosen region, stop and ask
   the owner** (multiple choice with the alternatives and their trade-offs). The owner decides; the
   decision goes into ROADMAP.md's Decisions table.

## Data flow table (template)

| Data | Stored in | Seen by (service) | Region | Why |
| --- | --- | --- | --- | --- |
| Account email | Database | Email provider | EU | Sign-in codes, receipts |
