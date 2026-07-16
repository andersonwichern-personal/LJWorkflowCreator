# Agent task ledger

Shared between Claude and Codex. Both agents re-read this before every edit and
every compile. Check `[x]` the moment a sub-task is done — the other agent is
waiting on that mark to know a module is safe to import.

Protocol: `.claude/skills/goal/SKILL.md` (`/goal`).

---

# Phase 13 — Four-Eyes (Maker-Checker) Rule Activation

Spec: `docs/2026-07-16_phase-13-four-eyes-specs_v1.md`
Branch: `feature/four-eyes-phase-13`
Status: backend done and committed (`bf4b01b`, `a2a53f1`); §2.3 UI outstanding.

## Claude — UI components, validation scripts, lib/

- [x] `lib/fourEyes.ts` — single gate (`shouldProposeWorkflowWrite`); the rival
      `requiresProposal` was deleted after Anderson picked the OR semantics
- [x] `lib/services/workflow.ts` — interception + `ProposalRequiredError`
- [x] `scripts/assert-four-eyes.ts` — 13 assertions, wired into `npm run test`
- [x] §2.3 "Propose Changes" button — swap the save label when the gate would
      fire, so the button states what will actually happen
- [x] §2.3 pending-proposal banner in the builder canvas
- [x] §2.3 "Proposals" dashboard tab — list pending, diff proposed vs current
      rule JSON, approve/reject
- [x] Surface the route's `202 { pendingProposalId, proposalStatus }` in
      `lib/api.ts` — the gate works but nothing shows the user their change
      became a proposal

## Codex — backend routes

- [x] `app/api/workflows/[id]/route.ts` — catches `ProposalRequiredError` → 202
- [x] `lib/services/workflowProposal.ts` — create/apply/reject + task spawn
- [x] `prisma/schema.prisma` + `20260716140000_phase13_four_eyes` migration
- [x] `lib/proposals.ts` — legacy local draft markers preserved; durable
      proposal flow now uses `WorkflowProposal` APIs instead

## Blocked / needs a human

- **`DEMO_ADMIN_APPROVERS` is hardcoded** in `lib/services/workflowProposal.ts`
  (`u-anderson`, `u-aisha-admin`). The checker pool must come from the live
  user directory before this is real; a single-admin org currently produces a
  requirement nobody can satisfy, which is correct but untested against live
  data.
- **Ownership contract is stale.** CLAUDE.md casts Codex as "keyboard
  autocomplete" drafting dependency-free files, but it is authoring whole
  modules including `WorkflowCreator.tsx` — which the same doc assigns to
  Claude. The §2.3 UI sits exactly on that contested boundary. Resolve before
  starting it, or the collision repeats.

---

# Phase 14 — not started

**No spec exists.** `docs/` contains specs for phases 8, 9, 10, 11, 12, 13 only.
Gemini owns spec authorship; do not infer requirements. Blocked until
`docs/2026-07-*_phase-14-*-specs_v1.md` lands.

# Phase 15 — not started

**No spec exists.** Same as above.
