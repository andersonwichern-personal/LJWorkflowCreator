# Codex Support Note: Integration and Parser Upgrade

Date: 2026-07-16

Purpose: support Claude's Integration and Parser upgrade work without touching Claude-owned implementation files.

## Current Coordination Boundary

The live task ledger at `docs/agent/task.md` still marks Phase 14 as Claude-owned and says Codex is autocomplete-only for that phase. Until the ledger changes, Codex should not edit:

- `lib/webhookPipeline.ts`
- `app/api/platform/webhooks/receive/route.ts`
- `app/api/workflows/parse-ai/route.ts`
- `lib/nlParser.ts`
- frontend components or workflow UI files

Codex can safely help by drafting review checklists, standalone fixtures, and assertion plans that Claude can import or copy when ready.

## Integration Contracts To Preserve

From the live admin integration report:

- Production admin shell is Angular, not the Vercel Next.js shell.
- Workflow Creator should attach through a lazy `/workflows` route under the authenticated shell.
- Admin calls must use `ApiService`-backed services, not direct browser `fetch`.
- Required headers are:
  - `authorization: Bearer <token>`
  - `x-landjourney-agent: web`
  - `x-session-id: <session id>`
  - `x-landjourney-app-type: backoffice`
  - `x-organization: <dnsPrefix>`
- Organization context is the active UI configuration DNS prefix, not the prototype `orgId` query-string contract.
- Native UI should use `lj-page`, `lj-box`, `lj-box-row`, `lj-page-heading`, `lj-button`, and existing Material icon patterns.
- Vocabulary sync sources should be:
  - `/documents/templates/forms`
  - `/products/fields`
  - `/workflows/templates`
  - `/workflows/templates/{templateId}`

From the Vercel prototype scan:

- The deployed prototype still uses same-origin Next.js API routes.
- `GET /api/platform/me` returns demo org context.
- Saved rules include both schema v2 and normalized schema v3 shapes.
- `/api/platform/vocabulary` falls back to static data when platform env vars are absent.
- Proposal and authority routes currently expose deployment database gaps.

## Parser Upgrade Guardrails

The parser upgrade should keep these invariants pinned:

- Do not fabricate events outside the verified platform vocabulary:
  - `SYSTEM ERROR`
  - `LOAN APPROVED`
  - `LOAN REJECTED`
  - `OFFER ACCEPTED`
  - `FISERV LOAN`
  - `FMAC LOAN`
- Do not silently coerce unknown assignees, authority names, fields, stages, or actions into valid-looking tokens.
- Unknown or ambiguous natural language must surface through `unresolved`, `uncovered`, or `ambiguities`.
- Parsed rule output must normalize to schema v3:
  - `schemaVersion: 3`
  - `triggers: Array<{ event: string; scope?: string }>`
  - root `conditions` group with `logic` and `children`
  - `actions`
  - optional `else`
  - `controls`
- Legacy v2 rules may exist in storage, but editor/runtime paths should normalize before evaluation or editing.
- LLM parsing must degrade to the deterministic parser when the API key is missing or model calls fail.
- Parser context should distinguish live-confirmed tokens from unconfirmed/gated actions.

## Safe Codex Work Queue

These tasks are isolated enough for Codex once Claude wants them:

1. Draft `scripts/assert-integration-contracts.ts`
   - Assert source strings or exported constants preserve required admin headers.
   - Assert no new integration service uses raw `fetch` where an `ApiService` wrapper is expected.
   - Assert route/nav docs mention `/workflows`, permission mapping, and shell attachment.

2. Draft parser fixture cases as JSON
   - Valid simple trigger/action examples.
   - Multi-trigger examples.
   - Unknown assignee examples.
   - Unknown field examples.
   - Partial-coverage examples where uncovered language must be reported.
   - Legacy v2-to-v3 normalization examples.

3. Draft `scripts/assert-parser-integration.ts`
   - Import only stable parser/normalization utilities after Claude confirms filenames.
   - Test rule schema shape, no fabricated tokens, unresolved handling, and fallback behavior.

4. Draft a fixture file under `docs/data/`
   - `2026-07-16_parser-integration-fixtures_v1.json`
   - Keep it data-only so Claude can consume it without merge pressure.

## Suggested Fixture Cases

```json
[
  {
    "name": "known system error booking status",
    "instruction": "When booking status is Error, assign to Wael",
    "expect": {
      "events": ["SYSTEM ERROR"],
      "conditions": [{ "field": "bookstatus", "operator": "is", "value": "Error" }],
      "actions": ["assign_user"],
      "unresolved": []
    }
  },
  {
    "name": "reject unknown assignee",
    "instruction": "When a loan is approved, assign to Santa Claus",
    "expect": {
      "events": ["LOAN APPROVED"],
      "mustNotContain": ["Santa Claus"],
      "unresolvedIncludes": ["Santa Claus"]
    }
  },
  {
    "name": "partial parse reports uncovered clause",
    "instruction": "When a loan over 250k is approved and DSCR is under 1.2, escalate to committee and request tax returns",
    "expect": {
      "events": ["LOAN APPROVED"],
      "conditions": [{ "field": "loan_amount", "operator": "gt", "value": 250000 }],
      "uncoveredNonEmpty": true
    }
  },
  {
    "name": "multi-trigger approved or rejected",
    "instruction": "When a loan over $500,000 is approved or rejected, notify Sara and add tag jumbo",
    "expect": {
      "events": ["LOAN APPROVED", "LOAN REJECTED"],
      "actions": ["notify", "add_tag"]
    }
  },
  {
    "name": "prototype orgId contract should not leak into admin integration",
    "instruction": "integration-contract",
    "expect": {
      "adminHeader": "x-organization",
      "notAdminHeader": "X-Org-Id",
      "notTenancyPattern": "orgId query string"
    }
  }
]
```

## Handoff Recommendation

If Claude is editing parser/integration files right now, Codex should only prepare the JSON fixtures first. Once Claude marks the implementation complete in `docs/agent/task.md`, Codex can convert those fixtures into executable assertions and wire them into `npm run test`.
