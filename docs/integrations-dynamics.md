# Dynamics 365 / Dataverse integrations

How a SaaS product connects to a customer's Dynamics 365 (Dataverse) environment and Customer
Insights - Journeys: sign-in model, tokens, Web API patterns, contact and lead matching,
consent, journeys, what to store, how to test, and what needs the owner's (and the customer's)
explicit OK. The [`dataverse-integration`](../skills/dataverse-integration/SKILL.md) skill walks
through building it.

Status note: the patterns below were built and tested against a local Dataverse stand-in.
Points marked **(confirm)** have not yet been seen against a real environment; check them on the
first real sandbox and update this guide.

## 1. Sign-in model

### Recommendation: one multi-tenant app, admin consent, an application user with a custom role

| | Multi-tenant app of the SaaS (recommended) | App registration per customer (fallback) |
|---|---|---|
| Customer's work | Admin consent once; create the application user; assign the role | Register an app, create and rotate a credential, create the application user, assign the role, paste ids and secret into the product |
| Credentials | One, held by the SaaS; can be **secretless** (managed identity as a federated identity credential on the app) or a certificate | One per customer, in your vault; expiries scattered over customers |
| Revocation | Customer disables the application user or deletes the enterprise app | Customer deletes the secret or the app |
| Blast radius | One credential reaches every consenting tenant: protect it accordingly | One credential per tenant |
| Microsoft guidance | The documented S2S pattern for distributed apps | Single-tenant S2S |

Recommend the **multi-tenant app** because it removes the customer's credential management (the
main source of broken connections: expired secrets), keeps no customer-owned secret in your vault,
and gives the customer a clean revoke. Offer **per-customer registration** for customers whose
policy forbids third-party multi-tenant apps; support both behind the same connector.

How it works:

1. Your Entra tenant: an app registration with *Accounts in any organizational directory*.
   Credential: preferably a **federated identity credential trusting the service's user-assigned
   managed identity** (no secret at all); otherwise a certificate (client assertion, RS256,
   `x5t#S256`); a client secret only as a last resort. Complete **publisher verification** so the
   consent screen shows a verified publisher.
2. The customer's Global/Application Administrator grants **admin consent**
   (`https://login.microsoftonline.com/<CUSTOMER_TENANT_ID>/adminconsent?client_id=<CLIENT_ID>&redirect_uri=<YOUR_REDIRECT>`),
   which creates the service principal (enterprise app) in their tenant. For client credentials
   against Dataverse the app needs **no API permission** (no `user_impersonation`, which is
   delegated): access is decided entirely by the application user's security role **(confirm on
   the first customer tenant)**.
3. The customer's environment admin, in the Power Platform admin center (Environment > Settings >
   Users + permissions > Application users > New app user), adds the app by name or client id
   (enterprise apps are found by searching), picks the business unit and assigns a **custom
   least-privilege security role**. Application users need no licence. Ship the role as a small
   **managed solution** containing only that role (Microsoft's suggested way); the application user
   itself cannot be in a solution.
4. The customer enters the environment URL (`https://<ENV>.crm4.dynamics.com`) and their tenant
   id in the product, then **Test connection**.

Delegated OAuth (acting as a signed-in Dynamics user) is the right model only for features that
must run as that person (their own views, their security). For background sync it breaks when the
person leaves, consumes their service protection budget and mixes their audit trail with the
integration's; do not use it for sync.

### The least-privilege role

Build the role from what the product writes, per table, at Organization level (or Business Unit
when the application user's business unit owns the records). Example for an events product:

| Table | Privileges | Why |
|---|---|---|
| Contact | Create, Read, Write, Append, Append To | Match and upsert people |
| Account | Read, Append To | Link a contact to an existing company; never create |
| Note (annotation) | Create, Read, Write, Delete, Append | Timeline notes |
| Lead, Campaign | Lead: Create, Read, Write, Append; Campaign: Read, Append To | Leads with a source campaign |
| Customer Insights - Journeys event tables | Create, Read, Write, Append, Append To; Delete where an undo removes a row | Only when that mode is used |
| Trigger (`msdynmkt_eventmetadata`), Custom API, Custom API Request Parameter | Read | Discover custom triggers |
| Marketing List | Read (and the list member relationship) | Read static lists |

Plus the minimum privileges every role needs (copying App Opener / Basic User is the usual
start). Never ask for System Administrator or System Customizer.

## 2. Tokens

- Client credentials grant to `https://login.microsoftonline.com/<CUSTOMER_TENANT_ID>/oauth2/v2.0/token`,
  `scope=https://<ENV>.crm4.dynamics.com/.default` (the environment's own host; any region:
  `crm`, `crm4`, `crm11`, sovereign clouds have other suffixes).
- Use MSAL (`ConfidentialClientApplication` per tenant authority) unless you need the authority to
  be a local stand-in (MSAL refuses a non-https, non-discoverable authority); a hand-written form
  post is a few lines.
- Cache per (environment, tenant, client, credential hash) until ~5 minutes before expiry; key the
  cache on a hash, never on a secret. On a 401 from Dataverse, forget the token and retry **once**;
  a second 401 marks the connection as needing attention and emails its admins.
- Show Entra's first error line to the admin (AADSTS7000215 bad secret, AADSTS700016 app not in
  tenant / no consent, AADSTS90002 tenant not found), never a credential or a trace id dump.

### Where secrets live

- **Vault only** (Key Vault or equivalent), one secret per connection (a small JSON document), a
  fresh secret name on every replacement, the old one deleted once the new one works.
- The database keeps a **hint** only: "secret set 2026-10-12", a certificate's thumbprint and
  expiry (warn before it expires).
- Request/response logging: host, status, Dataverse error code, elapsed time. Never bodies (they
  hold personal data), never tokens.
- A developer-only sign-in for local runs: the developer's own
  `az account get-access-token --resource https://<ENV>.crm4.dynamics.com --subscription <SUBSCRIPTION_ID>`
  token, offered only when the host is Development, never on a deployment.

## 3. Web API patterns

Base: `https://<ENV>.crm4.dynamics.com/api/data/v9.2/`, headers `OData-MaxVersion: 4.0`,
`OData-Version: 4.0`, `Accept: application/json`, a recognisable `User-Agent`.

### Probe first, then write

The **Test connection** call reads, and stores on the connection:

- `WhoAmI` (sign-in works, organisation id), `RetrieveVersion()`.
- `EntityDefinitions?$select=LogicalName,EntitySetName&$filter=...` for the tables you use (which
  exist, their entity set names).
- Per table: attributes (`IsValidForCreate`, `IsValidForUpdate`, type, `MaxLength` via the
  `StringAttributeMetadata`/`MemoAttributeMetadata` casts) and `ManyToOneRelationships`
  (`ReferencingEntityNavigationPropertyName`) so `@odata.bind` uses the environment's real,
  case-sensitive navigation property names, never a guess.
- Optional modules (Customer Insights - Journeys tables, triggers): offer a mode only if its tables
  are there. Mappings are validated against real columns and truncated to real lengths.

### Reading

- Always `$select`; `$filter` literals with single quotes doubled; `$expand` single-valued
  navigation properties sparingly.
- **Paging:** `Prefer: odata.maxpagesize=<n>` (max 5,000); follow `@odata.nextLink` **unchanged**
  until it is absent. No `$skip` in Dataverse; do not combine `$top` with paging. Order
  deterministically.
- **FetchXML** (`?fetchXml=` URL-encoded) for aggregates and outer joins, with paging cookies for
  large sets.
- **Reading changes back:** change tracking (`Prefer: odata.track-changes`, then the
  `@odata.deltaLink`) needs Track changes enabled on the table (a schema change: the customer's
  decision) and forbids `$filter/$orderby/$expand/$top`; otherwise a `modifiedon` watermark with
  overlap and idempotent processing.
- Formatted values for display: `Prefer: odata.include-annotations="OData.Community.Display.V1.FormattedValue"`.

### Writing

- **Records the SaaS owns** (notes, registrations, check-ins): a **deterministic id** (UUID v5 of
  workspace, environment host, kind, source id), written with `PATCH <set>(<id>)`, which is an
  upsert. A create whose answer was lost becomes an update; a re-created connection finds its
  records. This needs no schema change, unlike alternate keys.
- **Alternate keys** (`PATCH <set>(key1=...,key2=...)`) when the customer is willing to add a key
  to their table (schema change, their decision; key indexes build asynchronously). Do not repeat
  key values in the body.
- `If-None-Match: *` = create only (412 if it exists): records that belong to humans after
  creation, such as a **lead**. `If-Match: *` = update only (404 if gone): never resurrect a
  record somebody deleted.
- **Optimistic concurrency:** read the `@odata.etag`, send `If-Match: <etag>` when you update
  fields that people also edit; on 412 (`0x80060882`) re-read and decide.
- Send only changed columns (unchanged values still fire plug-ins, flows and audit). When setting
  `statecode`, set `statuscode` too.
- Lookups: `"<navigationProperty>@odata.bind": "/<entityset>(<id>)"`.
- New contacts with `MSCRM.SuppressDuplicateDetection: false` so the environment's duplicate
  detection rules apply.
- **`$batch`** for backfills: independent requests (no change set) with
  `Prefer: odata.continue-on-error`, so one refusal does not stop the rest; at most 1,000 requests
  per batch, but Microsoft recommends small batches (start at 10, the integration used 50) with
  parallelism over big batches, because batches add execution time. Use a change set only for
  writes that must succeed or fail together. A 429 on the batch fails all its rows the same way.

### Errors, retries and service protection

| Answer | Meaning | Action |
|---|---|---|
| 400 | Bad column, value or binding | Dead letter at once with Dataverse's message (it will fail again) |
| 401 | Token expired or app user disabled | Renew once; then "needs attention" + admin email |
| 403 | Missing privilege (the message names it) | Show it; the customer fixes the role |
| 404 | Record or table gone | Per operation: re-create (upsert) or stop (`If-Match`) |
| 412 | Precondition (`If-Match`/`If-None-Match`) | Expected for create-only/update-only; re-read for ETags |
| 429 | Service protection | Pause the **whole connection** for `Retry-After`; not counted as an attempt |
| 5xx, timeout | Transient | Retry with backoff |

Error codes worth knowing: `0x80040237` duplicate key (your earlier create landed: switch to
update), `0x80040333` duplicate detection rule (a human merges; Microsoft's pages show it with
HTTP 412 and with 500, so key on the code, not the status), `0x80040217` not found,
`0x80060882` ETag mismatch.

Service protection limits are **per user (the application user), per web server**: 6,000
requests and 20 minutes of execution time in a sliding 5-minute window, and 52 concurrent
requests. All replicas of your service share that one user, so cap concurrency per connection
across replicas (4 per replica was plenty), honour `Retry-After` connection-wide, ramp up rather
than burst. Requests also count toward the customer's Power Platform request capacity (24-hour
entitlement), which batching does not avoid; tell the customer roughly how many requests a sync
costs.

Retry schedule that worked: 8 attempts over about a day (30 s, 2 min, 10 min, 30 min, 2 h, 6 h,
12 h, jittered), then a dead letter with Dataverse's last message, "Sync again" per record and
"Retry all failed" per connection.

## 4. Sync engine shape

- **One row per record, not per change** (outbox and the record's CRM id in one table): a change
  bumps a version; a worker writes the record's current state, so a register-rename-cancel in a
  minute is one write. A change during a write is written after.
- Capture with in-request hooks **and** a periodic sweep on `UpdatedUtc`/watermarks for anything
  hooks miss.
- Claim rows across replicas with an app lock / `READPAST`, one person's rows never in parallel,
  dependencies first (contact before the registration that refers to it).
- Backfill ("send everything now") in chunks with a cursor and a lease, so a dying replica leaves
  the rest to another; progress visible.
- A connector interface per CRM (probe, write, lookup, record link) so the engine is CRM-neutral.

## 5. Contacts, leads and dedupe

- **Match before create:** by email across `emailaddress1`, `emailaddress2`, `emailaddress3`,
  active before inactive, the oldest of several. Keep the matched `contactid` and use it from then
  on (re-check it still exists).
- An **inactive** match: refuse and say "reactivate or merge in Dynamics"; never create a second
  contact.
- A **duplicate detection** refusal (`0x80040333`): report it for a human to merge; never work
  around it.
- **Never overwrite or empty** what Dynamics holds: write a mapped column only when Dynamics' value
  is empty, unless the mapping row explicitly says "replace".
- **Accounts:** link the contact to the account of exactly that name only when there is exactly
  one active match, never create accounts, never replace an account somebody chose.
- **Contact or lead:** people who registered or bought are contacts; prospects captured for sales
  (badge scans, enquiries) are leads, created once (`If-None-Match: *`), linked to the contact and
  a campaign when known, then owned by sales (a qualified lead cannot be updated anyway).
- Standard columns first (`leadsourcecode`, `leadqualitycode`), only if their option values exist
  in this environment (choices are customisable).
- Mark what you create: `Created by <PRODUCT>` in a description or note footer.

## 6. Consent and opt-outs

- **Roles:** the customer is the controller, the SaaS the processor; the connection is the
  customer's instruction. Before anything syncs, an admin confirms their privacy notice says the
  data goes to their CRM; record who confirmed. Optionally gate sync on a consent question per
  event/form.
- **Do not set marketing consent implicitly.** Customer Insights - Journeys evaluates
  **contact point consent** (`msdynmkt_contactpointconsent4`: per email/phone, per purpose and
  topic, within a compliance profile); by default it does **not** evaluate the contact's
  `donotemail`/`donotbulkemail` fields. Write contact point consent only if your product is
  where the person actually gave consent, the customer agrees, and you map to their compliance
  profile, purpose and topic.
- If your product also sends marketing itself, read opt-outs back (contact point consent, or the
  legacy fields when the customer uses them) and never re-add an opted-out person.
- **Erasure:** when a person asks your product to delete their data, stop syncing them and mark
  their rows erased; deleting the CRM record is the controller's decision (offer a list or a
  webhook, do not delete in their CRM on your own).
- Never send excluded populations (crew, unnamed seats) and send only the fields the customer
  mapped.

## 7. Customer Insights - Journeys

### Custom triggers for event-driven journeys

- Marketers create the trigger in Customer Insights - Journeys (Engagement > Triggers, "When a
  customer interacts with a website/app"), define attributes, and finish it until **Ready to use**.
- Discover them: `msdynmkt_eventmetadataset?$filter=msdynmkt_state eq <ReadyToUse>` (the
  integration used `534120002` **(confirm)**) with `_msdynmkt_customapiid_value`, then
  `customapis(<id>)?$expand=CustomAPIRequestParameters($select=uniquename,type,isoptional)` for
  the attributes. Offer only ready triggers; let the customer map each attribute.
- Fire one as an **unbound action** named after the custom API:
  `POST /api/data/v9.2/<trigger_uniquename>` with the attributes plus
  `msdynmkt_signalingestiontimestamp`, `msdynmkt_signaltimestamp`, `msdynmkt_signaluserauthid`
  and `msdynmkt_profileid` (the contact id: the trigger's "Customer data"), and
  `msdynmkt_bindingid` (one per instance, e.g. per registration, so a later "cancelled" signal
  ends only that instance's journey). Compare with the code snippet the trigger page generates
  **(confirm)**.
- **Every attribute needs a value**: a missing text is sent as empty text, not omitted.
- Fire each signal once per record and signal (remember the last signal sent).
- Do not put unvalidated free text into attributes that personalise emails.
- Prefer the out-of-the-box **business triggers** on Dataverse record changes (contact created,
  marketing event registration created, ...) when your sync already writes those records; use a
  custom trigger when the signal has no record of its own.

### Marketing lists and segments

- **Static marketing lists** (`lists` with `type eq false`, `createdfromcode eq 2` for contacts):
  read members via `lists(<id>)/listcontact_association` with paging; add members with the
  `AddMemberList` / `AddListMembersList` actions (these need Dynamics 365 Sales in the
  environment; probe before offering).
- **Dynamic marketing lists** are a saved FetchXML query Dynamics evaluates; do not re-run the
  customer's query in your product, and say so in the UI.
- Real-time journeys target **segments**, not marketing lists. If the customer wants "everyone who
  registered" as a journey audience, give them a trigger or a column to segment on rather than
  maintaining a list.

## 8. Deep links back into Dynamics

`https://<ENV>.crm4.dynamics.com/main.aspx?appid=<APP_ID>&pagetype=entityrecord&etn=<table>&id=<guid>`

Use the logical name (`etn`), never the type code (`etc`). `appid` (or `appname`) opens the right
model-driven app; without it the user lands in their default app. Show the link next to each
synced record and in the sync log. Links never bypass security.

## 9. What to store

| Store | Never store |
|---|---|
| Per connection: environment URL, tenant id, sign-in kind, vault secret name, credential hint and expiry, status (active, paused, needs attention, disconnected), paused-until, probe result (tables, entity sets, columns, navigation properties, triggers, version), mapping and options, who confirmed the privacy notice | Secrets or tokens in the database or logs |
| Per synced record: kind, source id, CRM table and id, version, attempts, next attempt, last error, last signal | Copies of CRM data beyond what the sync needs |
| A sync log (each attempt, status, Dataverse error code), purged after ~30 days | Request or response bodies |

Disconnect: stop at once, cancel waiting rows, delete the vault secret; keep the log until purge.

## 10. Testing

- **Stand-in** ([testing.md](testing.md); template [`templates/project/tests/standins/dataverse.mjs`](../templates/project/tests/standins/dataverse.mjs) with its `node --test` file): a small local server answering like the token service
  and the Web API: client credentials grant, `WhoAmI`, `RetrieveVersion`, metadata (entity sets,
  attributes with lengths, relationships), GET by id and `$filter`, POST with a chosen id, PATCH
  as upsert with `If-Match`/`If-None-Match`, DELETE, an unbound action for triggers, `$batch`, and
  validation like Dataverse's (unknown column, too long, bad binding, missing record). Controls:
  throttle the next N calls with `Retry-After`, fail the next N writes, expire all tokens, dump
  state, a `main.aspx` page for deep links. Flags to run without optional modules. A C# (or other)
  fake `HttpMessageHandler` twin for unit tests.
- **Unit and database tests:** matching on all address columns, inactive and duplicate refusals,
  no overwrite without "replace", account only when unique, lost create becoming update, lead
  once, token renewed once, 429 pausing without counting, batch with one refused row, concurrency
  cap, no secret in any log line or response.
- **A real sandbox** before the first customer, with the owner's explicit OK for its scope:
  - Prefer a dedicated sandbox or trial environment; if the owner offers a real one, agree the
    scope in writing first (e.g. "at most 50 clearly marked test records and one test custom
    trigger, all removed afterwards; no schema, solution, security role or app registration
    changes").
  - Token for a local run: the developer's own
    `az account get-access-token --resource https://<ENV>.crm4.dynamics.com --subscription <SUBSCRIPTION_ID>`
    (always pass the subscription; never switch the owner's default account or `pac` profile).
  - Marked records: a run id in every created record (`lastname` suffix `[TEST <RUN_ID>]`,
    `test+<RUN_ID>@example.com`, `Created by <PRODUCT> test run <RUN_ID>` in the description), a hard cap
    in the test code, every created id recorded.
  - Order: probe (modes found and not found) > a contact matched, none duplicated > timeline note
    > lead with source and rating > deep link opens the record > a ready custom trigger fired.
  - **Clean up by recorded ids** (not by a query that could hit real data), verify zero remain,
    report what was created and removed.
  - Things only a real environment proves: navigation property names, required columns on create
    in optional modules, duplicate detection's real answer, `$batch` responses with change sets,
    a custom trigger's real request shape, throttling behaviour, admin consent and a certificate
    in a customer tenant.

## 11. Owner and customer approval boundaries

Ask first, every time, and record the answer ([safety-rules.md](safety-rules.md)):

- Any read or write against a real environment (name it, the scope, the cap, the cleanup).
- Schema changes: tables, columns, alternate keys, enabling change tracking, option values.
- Importing or changing solutions, security roles, application users, app registrations,
  consent grants, duplicate detection rules, compliance profiles, journeys or triggers.
- Writing consent records, deleting any record you did not create in this run.
- Switching the active `az`/`pac` account or profile.

Never paste or ask for secrets in chat; the owner or customer puts them in the vault or the
product's credential form.

## Sources (Microsoft Learn)

- Multi-tenant S2S: <https://learn.microsoft.com/power-apps/developer/data-platform/use-multi-tenant-server-server-authentication>
- Single-tenant S2S: <https://learn.microsoft.com/power-apps/developer/data-platform/use-single-tenant-server-server-authentication>
- Application users: <https://learn.microsoft.com/power-platform/admin/manage-application-users>
- Security roles: <https://learn.microsoft.com/power-platform/admin/create-edit-security-role>
- App trusting a managed identity (secretless): <https://learn.microsoft.com/entra/workload-id/workload-identity-federation-config-app-trust-managed-identity>
- Admin consent URL: <https://learn.microsoft.com/entra/identity/enterprise-apps/grant-admin-consent>
- Service protection limits: <https://learn.microsoft.com/power-apps/developer/data-platform/api-limits>
- Request limits and allocations: <https://learn.microsoft.com/power-platform/admin/api-request-limits-allocations>
- Upsert: <https://learn.microsoft.com/power-apps/developer/data-platform/use-upsert-insert-update-record>
- Conditional operations (If-Match, ETags, limit upsert): <https://learn.microsoft.com/power-apps/developer/data-platform/webapi/perform-conditional-operations-using-web-api>
- `$batch`: <https://learn.microsoft.com/power-apps/developer/data-platform/webapi/execute-batch-operations-using-web-api>
- Paging: <https://learn.microsoft.com/power-apps/developer/data-platform/webapi/query/page-results>
- Change tracking: <https://learn.microsoft.com/power-apps/developer/data-platform/use-change-tracking-synchronize-data-external-systems>
- Query metadata: <https://learn.microsoft.com/power-apps/developer/data-platform/webapi/query-metadata-web-api>
- Duplicate detection with the Web API: <https://learn.microsoft.com/power-apps/developer/data-platform/webapi/manage-duplicate-detection-create-update>
- Custom triggers: <https://learn.microsoft.com/dynamics365/customer-insights/journeys/real-time-marketing-custom-triggers>
- Triggers overview (business triggers): <https://learn.microsoft.com/dynamics365/customer-insights/journeys/real-time-marketing-triggers>
- Consent and compliance profiles: <https://learn.microsoft.com/dynamics365/customer-insights/journeys/real-time-marketing-compliance-settings>
- Creating consent records: <https://learn.microsoft.com/dynamics365/customer-insights/journeys/consent-record-creation>
- URLs for apps, forms and views: <https://learn.microsoft.com/power-apps/developer/model-driven-apps/open-forms-views-dialogs-reports-url>
