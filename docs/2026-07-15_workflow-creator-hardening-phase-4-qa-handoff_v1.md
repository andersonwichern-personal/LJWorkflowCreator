# Phase 4 — QA Handoff for Gemini (Overseer)

**From:** Claude (Coder)
**Date:** 2026-07-15
**Branch:** `feature/hardening-phase-4` (pushed → PR #8)
**Tip commit:** `3b8ca3f` — *feat(hardening): Phase 4 — Trust Machinery*
**Prompt spec:** `docs/2026-07-15_workflow-creator-hardening-phase-4-prompt_v1.md`

---

## 1. Status at a glance

| Gate | Result |
|------|--------|
| `npm run test` | ✅ pass (all suites, incl. 24 linter assertions across all 7 codes) |
| `npm run build` | ✅ pass (fire / backtest / controls routes registered) |
| `npm run lint` | ✅ pass (no ESLint warnings/errors) |
| `npx tsc --noEmit` | ✅ clean |
| Live fire-route smoke | ✅ all 5 guardrail outcomes verified end-to-end |

---

## 2. What was delivered (mapped to the prompt)

### §1 Schema & action executor
- `RuleExecution.mode String @default("shadow")` and the `WorkflowOrgControls` model added; migrated to Supabase with tenant `org_id` RLS copied from the existing tables.
- `lib/services/actionExecutor.ts`: `executeAction` / `executeActions` extracted from `/api/execute`. Retry applies only to *transient* failures (Novu HTTP/thrown); bad-input and honest no-ops never loop; `halt` stops the remaining sequence. `/api/execute` is now a thin wrapper.

### §2 Fire & backtest routes
- `POST /api/workflows/[id]/fire` enforces, in order: **PAUSED_ORG** → **SKIPPED_DUPLICATE** (`oncePerRequest`) → **PAUSED_RATE_LIMIT** (`maxFiresPerHour`, auto-disables the workflow + sends a notice) → evaluate → **SHADOW** (observe) / **FIRED** (armed, executes). Every path logs a typed `RuleExecution` with its `mode`.
- `POST /api/workflows/backtest` dry-runs a rule over all request records → `{ total, matchCount, matches, alerts }`.

### §3 Linter (`lib/ruleLinter.ts`)
All 7 codes implemented and enforced in `save()` (error severity blocks + disables the Save button): `DEAD_CONDITION`, `OVERLAP`, `BROKEN_REF`, `MISSING_DATA_EXPOSURE`, `AUTO_REJECT_WITHOUT_NOTICE` (blocking), `PROHIBITED_BASIS_REVIEW`, `GATED_TOKEN_ARMED`.

### §4 Frontend
- AuditLogs: `All / Armed / Shadow` filters + colored mode tags on each row; new statuses styled.
- Linter dashboard (`LintPanel`) below the builder, blocking errors highlighted.
- Backtest button beside Simulate, showing the match count across all requests.
- Global `⏸ Pause all automations` header button + prominent orange banner.

### §5 Verification
`scripts/assert-linter.ts` covers all 7 codes (wired into `npm test`).

---

## 3. Live smoke test (already run, reproducible)

Against real workflows + the demo request `REQ-4821` (bookStatus = Error):

| Scenario | Expected | Observed |
|----------|----------|----------|
| shadow rule, matched | observe only | `SHADOW`, `wouldRun` populated, nothing executed |
| armed rule, matched | execute | `FIRED` (mode=armed) |
| armed, same request again | idempotent | `SKIPPED_DUPLICATE` |
| org paused, then fire | blocked | `PAUSED_ORG` |
| rate cap = 1, 2nd fire | breaker trips | `PAUSED_RATE_LIMIT` + workflow auto-disabled (`enabled=false`) |
| backtest across 12 requests | 1 match | `matchCount: 1` → REQ-4821 |

`rule_executions.mode` confirmed populated per row. Test data deleted; controls reset to unpaused.

---

## 4. Priority review areas (where I want your eyes)

1. **Rate-cap boundary.** I block when `firedLastHour >= maxFiresPerHour` (the Nth fire in the window is the last allowed; the N+1th trips the breaker). Confirm that's the intended semantics vs. a strict `>`.
2. **Duplicate scope.** `SKIPPED_DUPLICATE` keys on any prior `FIRED` row for `(workflow, request)` and only when `controls.oncePerRequest` is true. Shadow/guardrail rows never dedupe a later arm. `vocabulary.oncePerRequestKey` reserves a `generation` segment for reopened requests — I did **not** wire generation into the dedupe query (no generation source exists in the demo request data yet); flagging as a known gap.
3. **`assign_authority` inside fire.** Requests carry no risk grade, so the executor returns an honest `invalid` for authority decisioning during a fire. Notify is the only action that actually runs today. Confirm that's acceptable for the demo.
4. **Retry taxonomy.** Only `status: "failed"` retries; `invalid` / `not-configured` / backend-required no-ops do not. Worth a sanity check that this matches the intended retry contract.

---

## 5. Two things that need an Overseer decision

1. **Migration files are gitignored** (`prisma/migrations/`, repo convention). The Phase 4 migration was applied + `migrate resolve`d against Supabase (`migrate status` clean) but is **not** in-tree — same open question as Phase 3.

2. **⚠️ Commit `2c1aeab` ("style(theme): replace neon focus outline rings") is mislabeled** — it swept in the Phase 4 schema, execution service, and `execute`-route refactor under a theme-styling message, leaving the branch tip importing an uncommitted `actionExecutor.ts` (unbuildable on a clean checkout). My `3b8ca3f` completes it. **This is the second time a mislabeled commit under Anderson's identity has bundled a phase's backend work** (Phase 3 had `0105b8c` "style(chatbox)…"). Recommend the author fix these messages (or squash) before merge — a history audit will misread them.

---

## 6. PR & stacking

- **PR #8** — repurposed from the auto-created theme-titled PR to the Phase 4 review. Stacked on `feature/hardening-phase-3` (PR #7), which is stacked on `chore/ai-engine-followups` (PR #6).
- **Note on the diff:** Phase 4 was branched from a *consolidated squash* of Phase 3 (`c434adb`) rather than the Phase 3 branch tip, so their git histories diverge even though the Phase 3 file content is identical. The Phase-4-only change set is the two-dot diff `feature/hardening-phase-3..feature/hardening-phase-4` (21 files, listed in §2). If the PR's three-dot view shows Phase 3 files, that's the divergent-base artifact — review the §2 file list as the true Phase 4 surface.

---

## 7. Next actions (awaiting your sign-off)

- [ ] Gemini QA review of the four areas in §4
- [ ] Decision on §5.1 (migrations in-tree?) and §5.2 (mislabeled-commit cleanup)
- [ ] Merge order: #6 → #7 → #8
