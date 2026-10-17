---
name: privacy-review
description: Privacy-by-design (GDPR) and data-sovereignty review of a feature or the whole product - data minimisation, purpose per field, consent, no personal data in logs or analytics, erasure ("delete my data") covering every table and external copy, retention, small-group suppression, signed links, privacy page with processors and regions, DPA readiness, and data residency (regions for hosting, database, storage, backups, logs, vault, AI endpoints; non-region services flagged for the owner). Use when the user asks about "privacy", "GDPR", "AVG", "data residency", "sovereignty", "where is our data", "delete my data", or before adding an integration or launching.
argument-hint: "[feature or 'product']"
---

# Privacy and sovereignty review

Reference: `${CLAUDE_PLUGIN_ROOT}/docs/privacy-and-sovereignty.md`.

## 1. Inventory

- Data residency from CLAUDE.md (if missing: ask the owner, EU recommended, and record it).
- New or changed tables, columns, files, caches, indexes, log lines and external calls in scope.
- Build or update the **data flow table** in STATE.md: data → stored in → seen by → region → why.

## 2. Per feature checklist

Walk every item of the per-feature checklist in the reference (minimisation, purpose, consent,
logs/analytics redaction, erasure, retention, small groups, counts not names, signed links, keyed
hashes, secrets, export). For each: **yes with evidence (file:line or test)**, **no → finding**, or
**n/a with reason**.

Erasure: find the erasure code and the test that lists personal-data tables; every new table and
every external copy must be covered. If no such test exists, write one.

## 3. Sovereignty

- Every service and endpoint in the flow table: region, provider's establishment, and for AI the
  data zone/regional endpoint and retention/training settings.
- Anything that moves personal data outside the chosen region: **stop and ask the owner** with the
  alternatives (multiple choice, recommendation first, costs and trade-offs). Record the decision
  in ROADMAP.md Decisions and on the privacy page.
- Backups and logs count: check their regions too.

## 4. Product level (when reviewing the product)

- Privacy page: processors/sub-processors with purpose and region, retention, rights, contact.
- DPA template and sub-processor list current; cookie-free by default where possible.
- Record of processing activities present.

## 5. Report

Findings table (`# | Rating H/M/L | Where | Finding | Fix | Test`), the updated data flow table,
decisions needed from the owner. Fix H before release. No real personal data in the report.
