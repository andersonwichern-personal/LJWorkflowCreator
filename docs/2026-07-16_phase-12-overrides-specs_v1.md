# Specs: Phase 12 — Exceptions, Tolerance Bands & Break-Glass Overrides

**Date**: 2026-07-16
**Branch Target**: `feature/overrides-phase-12`
**Status**: APPROVED SPECIFICATION

---

## 1. Objectives & Scope
This phase introduces policy flexibility by implementing tolerance bands, vacation delegation, and emergency break-glass overrides. It ensures that marginal policy deviations can be resolved through co-sign lanes and delegates without causing approval deadlocks.

Specifically, we will:
1.  **Prisma Schema Additions**:
    *   Create a `Delegation` model to store authority delegations (e.g. from user A to user B).
    *   Add `overageTolerancePercent` and `overageToleranceAmount` columns to the `ApprovalAuthority` model.
2.  **Engine Changes (`lib/authorityEngine.ts`)**:
    *   Extend `decideAuthority` to accept active overrides and delegations.
    *   Implement **Co-Sign Lane** routing: if a request amount exceeds an authority level's limit but is within the tolerance band, route it to a co-sign lane (requiring two peer signatures of that level) instead of escalating.
    *   Apply active delegations: substitute the delegate during approval tasks and mark decisions with delegate attribution.
3.  **Break-Glass Override API**:
    *   Create a route `POST /api/platform/authorities/break-glass` to allow emergency bypasses with a mandatory audited reason.

---

## 2. Technical Specifications

### 2.1 Prisma Schema (`prisma/schema.prisma`)
Add the `Delegation` model (with tenant RLS scoping):
```prisma
model Delegation {
  id         String   @id @default(uuid())
  orgId      String   @map("org_id")
  fromUserId String   @map("from_user_id")
  toUserId   String   @map("to_user_id")
  scope      String   // "all" or specific authority level ID
  startsAt   DateTime @map("starts_at")
  endsAt     DateTime @map("ends_at")
  reason     String
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([orgId, fromUserId])
  @@map("delegations")
}
```

Add tolerance columns to `ApprovalAuthority`:
```prisma
model ApprovalAuthority {
  // ... existing fields
  overageTolerancePercent Float? @default(0) @map("overage_tolerance_percent")
  overageToleranceAmount  Float? @default(0) @map("overage_tolerance_amount")
}
```

Ensure RLS policy is applied to `delegations` (mirroring `workflows` org check).

### 2.2 Authority Engine (`lib/authorityEngine.ts` & `lib/services/authority.ts`)
*   Refactor `decideAuthority(rules, request, context)`:
    *   **Co-Sign check**: Calculate tolerance limit = `limit * (1 + overageTolerancePercent / 100) + overageToleranceAmount`.
    *   If `request.amount > limit` but `request.amount <= toleranceLimit`, return `{ status: "manual_review", lane: "co-sign", reason: "Within tolerance: co-sign required" }`.
    *   If beyond tolerance, return `{ status: "escalate", lane: "escalate", reason: "Exceeds tolerance limit" }`.
*   Refactor `evaluateRequirement(req, ctx)`:
    *   Use active delegations in `ctx.delegations` (e.g. `{ fromId, toId }`) to substitute approvers. If `fromId` is an eligible approver, `toId` may sign on their behalf. The signature is recorded as `"approved by toId as delegate of fromId"`.

### 2.3 Break-Glass API (`app/api/platform/authorities/break-glass/route.ts`)
*   Create a route that accepts `{ requestId, reason }`.
*   Bypasses active approval requirements, logs a `rule_executions` audit log row with status `OVERRIDDEN`, and saves the override payload.

---

## 3. Verification Plan
- Create `scripts/assert-exceptions.ts` asserting:
  - Loan amounts within tolerance trigger a co-sign lane instead of escalating.
  - Active delegations successfully substitute the delegate.
  - Break-glass overrides bypass checks and create the audit trails.
- Run `npm run test` to verify.
