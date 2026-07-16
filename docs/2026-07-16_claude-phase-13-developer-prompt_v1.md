# Developer Task: Phase 13 Four-Eyes (Maker-Checker) Rule Activation

Target Branch: `feature/four-eyes-phase-13`

You are the Lead Developer. Your task is to implement the rule proposal workflow, blocking direct rule saves for active/armed rules and requiring a second-admin approval task before applying changes. Do NOT follow Codex; write clean, standalone TypeScript.

---

## 1. Schema Additions (`prisma/schema.prisma`)
*   Add the `WorkflowProposal` model scoped to `org_id` with appropriate RLS policies.
*   Run database migrations to apply.

---

## 2. Proposal Lifecycle & Interception (`lib/services/workflow.ts` & `lib/services/workflowProposal.ts`)
*   Create `WorkflowProposalService` with methods:
    *   `createProposal(orgId, workflowId, proposerId, proposedRule)`: saves a pending proposal and spawns an `ApprovalTask` requiring other admins to approve. Excludes `proposerId` from voting.
    *   `applyProposal(proposalId, approverId)`: transitions the proposal to `approved` and updates the active `Workflow.ruleJson`.
*   Interception:
    *   In the save rule route (`PATCH /api/workflows/[id]`), if the workflow is armed or enabled, intercept direct writes and instead call `createProposal()`.

---

## 3. UI Implementation
*   **WorkflowCreator**: Adjust the primary button to say "Propose Changes" instead of "Save Rule" when editing live rules. Show a banner if a change is already pending.
*   **WorkflowDashboard**: Add a "Proposals" queue where peer administrators can compare the current rule against the proposed rule JSON side-by-side and execute the approve/reject decisions.

---

## 4. Test Verification (`scripts/assert-four-eyes.ts`)
*   Create a test script `scripts/assert-four-eyes.ts` asserting:
    *   Modifying an active rule creates a proposal instead of modifying the live rule.
    *   Proposer is excluded from approving.
    *   Peer approval successfully updates the workflow.
*   Wire the script into `package.json`'s `test` script.
*   Verify `npm run test` and `npm run build && npm run lint` pass successfully.
