---
name: security-review
description: Security review of new or changed surfaces using the framework's checklist as practised - tenant isolation (IDOR), roles on the server, OAuth state and nonces, emailed-code limits, signed expiring revocable links, webhook signatures and size limits, rate limits shared across replicas, CSP and frame allow-lists, CSV formula injection, injection, secrets and URL redaction in logs, demo-vs-real rules, privacy and erasure coverage. Findings rated H/M/L, fixed with tests. Use when the user asks for a "security review", "pen test", "is this safe", or after a wave adding sign-in, tokens, links, webhooks, exports or integrations.
argument-hint: "[scope: feature, endpoints or diff]"
---

# Security review

Checklist: `${CLAUDE_PLUGIN_ROOT}/docs/security-review.md`. Privacy parts:
`${CLAUDE_PLUGIN_ROOT}/docs/privacy-and-sovereignty.md`.

## 1. Scope

- What changed since the last review (`git log`, STATE.md sections since then) and which surfaces
  are new: endpoints, public pages, tokens/links, webhooks in and out, exports, integrations,
  uploads, admin actions.
- For a large scope, split by surface and start `build-framework:security-reviewer` agents in the
  background (read-only), each with its surfaces and the checklist.

## 2. Review

For each surface, walk the checklist and **prove** each point from the code (file and line) or a
test; "probably fine" is not a result. Try the attack in a test where cheap (another tenant's id,
an expired link, a replayed webhook, a formula in a CSV cell).

## 3. Findings

| # | Rating | Where | Finding | Fix | Test |
| --- | --- | --- | --- | --- | --- |

- **H**: exploitable now; data exposure, account takeover or money. **M**: needs a precondition or
  limited impact. **L**: hardening.
- Fix all H before the next release; M in the same wave where possible; list L in STATE.md.
- Each fix comes with a test that fails without it.

## 4. Record

STATE.md section "Security review <date>" with the table, what was fixed (and the tests), and
what is not done. A What's new entry only for user-visible changes (no exploit details).
Never put secrets, tokens or real personal data in the report.
