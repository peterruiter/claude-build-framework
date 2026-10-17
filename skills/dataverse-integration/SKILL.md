---
name: dataverse-integration
description: Build a sync from a SaaS product to customers' Dynamics 365 / Dataverse environments and Customer Insights - Journeys (multi-tenant app with admin consent and an application user, Web API upserts, contact matching, leads, timeline notes, custom triggers, marketing lists, deep links), tested against a stand-in and a marked sandbox. Use when the owner asks for a Dynamics 365, Dataverse, Power Platform or Customer Insights - Journeys integration.
---

# Build a Dataverse / Dynamics 365 integration

The guide is [`docs/integrations-dynamics.md`](../../docs/integrations-dynamics.md): read it
first; this skill is the order of work. Plan it as a wave
([waves-and-agents.md](../../docs/waves-and-agents.md)); the engine, the connector, the stand-in
and the admin UI can be parallel agents once the contracts (tables, connector interface, setting
names) are written.

## 1. Ask the owner (one message, numbered, each with a recommendation)

1. **What flows, which way:** which product records become which Dataverse rows (contacts,
   leads, notes on the timeline, Customer Insights - Journeys event tables, custom triggers), and
   whether anything is read back (static marketing lists, opt-outs). Default: one way, product to
   Dynamics, plus reading static lists if asked.
2. **Sign-in model:** recommend the product's own **multi-tenant app** with admin consent and an
   application user with a custom least-privilege role; keep **per-customer app registration**
   (certificate preferred) as a fallback. Ask whether the service can use a managed identity as
   a federated credential (secretless) or needs a certificate.
3. **Which Entra tenant hosts the multi-tenant app**, who registers it, who completes publisher
   verification. (The owner does this; you prepare the steps.)
4. **Matching rules:** contacts matched by email (all three columns, active first); never
   overwrite non-empty CRM fields unless mapped "replace"; link accounts only on a unique exact
   name; never create accounts. Confirm or adjust.
5. **Consent:** the customer confirms their privacy notice before anything syncs; gate on a
   consent question or not; never write marketing consent unless the product is where consent is
   given and the owner decides to write contact point consent records.
6. **Journeys:** custom triggers wanted, for which signals (registered, cancelled, checked in,
   lead captured, ...), or are out-of-the-box business triggers on the synced records enough?
7. **A real environment for testing:** which one (prefer a dedicated sandbox/trial), the scope
   (record cap, one test trigger), and the confirmation that no schema, solution, security role
   or app registration changes are allowed without a separate OK.

Record the decisions in STATE.md and the wave in ROADMAP.md.

## 2. Contracts and data model

- Tables: connection (per workspace/tenant and environment: URL, tenant id, sign-in kind, vault
  secret name, hint and expiry, status, paused-until, probe result JSON, settings/mapping JSON,
  privacy confirmed by/at), sync item (one row per record: kind, source id, CRM table and id,
  version, claimed version, attempts, next attempt, last error, last signal), per-event/scope link
  (included, linked CRM event, campaign, consent question, chosen sponsors or sources), backfill
  cursor, sync log (30 days).
- Connector interface (CRM-neutral): `Probe`, `Write(rows) -> results (Synced | Retry | Throttled(RetryAfter) | Refused)`,
  `Lookup` (events, campaigns, lists), `RecordLink`, default mapping, own columns. Never throw for
  an answer the CRM gave.
- Settings: login base URL (stand-in on a laptop), platform client id, vault secret names. Add
  them to the settings contract ([contracts.md](../../docs/contracts.md)).

## 3. Build, in this order

1. **Domain rules without network:** environment URL validation (Dataverse hosts incl. sovereign
   clouds, https, no path), Web API root (`/api/data/v9.2/`), token scope (`https://<ENV>/.default`),
   OData literal escaping, error parsing (code, message), `$batch` writer and reader (with change
   sets read through), deterministic ids (UUID v5 of workspace, host, kind, source id), record
   deep link (`main.aspx?appid=...&pagetype=entityrecord&etn=...&id=...`). Unit tests.
2. **Tokens:** client credentials (secret, certificate assertion with `x5t#S256`, platform app,
   developer `az` token in Development only), cache by hash until 5 minutes before expiry,
   forget on 401 and retry once, Entra's first error line to the UI.
3. **Probe:** `WhoAmI`, `RetrieveVersion()`, entity sets, attributes with writability and max
   length, many-to-one navigation property names, ready custom triggers and their parameters;
   modes offered only when their tables exist.
4. **Writes:** contact match-then-upsert with duplicate detection on, account link when unique,
   notes and owned records by `PATCH` to deterministic ids, leads create-only (`If-None-Match: *`),
   updates with `If-Match: *` (or the ETag where people edit the same fields), statecode with
   statuscode, custom triggers as unbound actions with every attribute filled.
5. **Engine:** hooks plus sweep, claim across replicas (one person's rows serial, dependencies
   first), retry schedule with dead letter, 429 pausing the connection for `Retry-After`,
   concurrency cap per connection, backfill in `$batch` (independent requests,
   `Prefer: odata.continue-on-error`, small batches), disconnect.
6. **Admin UI** in every configured language: connection wizard (environment, sign-in with the
   admin consent link for the platform app, test showing the modes found, what syncs, mapping
   validated against real columns, which events/scopes, privacy confirmation), connection page
   (status, log, retry failed, replace credentials, certificate expiry), per-record line with
   "Open in Dynamics" and "Sync again", and a "How to connect" help drawer listing the exact
   role privileges and Power Platform admin center steps.
7. **Alerts:** email the workspace admins once when the CRM refuses the sign-in after renewal.

## 4. Test

- **Stand-in** first: copy [`templates/project/tests/standins/dataverse.mjs`](../../templates/project/tests/standins/dataverse.mjs) and its test to `tests/standins/`, extend it with your tables (pattern in
  [testing.md](../../docs/testing.md)): token endpoint, metadata, CRUD with upsert and conditional
  headers, unbound actions, `$batch`, Dataverse-like validation, controls for throttle, failures,
  token expiry and state. A fake HTTP handler twin for unit tests.
- Unit and database tests from the guide's list. Browser checks of the wizard and connection page
  at desktop and phone widths, light and dark, in two languages.
- Report as **"verified only against the stand-in"** until a real environment has run.
- **Real sandbox** only with the owner's explicit OK for that environment and scope: token via
  `az account get-access-token --resource https://<ENV>.crm4.dynamics.com --subscription <SUBSCRIPTION_ID>`
  (never switch the default account or `pac` profile), marked records with a run id and a hard
  cap, every created id recorded, the check order from the guide, cleanup by recorded ids, a count
  of zero afterwards, and a short report of what was created and removed.

## 5. Owner checklist (give it, do not do it)

- Register the multi-tenant app (or decide not to), add its credential (federated managed
  identity or certificate) and put any secret in the vault under the agreed name; set the client
  id setting.
- Publisher verification.
- Package the least-privilege role as a managed solution for customers (optional but
  recommended).
- For each customer: admin consent link, application user with the role, environment URL and
  tenant id into the product, Test.

## 6. Record

STATE.md: what was built, modes, what ran where, and an Unproven table (real environment,
navigation property names, required columns in optional modules, duplicate detection's real
answer, `$batch` with change sets, a real custom trigger, throttling, admin consent and a
certificate in a customer tenant). Update the guide's **(confirm)** marks when they are proven.
What's new entry per release in every language.

## Rules

- No real environment calls, schema/solution/role/app-registration/consent changes, or deletes of
  records you did not create, without the owner's explicit go for that exact action.
- No secrets in code, logs, chat, commits or reports; vault only. Log host, status, error code.
- Placeholders in anything shared: `<ENV>.crm4.dynamics.com`, `<TENANT_ID>`, `<CLIENT_ID>`.
- No AI attribution anywhere.
