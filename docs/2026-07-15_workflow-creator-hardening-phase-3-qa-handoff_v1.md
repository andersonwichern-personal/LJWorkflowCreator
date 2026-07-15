# Phase 3 — QA Handoff for Gemini (Overseer)

**From:** Claude (Coder)
**Date:** 2026-07-15
**Branch:** `feature/hardening-phase-3` (local only — not yet pushed)
**Tip commit:** `619f671` — *feat(hardening): Phase 3 — approval topologies, viewpoints, and view switcher*
**Prompt spec:** `docs/2026-07-15_workflow-creator-hardening-phase-3-prompt_v1.md`

---

## 1. Status at a glance

| Gate | Result |
|------|--------|
| `npm run test` | ✅ pass (all suites, incl. 37 requirement assertions) |
| `npm run build` | ✅ pass (both new routes registered) |
| `npm run lint` | ✅ pass (no ESLint warnings/errors) |
| `npx tsc --noEmit` | ✅ clean |
| Live API end-to-end smoke | ✅ full task lifecycle verified against dev server |

Every acceptance gate in §4 of the prompt (`npm run test && npm run build && npm run lint`) passes cleanly.

---

## 2. What was delivered (mapped to the prompt)

### §1 Database schema
- `ApprovalTask` and `ApprovalDecision` models added to `prisma/schema.prisma`; `requirement Json?` added to `ApprovalAuthority`.
- Tables created on Supabase with **tenant RLS matching the existing tables**: `approval_tasks` uses the same `auth.jwt() ->> 'org_id' = org_id` policy; `approval_decisions` (which carries no `org_id`) scopes through its parent task via an `EXISTS` subquery.
- Cascade FKs, `(org_id, request_id)` index, and the `@@unique([taskId, approverId])` one-vote-per-seat constraint are all live and verified.

### §2 Logic engine (`lib/authorityEngine.ts`)
- `ApprovalRequirement` union: `any_of | n_of | all_of | sequence`.
- `evaluateRequirement(req, ctx)` — filters `ctx.exclusions` before counting (maker-checker), evaluates all three quorum kinds, gates sequences step-by-step (later-step votes neither count nor advance until earlier steps satisfy), capped at 5 steps.
- `normalizeRequirement` handles legacy `userIds` arrays → `any_of` with unresolved ids.
- `decideAuthority` now returns the owning level's normalized `requirement` and names the quorum in its audit `reason`.

### §3 UI (role switcher, demo layout, decisions cards)
- **Role switcher** (`lib/viewpoint.tsx` + header in `app/page.tsx`): Anderson (Admin) / Wael (Approver) / Omar (Preparer). Admin edits; Approver + Preparer get read-only settings; voting is offered only to the outstanding seat.
- **Presentation vs Builder toggle**: Presentation hides the Audit Logs tab, simulation panel, lint/unconfirmed warnings, and rule JSON. Persisted to `localStorage`.
- **Decisions cards** (`components/ApprovalAuthorities.tsx` + `components/RequirementEditor.tsx`): static checklist replaced by the dynamic requirement drawer (any/N-of/all + sequences) and interactive per-seat voting cards.

### §4 API routes & tests
- `POST/GET /api/platform/authorities/tasks`
- `POST /api/platform/authorities/tasks/[id]/decisions`
- `scripts/assert-requirement.ts` wired into `npm test`; quorums, sequences, maker-checker exclusions, delegation, and status transitions all covered and green.

---

## 3. Priority review areas (where I want your eyes)

1. **RLS parity for `approval_decisions`.** It has no `org_id` column, so I isolated it through the parent task rather than a direct `org_id` match. Please confirm this satisfies the "copy the tenantorg policies" requirement — it's the one place the policy shape necessarily differs from the template.
2. **Server-side enforcement vs. UI gating.** The role switcher is demo-only UI. The *hard* rules (maker-checker bar, current-step eligibility, closed-task lockout, duplicate-vote rejection) are enforced in `lib/services/approvalTask.ts` and return 403/409 independently of the client. Worth confirming the honesty guardrail holds: no UI affordance implies a gate that the server doesn't also enforce.
3. **Requirement envelope.** The task's `requirement` column stores an envelope `{ requirement, exclusions, delegations }` so maker-checker exclusions are frozen at creation time. Confirm you're comfortable with exclusions being immutable post-creation.
4. **Sequence cap.** Enforced at 5 steps in both the engine (`MAX_SEQUENCE_STEPS`) and the editor UI. Please sanity-check that's the intended ceiling.

---

## 4. Live smoke test (already run, reproducible)

Against a throwaway `sequence` authority (officer → 2-of-3 committee, Omar excluded), verified:

| Action | Expected | Observed |
|--------|----------|----------|
| Omar (excluded) votes | barred | `403` maker-checker |
| Sara votes on step 2 while step 1 open | ineligible | `403` not eligible at current step |
| Wael approves step 1 | advances | `201`, step→1, outstanding = Sara+Mohammed |
| Wael re-votes | locked | `409` already voted |
| Sara + Mohammed approve | quorum met | `201`, status `approved` |
| Any vote after approval | closed | `409` voting is closed |

All throwaway rows were deleted; cascade delete of the authority removed its tasks + decisions.

One bug was found and fixed during this pass: eligibility rejection was returning `500` instead of `403` (regex in the decisions route now matches "not eligible at the current review step").

---

## 5. Two things that need an Overseer decision

1. **Migration files are gitignored.** `prisma/migrations/` is in `.gitignore` (repo convention, same as Phases 0–2). The Phase 3 migration SQL exists locally and was applied + `migrate resolve`d against Supabase (`migrate status` is clean), but it is **not** in the commit. If Phase 3 should ship the migration in-tree, that's a convention change for you to rule on.

2. **⚠️ Commit `0105b8c` ("style(chatbox)…") is mislabeled.** It was authored under Anderson's identity while I was mid-implementation and swept in ~half of the Phase 3 tracked-file edits (engine, schema, authority service/routes, decisions cards, header switchers) *plus* Codex's parse-ai work — under a commit message that only mentions chatbox border styling. On a clean checkout that commit's tip was unbuildable (it imports modules that weren't committed until my `619f671`). I did **not** rewrite history. Flagging because a history audit will find a 1,047-line "style" commit that doesn't match its message. Recommend either amending the message or squashing `0105b8c` + `619f671` into one honest Phase 3 commit before this branch merges.

---

## 6. Next actions (awaiting your sign-off)

- [ ] Gemini QA review of the four areas in §3
- [ ] Decision on §5.1 (migration in-tree?) and §5.2 (commit history cleanup)
- [ ] On approval: push `feature/hardening-phase-3` and open the PR
