# Security review

Run a review round on **every new surface** (sign-in, tokens, public forms, webhooks, exports,
integrations, file uploads) and after any wave that adds endpoints. Findings are rated **H/M/L**,
fixed **with tests**, and recorded in STATE.md. An outside review is welcome; this list is what
the reviews actually found.

## Checklist (as practised)

### Access and identity
- [ ] **IDOR across tenants/workspaces**: every query is scoped by the caller's tenant; ids from
      the URL or body are never trusted alone. Test: user of workspace A asks for B's id → 404.
- [ ] Roles enforced on the server (not only hidden in the UI); a viewer cannot reach admin APIs.
- [ ] OAuth/sign-in flows: state with a one-time nonce; finished only by whoever started it and
      who still has the right role; a connection disconnected meanwhile gets nothing.
- [ ] Emailed codes: rate-limited per address (codes issued per hour, wrong guesses per hour,
      across all codes), only the newest valid; same answer for every address (no enumeration).
- [ ] Copying/cloning an object copies its **access rules** too (a copy must never be wider open).

### Links and tokens
- [ ] **Signed links**: HMAC, expiry, and revocable through a version counter on the object.
- [ ] Tokens long enough (≥ 32 characters for webhook path tokens); compared in constant time.
- [ ] Inbound webhooks: verify the provider's signature (and timestamp window); look up the
      connection before reading the body; size limit (e.g. 256 KB → 413); idempotent by event id.

### Rate limits
- [ ] Limits are **shared across replicas** (database-backed counters), not per instance memory.
- [ ] IPv6 callers counted by /64.
- [ ] Degrades safely when the counter store is down (log a warning, count locally) rather than
      refusing everybody.

### Browser
- [ ] CSP without `unsafe-inline` scripts; **frame allow-lists** (`frame-ancestors`, `frame-src`)
      explicit per embed feature.
- [ ] Links from user content: `https:`/`mailto:` only; outgoing clients refuse other hosts and
      follow "next" links only on the provider's host.
- [ ] CSV/XLSX exports: cells starting with `= + - @ tab CR` are escaped (formula injection).

### Injection
- [ ] Parameterised SQL everywhere; filters passed to external APIs escaped; ids validated by
      format (GUID, letters/digits) before being put into a host name or filter.
- [ ] HTML output encoded; email templates encoded; markdown sanitised.

### Secrets and logs
- [ ] Secrets only in the vault/secret store; never in the database, files, logs, memory or chat.
- [ ] **Redact URLs in logs to scheme + host**; no tokens, codes or personal data in log lines.
- [ ] Error messages to users never contain stack traces or secrets.

### Demo vs real
- [ ] The demo cannot reach real accounts, real money or real mailboxes.
- [ ] **Never weaken a real rule to make the demo work**; make the demo coherent.
- [ ] Local-only shortcuts (dev sign-in, signature checks off for stand-ins) refuse to start
      outside development.

### Privacy
- [ ] **Small-group suppression** in reports (groups under 5 are not shown on their own).
- [ ] No names where consent is missing; public pages show counts, not names.
- [ ] Hashes of personal data are keyed (HMAC with a per-list key and a platform pepper).
- [ ] **Erasure coverage**: "Delete my data" covers **every new table**, external copies (CRM,
      mailing lists, live copies) and log lines; a test lists the tables and fails on a new one.
- [ ] Data from an external system is erased only by its own id, never by matching an address
      across the tenant.

## Report format

| # | Rating | Where | Finding | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| 1 | H | `POST /api/x/{id}` | Workspace not checked: any signed-in user can read another workspace's x | Scope query by workspace | `X_is_404_for_other_workspace` |

H: exploitable now, data exposure or money. M: needs a precondition or limited impact.
L: hardening. Fix all H before release; M in the same wave where possible; L listed in STATE.md.
