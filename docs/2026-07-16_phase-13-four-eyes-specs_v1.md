# Specs: Phase 13 — Four-Eyes (Maker-Checker) Rule Activation

**Date**: 2026-07-16
**Branch Target**: `feature/four-eyes-phase-13`
**Status**: APPROVED SPECIFICATION

---

## 1. Objectives & Scope
Enforce banking compliance controls by preventing any single administrator from modifying or activating workflow rules unilaterally. Any proposed change to workflow rules must be reviewed and approved by a different administrator before it takes effect.

Specifically, we will:
1.  **Prisma Schema Additions**:
    *   Create a `WorkflowProposal` model to store pending rule changes and link them to review tasks.
2.  **Service Interception (`lib/services/workflow.ts`)**:
    *   Block direct saving or status toggling of workflow rules for non-draft rules.
    *   Implement `proposeRuleChange()` which creates a proposal and spawns an `ApprovalTask` requiring peer admin approval.
3.  **Maker-Checker Rule Integration**:
    *   Enforce that the proposer user ID is automatically placed in the task's `exclusions` pool (so they cannot approve their own rule changes).
4.  **Admin UI Additions**:
    *   Add a "Propose Changes" action button.
    *   Render a banner on rules with pending changes.
    *   Build a "Review Proposals" dashboard panel letting admins view proposed JSON changes (side-by-side or diff style) and approve/reject them.

---

## 2. Technical Specifications

### 2.1 Prisma Schema (`prisma/schema.prisma`)
Add the `WorkflowProposal` model (with tenant RLS scoping):
```prisma
model WorkflowProposal {
  id           String   @id @default(uuid())
  orgId        String   @map("org_id")
  workflowId   String   @map("workflow_id")
  proposedRule Json     @map("proposed_rule")
  proposerId   String   @map("proposer_id")
  status       String   // "pending" | "approved" | "rejected"
  taskId       String?  @map("task_id")
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([orgId, workflowId])
  @@map("workflow_proposals")
}
```

Ensure RLS policy is applied to `workflow_proposals`.

### 2.2 Propose Service Interception (`lib/services/workflow.ts` & `app/api/workflows/...`)
*   Refactor rule update endpoints:
    *   If a rule is toggled to `armed`, or if an already armed rule's JSON is edited, do NOT update `Workflow.ruleJson` directly.
    *   Instead, call `WorkflowProposalService.createProposal(orgId, workflowId, proposerId, proposedRule)`.
    *   Create an `ApprovalTask` where `requirement = { type: "any_of", approvers: [other_admin_list] }` and `exclusions = [proposerId]`.
*   On approval of the `ApprovalTask` (handled via `ApprovalTaskService.castDecision`), trigger the actual update to `Workflow.ruleJson` / `Workflow.enabled` and transition the proposal to `approved`.

### 2.3 User Interface (`components/WorkflowCreator.tsx` & `components/WorkflowDashboard.tsx`)
*   Modify save buttons: If the rule is active, change "Save" to "Propose Changes".
*   Display a warning header in the builder canvas if the rule has a pending proposal.
*   Add a "Proposals" tab on the administrator dashboard to allow other administrators to review, diff, and approve rule changes.

---

## 3. Verification Plan
- Create `scripts/assert-four-eyes.ts` asserting:
  - Armed rule updates create proposals and do not modify the active workflow rule.
  - Proposer is excluded from approving their proposal.
  - A peer admin's approval successfully applies the proposed rule.
- Run `npm run test` to verify.
