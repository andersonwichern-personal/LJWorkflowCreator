# Phase 9 QA Handoff — Aggregate Exposure, SLA Delays & Covenant Triggers

**Date**: 2026-07-16
**Author**: Claude (Coder)
**Reviewer**: Gemini (Overseer / QA)
**Status**: **READY FOR QA — not signed off.** Do not treat as complete until §5 is resolved.
**Supersedes**: `2026-07-16_phase-9-exposure-sla-qa-handoff_v1.md` — see §6. v1's status claims do not
hold against the commit that actually landed; this doc replaces it.

---

## 1. Scope delivered

**1. Aggregate exposure** — `lib/services/exposure.ts`, `lib/ruleEvaluator.ts`

- `calculateAggregateExposure(customerId): Promise<number>` walks the real relationship graph
  (`customer_relationships`) and sums outstanding amounts across the borrower **and** every connected
  entity, via `RequestCustomerRole` → request amounts.
- `computeAggregateExposure(...)` is the pure core the DB wrapper delegates to after loading its four
  inputs — this is the unit under test.
- `calculateAggregateExposureForRequest(orgId, requestId)` resolves the request's Borrower (falling
  back to any role holder) and sums its group.
- `evaluationContextFor(rule, orgId, requestId)` builds the evaluator's context, gated on
  `ruleReferencesField` so rules that never mention exposure don't pay for a graph walk.
- Wired into **both** evaluation routes: `app/api/workflows/[id]/fire` and `app/api/workflows/simulate`.
- `aggregate_exposure` registered in `FIELDS` (numeric, unit `$`, group Customer, `unconfirmed`).

**2. SLA action delays** — `components/RuleSentence.tsx`, `lib/vocabulary.ts`

- `RuleOutput.delayMinutes` **already existed** (it predates this phase and is already emitted by
  `lib/nlParser.ts`). This phase adds the authoring surface, not the field.
- Timer control on every action pill (then + else lanes), opening a delay popover with presets and
  free text ("2 hours", "3 days"). Reuses `TokenPicker` — no new popover component.
- `parseDelay` / `formatDelay` / `MAX_DELAY_MINUTES` (90-day cap) added to `lib/vocabulary.ts`.

**3. Scheduled covenant triggers** — `lib/vocabulary.ts`

- `SCHEDULED COVENANT REVIEW` event registered (`unconfirmed`).
- Variables registered: `days_since_financials_pulled`, `compliance_status`, `covenant_type`, under a
  new `Covenant` field group (icon added to `components/ui/VocabIcon.tsx`).

**Incidental**: `lib/services/merge.ts`'s deferral note for the T6 exposure recompute is now stale and
was corrected — exposure is derived on read, never stored, so repointing roles on merge *is* the
recompute. Nothing to invalidate.

---

## 2. Design decisions requiring your sign-off (deviations from the brief)

These are deliberate departures from the Phase 9 task text. Each needs an explicit ack or a redirect.

**2.1 — `aggregate_exposure` is injected as context, not fetched inside the evaluator.**
The brief says "integrate this function into `lib/ruleEvaluator.ts`". Taken literally that is not
buildable: `simulateRule` is documented pure and synchronous, and `components/SimulationPanel.tsx` is
a `"use client"` component that calls it through `ruleEngine.matchingRequests`. An
`await calculateAggregateExposure(...)` inside the evaluator would (a) pull Prisma into the browser
bundle and fail the build, and (b) force every caller async. So the **server routes resolve exposure
and pass it in** via the new `EvaluationContext`. The function's *result* is integrated; the function
itself is not called from the evaluator. Same dynamic behavior, evaluator stays pure, suite stays sync.

**2.2 — `params` keeps `Record<string, ScopeValue>`; the brief specified `Record<string, any>`.**
`ScopeValue` is load-bearing across the evaluator, linter, and pickers; `any` would be a type-safety
regression. I also **kept `when` and `onFailure`**, which the brief's snippet omitted but other code
depends on — removing them would have broken Phase 4 wiring.

**2.3 — `calculateAggregateExposure(customerId)` has no `orgId`, as specified.**
Every table involved is org-scoped, so the org is read off the customer's own row rather than queried
across tenants. **Authorization is still the caller's job** — this resolves an id, it does not decide
who may ask about it. Flagging explicitly in case you want a guard at the route layer.

**2.4 — Unresolved exposure is `unknown`, never `0`.**
A caller that didn't resolve exposure must not read as $0 — that silently passes every
`aggregate_exposure >= threshold` covenant ceiling. Fails closed, consistent with `missingData`. Pinned
by tests.

**2.5 — Delays and the covenant trigger ship inert and labeled** (per Anderson's explicit direction).
There is no scheduler/cron in this prototype (`lib/scheduledActions.ts`). Consequences, by design:
- A saved `delayMinutes` **does not delay anything** — the executor still runs the action immediately.
  The popover header reads "Delay — saved, not yet executed"; the pill warns on hover; presets carry an
  `unconfirmed` badge.
- `SCHEDULED COVENANT REVIEW` is a *clock tick*, not request state, so `requestMatchesEvent` returns
  `false` for it and no cron exists to fire it. **Rules on this trigger save but never fire.** Verified
  at runtime, not assumed.
- The three covenant variables have no platform data source and resolve unknown → fail closed. This
  matches existing precedent (`reqtype`, `credit_score` are registered but return `UNKNOWN`).

**Matches the Phase 8 `ScheduledAction` precedent**: ship the substrate, mark it honestly, don't
pretend it executes.

---

## 3. Verification — measured, not asserted

Run on the working tree (see §5 — **not** on what's currently on `origin/main`):

| Check | Result |
|---|---|
| `npm run test` | **519 PASS / 0 FAIL**, exit 0 |
| `npm run lint` | ✔ No ESLint warnings or errors, exit 0 |
| `npm run build` | exit 0 — prerenders `/workflows`; also proves no Prisma leak into the client bundle |
| `scripts/assert-exposure.ts` | **32 PASS** |

Runtime-verified beyond compilation (not just typechecked):
- `SCHEDULED COVENANT REVIEW` registered, `confidence: unconfirmed`.
- All four variables offerable on that trigger and present in `FIELDS`.
- `requestMatchesEvent(req, "SCHEDULED COVENANT REVIEW") === false` — the inert claim is tested, not asserted.
- `delayMinutes` round-trips through `normalizeRule`.
- `ruleReferencesField` correctly gates the DB work off for rules without exposure conditions.

`scripts/assert-exposure.ts` covers: the 300k mock-tree total, per-party dedup, merged-alias
resolution, Closed-stage exclusion, unconnected-customer isolation, two-hop traversal, graph symmetry,
degenerate inputs (unknown customer, vanished request), the **full evaluator path** (`simulateRule`
with an `aggregate_exposure` condition — gte/gt boundaries, trace `actual`/`label`, fail-closed with no
context, `missingData:alert`), and delay parse/format round-trips.

---

## 4. NOT verified — gaps QA must close

Stated plainly so nobody reads §3 as broader than it is.

1. **The DB path is untested.** `calculateAggregateExposure` / `*ForRequest` are thin query+map wrappers
   over the tested pure core, but no test touches Postgres. Same split as `assert-merge.ts` (pure
   rewrite tested; transaction left to live smoke). **Needs a live smoke test against a seeded org.**
2. **The delay popover was never driven.** The build prerenders the page, so it renders — but I did not
   click through the popover, type a value, save, and reload. **Needs manual UI QA.**
3. **Exposure amounts come from the `lib/platformData` seed, not a live ledger.** This prototype has no
   Request/Loan table. It's the same source `lib/analytics.ts` sums, so exposure is exactly as real as
   every other number in the demo — but it is *not* a live figure, and should not be shown to a customer
   as one. Documented in the module header.
4. **Whole-org load per evaluation.** `calculateAggregateExposure` loads all customers, relationships,
   and roles for the org on each call. Consistent with the existing `loadCustomerGraph`, but it is O(org)
   per fire. Fine at demo scale; **flagging as a scaling review item**, not a defect.
5. **Cross-tenant authorization** at the route layer — see §2.3.

---

## 5. Repository state — action required before QA

**This is the most important section.** The Phase 9 source landed on `origin/main` **without its tests**.

Sequence (from reflog): my working tree was committed as `364e1ca` while implementation was still in
progress, rebased onto main as **`ca48492`**, pushed to `origin/main`, and `feature/ai-model-upgrade-phase-10`
was cut from it. The `feature/exposure-sla-phase-9` target branch, `main`, `origin/main`, and the Phase 10
branch **all currently point at `ca48492`**.

Verified directly against `origin/main`:

- `scripts/assert-exposure.ts` **does not exist on `origin/main`** — the whole of the brief's Task 4.
- `package.json`'s test wiring never landed, so **`npm test` on main never runs the exposure suite**.
- ⇒ **Phase 9's core logic is on `origin/main` with zero test coverage.**
- `ca48492` also carries two dead imports in `app/api/workflows/[id]/fire/route.ts`
  (`ruleReferencesField`, `EvaluationContext`) — unused, harmless to lint/build under the current
  `next/core-web-vitals` config, but dead code.

Still **uncommitted** (staged on the Phase 10 branch, i.e. the *wrong* branch):

- `scripts/assert-exposure.ts` (the 32-assertion suite)
- `package.json` test wiring
- the dead-import removal
- a memoization fix in `computeAggregateExposure` (`canonicalizeCustomerNode` rebuilt a full node index
  per role — quadratic on a function that runs on every fire)

**Ask**: decide the landing branch and let Claude move these. Nothing has been committed or pushed by
this session.

---

## 6. Correction to v1 — please disregard that document

`..._qa-handoff_v1.md` states **"Status: COMPLETE (Fully Merged & QA'd)"** and **"All tests parsed
successfully (455 pass results)"**. Neither holds:

- Those 455 passes **could not have included a single exposure assertion** — the suite was not in
  `ca48492` and was not wired into `npm test`. The measured total on the completed tree is **519**.
- **455 is copied verbatim from the Phase 8 handoff.** The two documents are template-identical. The
  figure was not re-measured for Phase 9.
- v1 was written at 10:41 while implementation was still in progress (the memoization fix, the test
  suite, and the test wiring all postdate it).

v1 is currently **staged**. Recommend dropping it rather than committing a "Fully QA'd" record that the
repository contradicts. Flagging rather than deleting — it isn't mine to remove.

---

## 7. Specific review asks for Gemini

1. **Ack or redirect §2.1** (context injection vs. literal in-evaluator integration) — this is the one
   architectural call in the phase.
2. **Ack §2.2** — keeping `ScopeValue` over the brief's `any`.
3. **Validate the covenant vocabulary** (your §token-vocabulary remit): are
   `compliance_status` options `["Compliant", "Waived", "In Breach", "Pending Review"]` and
   `covenant_type` options `["Financial", "Reporting", "Collateral", "Affirmative", "Negative"]` the
   right domain values? I invented these — they are **not** confirmed against the live platform, which
   is why they ship `unconfirmed`.
4. **Confirm the "outstanding" definition**: `stage !== "Closed"`, deliberately identical to
   `lib/analytics.ts` so a covenant rule and the portfolio dashboard can never disagree. Sign off or
   correct.
5. **Resolve §5** — branch landing, and whether the untested `ca48492` on `origin/main` needs a
   follow-up commit or a revert-and-reland.
6. **Close the §4 gaps**: live DB smoke test + manual popover QA.
