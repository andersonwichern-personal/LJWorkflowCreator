# Developer Task: Phase 12 Exceptions, Tolerance Bands & Break-Glass Overrides

Target Branch: `feature/overrides-phase-12`

You are the Lead Developer. Your task is to implement tolerance bands on authority levels, delegation support in the approval engine, and emergency break-glass overrides. Do NOT follow Codex; write clean, standalone TypeScript.

---

## 1. Schema Additions (`prisma/schema.prisma`)
*   Add the `Delegation` model scoped to `org_id` with appropriate RLS policies.
*   Add `overageTolerancePercent` and `overageToleranceAmount` columns to `ApprovalAuthority`.
*   Run `prisma migrate dev` (or push) to update local database structures.

---

## 2. Engine and Service Upgrades (`lib/authorityEngine.ts` & `lib/services/approvalTask.ts`)
*   Refactor `decideAuthority`:
    *   If `request.amount` exceeds the authority limit but is within the `overageTolerance` threshold, return the result with `lane: "co-sign"` and a clear reason. Otherwise, escalate.
*   Refactor `evaluateRequirement`:
    *   Intercept approver checks and map delegate approvals (where `ctx.delegations` substitutes the active approver).
    *   Decisions should record both the delegate and original approver, e.g. `"approved by Y as delegate of X"`.

---

## 3. Break-Glass Override API (`app/api/platform/authorities/break-glass/route.ts`)
*   Implement `POST /api/platform/authorities/break-glass`:
    *   Check for a mandatory `reason` text block.
    *   Override active approval requirements for the request, log an `OVERRIDDEN` rule execution row in the audit log, and save the override detail.

---

## 4. Test Verification (`scripts/assert-exceptions.ts`)
*   Create a test script `scripts/assert-exceptions.ts` asserting:
    *   Loans within tolerance trigger co-sign lanes.
    *   Active delegations successfully substitute the delegate.
    *   Break-glass overrides bypass checks and create the audit trails.
*   Wire the script into `package.json`'s `test` script.
*   Verify `npm run test` and `npm run build && npm run lint` pass successfully.
