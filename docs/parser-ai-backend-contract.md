# parse-ai backend contract

Status: v1 — authored by honeycomb-lead, 2026-07-24.
Supersedes nothing; complements `docs/2026-07-22_ai-gateway-real-ai-activation-handoff_v1.md`
(which remains the launch-day runbook). This document is the NORMATIVE contract
the admin-console backend must implement. The endpoint is deliberately NOT in
this repository (doctrine: no same-origin `/api` here; the retired Next.js app
stays retired — `vercel-track-final` is a donor, not a destination).

## Endpoint

```
POST {apiBase}/workflows/parse-ai
```

Reached exclusively through the admin `ApiService`. The client never uses raw
`fetch`. Headers (added by `ApiService`, authoritative for authorization):

| Header | Meaning |
|---|---|
| `authorization: Bearer <token>` | authenticated admin session |
| `x-organization: <dnsPrefix>` | tenant context — **the** tenancy key; authorize and cache-partition on this, never on body content |
| `x-landjourney-agent: web`, `x-landjourney-app-type: backoffice`, `x-session-id` | platform contract |

## Request

```jsonc
{
  "text": "when a loan is approved, assign to Wael",   // required, author input, UNTRUSTED
  "options": {                                          // ParseOptions — all optional
    "forceEvent": "LOAN APPROVED",
    "assignees": ["Wael", "Omar", "Sara"],
    "instanceOptions": { "template": ["Origination", "..."] },
    "instanceRegistry": { "assign_user": [{ "id": "u-1", "label": "Wael" }] },
    "allowUnbackedValues": true
  }
}
```

Server-side input limits (reject with 400, never truncate silently):
- `text` ≤ 4,000 characters after NFC normalization; control characters
  (C0/C1 except \n\t) stripped; zero-width and bidi-override code points stripped.
- `options` lists: ≤ 200 entries per registry, ≤ 120 chars per label.
- Unknown top-level properties rejected.

## Response — a `ParseResult`, optionally a `ParseEnvelope`

The client shape-guard requires exactly: `rule` (object or null) and arrays
`notes`, `unresolved`, `uncovered`, `ambiguities`. Anything else → the client
silently degrades to the deterministic parser. The additive envelope fields
(`clauses`, `clauseLinks`, `unsupported`, `contradictions`, `suggestions` ≤ 3,
`provenance`, `negatedNoOps`) are OPTIONAL and ignored by older clients.

`provenance` must carry `engine` (`"ai" | "deterministic-fallback"` from the
server's perspective), `parserVersion`, `promptVersion`, `model`, and MUST NOT
carry raw prompts, tenant labels, tokens, or keys. `promptVersion`/`model` are
stamped by server code — never taken from model output.

## Server processing pipeline (normative order)

1. **Authorize** on bearer + `x-organization`. No org header → 401/403.
2. **Sanitize input** (limits above). Tenant vocabulary from `options` is DATA:
   when placed into the prompt it is delimited, listed (≤ 20 items per list, as
   the donor route did), and cleaned of `` ` ``, `$`, `<`, `>` (donor
   `cleanPromptText`). It is never concatenated as instructions.
3. **Structured output**: call the model with a full JSON `responseSchema`
   (donor `PARSE_RESPONSE_SCHEMA` pattern — top-level OBJECT, closed enums where
   possible, nullable rule, bounded arrays), `responseMimeType:
   "application/json"`, low temperature.
4. **Decode defensively**: strip code fences → `JSON.parse` → shape massage
   (donor `massageGeminiRule`: `{key}`→`{event}`, uppercase logic) →
   `normalizeRule` → **allowlist enforcement** (donor `enforceKnownAssignees`
   generalized): every event/field/operator/action key must exist in the
   vocabulary; every entity label must resolve against the request's registries;
   every instance `id` must be registry-backed or it is BLANKED and surfaced as
   an `unresolved` slot. Unknown keys are rejected, not passed through.
5. **Validate + lint**: `validateRule` + `lintRuleIssues`; keep the rule only if
   validation passes and lint has no blocking issues; otherwise `rule: null`
   with explanatory notes and the sidecars intact.
6. **Coverage comparison**: material source clauses that no rule component
   represents must land in `uncovered` — a model omission must never present as
   a complete parse.
7. **One bounded repair**: at most one re-prompt for STRUCTURAL defects (invalid
   JSON/schema). Never re-prompt to fill in missing business intent.
8. **Degrade**: on timeout, quota, retired model, or any unrecoverable defect,
   return the deterministic parser's result for the same `text`/`options`
   (donor `heuristicResponse` pattern) with
   `provenance.engine = "deterministic-fallback"` and a `fallbackReason`.
   The endpoint should answer BEFORE the client's own timeout would fire.

## Model routing (server-only concerns)

- Cloudflare AI Gateway per the 2026-07-22 handoff (§2b): account id + gateway
  id + `cf-aig-authorization`; provider key (`GEMINI_API_KEY`) forwarded via
  `x-goog-api-key`. All of these are server secrets; none may appear in
  responses, logs at info level, or error messages.
- Model chain with per-attempt timeout below the endpoint deadline (donor
  values: 25 s per model, 50 s total, `maxDuration` 60 s). Fall through only on
  model-unavailability classes (404 retired, 429, 503, abort-timeout).
  Pinned model names rot — keep a `-latest` alias last in the chain.

## Rate limiting and caching expectations

- Per-tenant rate limit on this endpoint (suggested: 30/min, 429 with
  `Retry-After`).
- Result caching is OPTIONAL; if present the key MUST be
  `(tenant, parserVersion, promptVersion, hash(text), hash(options),
  vocabularyHash)` and entries must contain no secrets. A cache keyed without
  the tenant is a cross-tenant leak by construction.

## Logging

Allowed: correlation id, tenant key, engine mode, model id, latency stages,
outcome class, token counts. Forbidden in production logs: `text`, tenant
labels, prompts, raw provider responses, keys, bearer tokens.

## What must be implemented in the admin backend (outside this repo)

1. The route handler per the pipeline above (port the donor route; change the
   call site to the gateway; re-read `{text, options}`; return clean
   `ParseResult`/`ParseEnvelope`).
2. Vocabulary fetch for the tenant (templates/forms, products/fields, workflow
   templates, users/teams/stages/authorities/retailers/programs) with the ≤20
   item prompt compaction and the full lists used for allowlisting.
3. Secrets provisioning: `CF_ACCOUNT_ID`, `CF_GATEWAY_ID`, `CF_AIG_TOKEN`,
   `GEMINI_API_KEY`.
4. Rate limiting + redacted logging + correlation ids.
5. (When ghost autowriting goes live-AI) a sibling
   `POST workflows/suggest` endpoint with the same trust pipeline and the ghost
   response contract from `docs/ghost-autowriting-spec.md`; until then the
   client's deterministic ghost path serves alone.

## Example

Request:
```json
{ "text": "when a loan is approved and risk grade is worse than B, assign to Wael, otherwise do nothing",
  "options": { "assignees": ["Wael", "Omar"], "allowUnbackedValues": true } }
```
Response (abridged):
```json
{ "rule": { "schemaVersion": 3,
    "triggers": [{ "event": "LOAN APPROVED" }],
    "conditions": { "logic": "AND", "children": [
      { "field": "risk_grade", "operator": "worse_than", "value": "B" } ] },
    "actions": [{ "action": "assign_user", "params": { "assignee": "Wael" } }],
    "controls": { "mode": "shadow", "oncePerRequest": true, "maxFiresPerHour": 25,
      "missingData": "no_match", "priority": 100 } },
  "notes": ["Event → LOAN APPROVED.", "Otherwise → intentionally no action."],
  "unresolved": [], "uncovered": [], "ambiguities": [],
  "suggestions": ["Consider notifying the assignee's team lead as a second action."],
  "provenance": { "engine": "ai", "parserVersion": "2026.07.24-1",
    "promptVersion": "p1", "model": "gemini-3.5-flash", "generation": 1,
    "createdAt": 0, "latency": { "totalMs": 1830, "stages": { "model": 1600, "normalize": 30 } } } }
```
