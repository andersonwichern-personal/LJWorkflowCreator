# Parser AI Engine — operations runbook

Status: v1 — authored by reliability-observability-engineer, 2026-07-24.
Companion to `docs/parser-ai-engine-architecture.md` (frozen contracts),
`docs/parser-ai-backend-contract.md` (server-side policies this runbook's client
behavior mirrors), and `docs/2026-07-22_ai-gateway-real-ai-activation-handoff_v1.md`
(server launch-day runbook). Reliability primitives referenced here live in
`packages/workflow-brain/src/observability.ts` and are pinned by
`core-tests/assert-brain-observability.ts`.

## Configuration

**Client (this repo).** One switch: `APP_CONFIG` (`src/app/shared/app-config.ts`).

| Field | Mock mode | Live mode |
|---|---|---|
| `apiBase` | `""` | e.g. `https://api-test.landjourney.ai` |
| `token` | `""` | bearer token from an authenticated admin session |
| `organization` | seeded demo prefix | the UI-configuration `dnsPrefix` (sent as `x-organization`) |

`isMockMode()` is true when `apiBase` or `token` is empty. In the admin monorepo
the token disappears — the shell provides `ApiService` + org context. There are
NO provider credentials in this repo, by doctrine: the browser never holds them.

**Server (admin backend, outside this repo).** Secrets per
`docs/parser-ai-backend-contract.md` §"Model routing": `CF_ACCOUNT_ID`,
`CF_GATEWAY_ID`, `CF_AIG_TOKEN` (Cloudflare AI Gateway), `GEMINI_API_KEY`
(provider key, forwarded by the gateway via `x-goog-api-key`). None of these may
appear in responses, info-level logs, or error messages.

## No-key behavior (expected, not an incident)

With zero provider configuration the product is fully functional:

- **Mock mode** (`isMockMode` true): `DraftEngineService.draft()`
  (`src/app/features/workflows/data/draft-engine.service.ts`) short-circuits to
  the local deterministic `parseInstruction` — no request leaves the browser.
  Deterministic, replayable, byte-stable.
- **No-transport mode** (Brain composition): `BrainPorts.aiParse` undefined
  (`packages/workflow-brain/src/ports.ts`) means the orchestrator runs
  deterministic-only. Same envelopes, same gates, `provenance.engine =
  "deterministic"`. A missing `parse-ai` capability (`HostCapabilityPort`) has
  the same effect — fail closed, never escalate.

If a report says "AI suggestions stopped", check these two switches before
anything else: it is usually configuration, not an outage.

## Provider outage (model down, quota, 5xx)

**What users see:** deterministic drafts, instantly. Nothing blocks, no spinner
waits on the model. The composer's honesty sidecars still gate readiness.

**Mechanics:** the backend degrades per contract §8 (returns the deterministic
result with `provenance.engine = "deterministic-fallback"` and a
`fallbackReason`), answering before the client's own timeout. If the backend
itself fails, the client's shape-guard-else-fallback in `DraftEngineService`
produces the same outcome locally. `classifyForRetry` returns `retry: false`
for EVERY class — `timeout`, `aborted`, `transport`, `shape`, `rate-limit` —
retries belong to the server's model chain; the client's one bounded "repair"
re-prompt (structural defects only) is orchestrator-owned and is not a retry.

**fallbackReason taxonomy** (telemetry dimension, allowlisted enum tokens):
`timeout`, `rate-limit`, `transport`, `shape`, `aborted`, `model-retired`,
`circuit-open`, `no-transport`. Watch the `engine=deterministic-fallback` rate;
a sustained spike with reason `transport` or `timeout` = provider incident.

**Circuit breaker** (`makeCircuitBreaker`): 3 failures within 30 s → `open`
(requests skipped entirely, fallback served, reason `circuit-open`); after 60 s
cooldown → `half-open`, exactly one probe; probe success closes, probe failure
re-opens with a fresh cooldown. Fully deterministic against the injected
`BrainClock`, so incident timelines are replayable in tests.

## Gateway outage (Cloudflare AI Gateway down)

Client behavior is IDENTICAL to a provider outage — the client cannot and need
not distinguish them; both surface as backend fallback or transport failure,
and the same breaker/fallback path serves. Server-side diagnosis belongs to the
admin backend: see the 2026-07-22 handoff §2b (gateway URL shape, `cf-aig-
authorization`, gateway analytics showing model/tokens/latency). If the gateway
is degraded but the provider is healthy, the backend may temporarily route
direct at its own discretion — invisible to this client either way.

## Model retirement (the donor lesson)

The retired Vercel track's hard lesson: pinned model names rot. A retired model
returns 404 and, without a chain, took the whole AI path down. Mitigations now
contractual (`docs/parser-ai-backend-contract.md` §"Model routing"):

- a model CHAIN with per-attempt timeouts, falling through on 404/429/503/abort;
- a `-latest` alias LAST in the chain so retirement degrades, never breaks;
- model ids live in the admin backend's chain configuration — never in this
  repo, never in client code, never taken from model output (`provenance.model`
  is stamped server-side).

**Symptom:** `fallbackReason=model-retired` (or sustained `transport`) while the
gateway itself is healthy. **Fix:** update the backend chain; no client deploy.

## Latency spike

**Signals:** the `latencyBucket` telemetry dimension (`lt100 | lt500 | lt2000 |
lt8000 | gte8000` — buckets only, raw ms never leaves the client) shifting
right; `provenance.latency.stages` showing WHERE (e.g. `model` vs `normalize`
vs `ground`) via `makeStageTimer`.

**Budgets (donor-calibrated):** ~25 s per model attempt, ~50 s total server
budget, endpoint deadline 60 s — the server must answer (with fallback if
needed) BEFORE the client gives up. The deterministic parser itself is not a
suspect until proven: the perf gate in `assert-brain-observability.ts` measures
`parseInstruction` p50/p95 every run (last measured p95 ≈ 0.1 ms against a
250 ms gate; product target < 100 ms).

**What to tune, in order:** (1) backend per-attempt timeout / chain order,
(2) prompt compaction (≤ 20 items per vocabulary list), (3) context byte budget
(`ContextRequest.maxBytes` → smaller snapshots), (4) breaker thresholds — a
slow-but-healthy provider should NOT trip the breaker; timeouts should.

## Bad vocabulary snapshot

**Symptoms:** a burst of `unresolved` slots / `unknown` grounding verdicts for
entities that plainly exist; groundings suggesting stale labels; users reporting
"it stopped recognizing our teams".

**Identify:** every AI result carries `provenance.vocabularyHash` and
`provenance.contextSnapshotId`. One bad hash recurring across reports = one bad
snapshot, not a parser regression. Compare against a fresh
`stableVocabularyHash` of current data (`packages/rule-core/src/parserGrounding.ts`).

**Invalidate:** the context provider bumps the affected section's
`ContextSourceMeta.version` (context.ts) → `snapshotId` changes → the reducer's
`context-switched` handling (`brainState.ts`) discards every derived artifact
(parse envelopes, ghost suggestions, recommendations). Caches keyed via
`buildCacheKey` include `vocabularyHash`, so stale entries simply stop being
hit — no manual cache flush exists or is needed.

## Rollback

The engine is ADDITIVE by design: `ParseEnvelope` extends `ParseResult`, the
Brain package is new, host wiring is dependency injection.

1. `git revert` the integration commits on `feature/parser-ai-engine-expansion`
   (or don't merge them) — behavior returns to baseline `d329223`.
2. Re-sync the vendored mirrors afterwards: `npm run sync:angular-core` (the
   lead runs it), because `src/app/core/**` and `src/app/brain/**` are GENERATED
   and must match the reverted package sources; `npm test` ends with the
   `--check` drift gate that catches a forgotten sync.
3. No data migration: transient parser metadata never persists into
   `WorkflowRule` JSON (parserProvenance.ts doctrine), so stored rules are
   untouched by rollback in either direction.

## Diagnostics — what exists, what never exists

**Provenance** (`ParserProvenance`): engine mode, parser/prompt versions,
provider/model ids, vocabularyHash, contextSnapshotId, requestId, generation,
injected-clock timestamp, latency stages, fallbackReason. **Never:** prompts,
author text, tenant labels, tokens, keys.

**Telemetry** (`guardedTelemetry` over `BrainTelemetrySink`): enum-ish
dimensions from the `TELEMETRY_DIMENSIONS` allowlist only — `event`, `engine`,
`fallbackReason`, `latencyBucket`, `outcome`, `source`. Unknown keys are
dropped; off-pattern values are dropped; a throwing sink is swallowed. Free-form
text CANNOT pass the allowlist — this is enforcement, not convention.

**Free-form error text** headed for logs/UI goes through `redactForDiagnostics`
first: control chars stripped, `Bearer …` / `sk-…` / `x-goog…` / `cf-aig…`
masked as `«redacted»`, hard-truncated to 120 chars (masking before truncation,
so a secret can never survive by being cut in half).

The privacy ceiling is contractual: diagnostics echo nothing above
`public-vocabulary` (`docs/workflow-brain-context-contract.md` §Privacy).

## Privacy-safe support procedure

When a user reports a bad/slow/missing AI parse, ask ONLY for:

1. the `requestId` / correlation id (shape `req-<base36>-<base36>` — clock +
   counter, contains no customer data);
2. the engine mode shown in provenance (`ai`, `hybrid`,
   `deterministic-fallback`, `deterministic`) and any `fallbackReason`;
3. the latency bucket (not raw timings);
4. tenant `dnsPrefix` only if cross-referencing server logs (it is the logging
   tenancy key per the backend contract).

NEVER ask for — and decline if volunteered — the instruction text, tenant
vocabulary/labels, screenshots of customer data, or anything from the model's
raw output. Correlate the requestId against server logs (which are themselves
redacted per contract §Logging) and the gateway dashboard. If reproduction is
required, have the USER re-run in their session; do not collect their input.
