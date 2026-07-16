# Phase 8 — QA Handoff for Gemini (Overseer)

**From:** Claude (Coder)
**Date:** 2026-07-16
**Branch / commit:** `main` @ `4720291` (pushed to origin)
**Spec:** `docs/2026-07-16_workflow-creator-hardening-phase-8-work-order_v1.md`
**Also folds in:** the Phase 7 adversarial-review fixes (see §4).

---

## 1. Status at a glance (at `4720291`)

| Gate | Result |
|------|--------|
| `npm run test` | ✅ 455 PASS / 0 FAIL (incl. new breaker / scheduled / doclinks / version-guard / ab-split suites + locked parser regressions) |
| `npm run lint` | ✅ clean |
| `npm run build` | ✅ clean |
| `npx tsc --noEmit` | ✅ clean |

> The tree was edited concurrently by Codex during this phase — re-run the gate on whatever
> you review; `4720291` is a verified-green snapshot.

---

## 2. What shipped (mapped to edge-cases §3/§7/§11/§12)

- **§12 Optimistic concurrency.** `version` on `Workflow` + `ApprovalAuthority`. Guarded
  conditional writes (`updateMany where {id, orgId, version}` → `count 0` = conflict) in both
  services throw `VersionConflictError` (`lib/optimisticWrite.ts`); `[id]` routes translate it
  to **409 + the server's current record**; client raises a typed `ConflictError`;
  `WorkflowCreator` renders a three-way dialog (**view theirs / overwrite anyway / reload**).
  `expectedVersion` is optional (absent → legacy last-write-wins) so existing callers don't break.
- **§11 Circuit breaker.** Pure state machine `lib/circuitBreaker.ts` (clock passed in);
  table-backed `SinkHealth` (serverless cold starts reset memory); `actionExecutor` fails a
  Novu dispatch fast when the circuit is open; new **`INTEGRATION_UNAVAILABLE`** status, kept
  distinct from `ERROR`; the fire route maps sink-down dispatches; `AuditLogs` gained the
  status style, a per-row **Retry now** (`/api/workflows/executions/[id]/retry`), and a
  sink-health strip.
- **§3 DocumentLink.** Prototype-owned junction (flagged unconfirmed vs the admin `documents`
  service), `DocumentLinkService`, `/api/platform/document-links`, expiry-window query.
- **§7 ScheduledAction.** Data model + **pure supersede-and-reinsert** reschedule logic
  (`lib/scheduledActions.ts`) + `/api/platform/scheduled-actions` seam. The polling scheduler
  itself stays deferred (no worker/cron) — stated in code.
- **Migration** `add_resilience_concurrency` (version cols + 3 tables, RLS on all).

---

## 3. Priority review areas (where I want your eyes)

1. **`ApprovalAuthorityService.updateAuthority` guarded path** — `updateMany` cannot express a
   relation `connect`/`disconnect`, so the guarded branch sets the scalar `escalationId`
   directly. Confirm that path stays equivalent to the unguarded `update` (escalation
   self-reference is still rejected earlier in the method).
2. **Retry route replays ALL of the rule's actions**, not just the one that failed — the audit
   model stores action *descriptions*, not per-action params, so a single-action replay isn't
   reconstructable from a row. Confirm replay-all is acceptable for the demo, or we add
   per-action persistence.
3. **Breaker cooldown boundary** — `breakerAllows` uses `elapsed >= cooldownMs` (the trial is
   allowed exactly at the boundary). Confirm vs a strict `>`.
4. **A/B logging attribution change** — routed simulations now log under
   `abSplit.targetWorkflowId` (the peer) with an `ab-split` trace marker, instead of the
   control. This corrects per-variant analytics but changes what a control-workflow's audit
   rows contain; confirm that's the intended semantics.

---

## 4. Phase 7 review fixes bundled here (execution-verified)

A multi-agent adversarial review of the pushed Phase 7 diff (`4073afa..0a61406`) confirmed
**10+ real defects**; all are fixed in `4720291` and locked as regression tests in
`scripts/assert-parser.ts`:

- **Dual-trigger parser** fabricated `OFFER APPROVED` (not a real event key → could never
  fire); hard-mapped `accepted` → `OFFER ACCEPTED` across subjects; and its `or` **leaked into
  condition logic, turning AND-joined conditions into OR** (a 200k grade-C loan matched a rule
  meant for >500k AND worse-than-B). Now: subject-aware mapping onto real keys only,
  trigger-clause anchoring, multi-subject → N3 ambiguity (ask, don't guess), and `matchLogic`
  reads only unconsumed text.
- **A/B simulate logging** attributed every variant-B run to variant A (peer showed zero) — now
  attributed to the peer + `ab-split` marker persisted.
- **Hotspot badge** labeled total evaluations as "fired N" — now "N runs" (honesty).
- **ChatBox `acceptSuggestion`** duplicated words on typo matches — now uses the fuzzy matcher.

---

## 5. Decisions needed / standing items

1. **Migration not applied.** `add_resilience_concurrency` is in-tree but **not** run against
   Supabase in this environment. Run `prisma migrate deploy` + `migrate resolve` before the
   new tables/columns exist in the DB (same open item as Phases 3/4/6).
2. **Codex coordination.** This phase again involved live edit collisions (schema/migration
   drift risk, function renames, two build breaks mid-gate). Recommend deciding whether Codex
   works on an isolated branch/lane rather than co-editing the shared tree — see the separate
   note to Anderson.

---

## 6. Next actions
- [ ] Gemini QA of §3 (the four areas) → `walkthrough.md`.
- [ ] Decision on §5.1 (migrate deploy) and §5.2 (Codex lane).
- [ ] Confirm the Phase 7 regression suite covers the review findings to your satisfaction.
