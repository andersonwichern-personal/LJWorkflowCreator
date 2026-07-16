# Work Order — Phase 8: Resilience & Concurrency

**Created:** 2026-07-16
**Baseline commit:** `0a61406` (main — Phase 7 closed: analytics, A/B split, vocab sync, parser upgrade)
**Implements:** edge-cases doc §16 "New Phase 8 — Resilience & concurrency" = §3 (document
links), §7 (scheduled actions' data model), §11 (circuit breakers), §12 (optimistic
concurrency). Independent of Phases 6/7 per that roadmap; starts now.
**Branch:** work continues on `main` per the current collapsed flow (Phase 7 precedent).
**Audience:** Claude implements (Codex parallel-drafts in its lanes); Gemini QAs post hoc.

## 0. Ground rules (inherited, still binding)
- No new runtime deps; tsx assertion tests; every new table copies the RLS idiom from the
  Phase 6 migration (`auth.jwt() ->> 'org_id'` + shadow-DB mock block).
- **Determinism:** no `Math.random`/`Date.now` inside lib logic — clocks are passed in.
- **Honesty:** `INTEGRATION_UNAVAILABLE` ≠ `ERROR` (load-bearing for the linter, §3 below);
  DocumentLink is a prototype-owned *index*, flagged unconfirmed vs the admin documents
  service; ScheduledAction ships as a data model only — the scheduler stays deferred.
- Migrations are gitignored; apply with `prisma migrate deploy` before merge (standing item).
- Every sub-feature ends green: `npm run test && npm run lint && npm run build`.

## 1. §12 Optimistic concurrency (build first — highest value, fully unblocked)
- **Schema:** `version Int @default(1)` on `Workflow` and `ApprovalAuthority`
  (`Customer.version` exists since Phase 6 — same pattern).
- **`lib/optimisticWrite.ts` (pure seam):** `export class VersionConflictError extends Error
  { constructor(public currentVersion: number, public current: unknown) }` + a
  `conflictResponse(err)` helper producing the 409 JSON `{ error, currentVersion, current }`.
- **Services:** `WorkflowService.updateWorkflow`/`toggleWorkflow` and
  `ApprovalAuthorityService.updateAuthority` accept optional `expectedVersion?: number`
  (optional = back-compat: absent → legacy last-write-wins, logged in the response as
  `versionGuard: false`; the UI always sends it). Guarded path: `updateMany({ where: { id,
  orgId, version: expectedVersion }, data: { ..., version: { increment: 1 } } })`;
  `count === 0` → re-fetch → not-found vs `VersionConflictError`.
- **Routes:** `PATCH /api/workflows/[id]` and `…/authorities/[id]` catch
  `VersionConflictError` → HTTP 409 with the current record attached.
- **Client:** `lib/api.ts` update fns pass the record's `version`; on 409 throw a typed
  `ConflictError` carrying `current`. `WorkflowCreator.save()` and the Authorities drawer
  catch it → conflict dialog: **View their version** (read-only JSON/summary), **Overwrite
  anyway** (retry with fresh `expectedVersion` — explicit last-write-wins), **Reload and
  lose my changes**. No silent-loss path.
- Presence-lite `updatedAt` polling (§12 optional) — **deferred**, the 409 is the guarantee.

## 2. §11 Circuit breaker + INTEGRATION_UNAVAILABLE
- **`lib/circuitBreaker.ts` (pure state machine, clock passed in):**
  `type BreakerState = { status: "closed"|"open"|"half-open"; consecutiveFailures: number;
  openedAt: string|null }`; `breakerNext(state, event: "success"|"failure", nowIso, cfg)`
  with `cfg = { threshold: 3, cooldownMs: 60_000 }`; `breakerAllows(state, nowIso, cfg)`
  (open + cooldown elapsed → allow one half-open trial).
- **Persistence:** `model SinkHealth { orgId, sink, statusJson Json, updatedAt }` PK
  `(orgId, sink)` (+RLS) — table-backed because serverless cold starts reset memory (§11).
- **Executor wiring (`lib/services/actionExecutor.ts`):** before a Novu dispatch, load the
  `novu` sink state; open circuit → return `status: "integration-unavailable"` fast (no
  hang, no retry-loop); on real dispatch, record success/failure through `breakerNext`.
  `onFailure: "retry"` still governs only transient failures; breaker-open results do not
  consume retries.
- **Status:** add `INTEGRATION_UNAVAILABLE` to `EXECUTION_STATUSES`; the fire/simulate
  logging paths persist it; **linter exemption** — `lib/ruleLinter.ts` history-based signals
  must ignore `INTEGRATION_UNAVAILABLE` rows (outage noise must not mark good rules bad).
- **UI:** AuditLogs styles the new status + a **Retry now** button on
  `ERROR`/`INTEGRATION_UNAVAILABLE` rows → `POST /api/workflows/executions/[id]/retry`
  re-dispatches *that one action* through `executeActions` (not a rule re-eval). Sink
  health strip beside the vocabulary source chip (reuse the `describeSource()` chip shape):
  Novu / admin bridge dots from `GET /api/platform/sink-health`.

## 3. §3 DocumentLink (prototype-owned junction; admin service unconfirmed)
- **Schema:** `DocumentLink` exactly per edge-cases §3 (`@@unique([documentId, requestId])`,
  org indexes, `validUntil` expiry, `purpose`, `linkedBy`; +RLS).
- **Service `lib/services/documentLink.ts`:** `listForRequest`, `link` (idempotent on the
  unique key), `unlink`, and `expiringWithin(orgId, days, nowIso)` — pure date math on the
  passed clock.
- **Route `GET/POST/DELETE /api/platform/document-links`** (+ `?requestId=`,
  `?expiringDays=`). No approval status on the link (per §3 — approval stays per-request).
- **UI:** a "Linked documents" panel on the request-facing surface (SimulationPanel's
  request card or CustomersPanel-adjacent), listing links with purpose + validity chip
  (`expiring soon` amber when inside 30 days), link/unlink for Admin viewpoint only. Fan-out
  of DOCUMENT-event triggers to linked requests: **flagged unconfirmed, not built** — the
  events' emit status is itself unconfirmed (build manual §12 Q3).

## 4. §7 ScheduledAction — data model + reconcile logic only (scheduler stays deferred)
- **Schema:** `ScheduledAction` exactly per edge-cases §7 (anchorField/offsetMinutes/runAt
  cache/status/supersedes; indexes; +RLS).
- **`lib/scheduledActions.ts` (pure):** `computeRunAt(anchorIso, offsetMinutes)`;
  `planReschedule(pending: Row[], changedField, newAnchorIso, nowIso)` → `{ supersede:
  ids[], insert: NewRow[] }` implementing supersede-and-reinsert (principle A/C: old rows
  marked `superseded`, never mutated in place; `runAt` always derived, never authored).
- **Service + route:** `POST /api/platform/scheduled-actions/reconcile` — body
  `{ requestId, anchorField, newValue }` applies the plan transactionally. This is the seam
  the future `REQUEST_FIELD_CHANGED` event will call; until then it is invoked manually /
  by tests. **No polling scheduler is built** — that stays blocked (no worker/cron in the
  serverless prototype), stated in-code.
- Business-day calendars: not solved, per §7 — raw minutes with a comment naming T7.

## 5. Tests (all pure, chained into `npm test`)
- `assert-version-guard.ts`: conflict error shape; 409 payload; increment semantics
  (simulated via the pure helper), absent-expectedVersion legacy path flagged.
- `assert-breaker.ts`: closed→open at threshold; fail-fast while open; half-open trial
  after cooldown; success closes + resets; failure re-opens; determinism (fixed clock).
- `assert-scheduled.ts`: computeRunAt math (negative offsets); planReschedule supersedes
  exactly the matching pending rows, preserves fired/canceled rows, chains `supersedes` ids;
  idempotent on re-plan with same anchor.
- `assert-doclinks.ts`: link idempotence plan, expiringWithin window edges (on/inside/
  outside boundary, null validUntil never expires).

## 6. Acceptance (Gemini QA checklist)
1. Gate green; migration applied; RLS on all three new tables.
2. Two-tab edit of one workflow → second save gets the conflict dialog, no silent loss.
3. Breaker: 3 consecutive Novu failures → subsequent dispatch returns
   INTEGRATION_UNAVAILABLE instantly; after cooldown one trial closes it on success.
4. Linter ignores INTEGRATION_UNAVAILABLE history; AuditLogs can retry a single action.
5. DocumentLink round-trip + expiry query; ScheduledAction reschedule supersedes correctly.
6. No fabricated data: sink health from real state; expiry/schedule math from passed clocks.

### Change log
- **2026-07-16 (v1)** — Initial Phase 8 work order from edge-cases §3/§7/§11/§12 at
  baseline `0a61406`; scheduler and presence-lite polling explicitly deferred.
