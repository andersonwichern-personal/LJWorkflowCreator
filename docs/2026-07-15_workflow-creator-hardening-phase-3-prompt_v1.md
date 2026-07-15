# Prompt: Phase 3 — Approval Topologies, User Viewpoints, and Switchers

## Task Description
Implement **Phase 3 (ApprovalRequirement)** of the Hardening Plan. You will introduce multi-approver topologies (quorums, step sequences, maker-checker exclusions), database schemas for active tasks, user permission viewpoints (Admin vs. Approver vs. Preparer), and a presentation view layout toggle.

You MUST perform this work on a new git branch: `feature/hardening-phase-3`.

---

## 1. Database Schema (`prisma/schema.prisma`)
*   Add RLS-secured `ApprovalTask` and `ApprovalDecision` models:
    ```prisma
    model ApprovalTask {
      id          String   @id @default(uuid())
      orgId       String   @map("org_id")
      authorityId String   @map("authority_id")
      requestId   String   @map("request_id")
      requirement Json
      status      String   // "open" | "approved" | "declined" | "expired"
      createdAt   DateTime @default(now()) @map("created_at")
      decisions   ApprovalDecision[]
      authority   ApprovalAuthority @relation(fields: [authorityId], references: [id], onDelete: Cascade)
      @@index([orgId, requestId])
      @@map("approval_tasks")
    }

    model ApprovalDecision {
      id        String   @id @default(uuid())
      taskId    String   @map("task_id")
      approverId String  @map("approver_id")
      approverLabel String @map("approver_label")
      verdict   String   // "approve" | "decline" | "abstain"
      note      String?
      createdAt DateTime @default(now()) @map("created_at")
      task      ApprovalTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
      @@unique([taskId, approverId])
      @@map("approval_decisions")
    }
    ```
*   Update `ApprovalAuthority` to include `requirement Json? @map("requirement")`.
*   Run the schema generation: `npx prisma generate`.
*   Run local migration setup. Ensure RLS policies match existing tables by copying the tenantorg policies.

---

## 2. Logic Engine (`lib/authorityEngine.ts`)
Implement standard approval requirement interface checks:
*   Define:
    ```ts
    export type ApprovalRequirement =
      | { type: "any_of"; approvers: { id: string; label: string }[] }
      | { type: "n_of"; count: number; approvers: { id: string; label: string }[] }
      | { type: "all_of"; approvers: { id: string; label: string }[] }
      | { type: "sequence"; steps: ApprovalRequirement[] };
    ```
*   Implement `evaluateRequirement(req: ApprovalRequirement, ctx: DecisionContext): RequirementStatus`:
    *   Filter out any approver listed in `ctx.exclusions` before counting (enforce Maker-Checker rules: the requester or rule author cannot vote).
    *   Evaluate quorums (`any_of`, `n_of`, `all_of`).
    *   Evaluate sequences (gated step-by-step review paths up to 5 steps).
*   Integrate this evaluator inside `decideAuthority` returns.

---

## 3. UI Gating, Role Switcher, & Demo Layout (Presentation vs. Builder)
*   **Role Switcher (Header)**: Add a dropdown in the page header to toggle viewpoints:
    *   `Anderson (Admin)`: Full edit rights on the canvas and authority drawer.
    *   `Wael (Approver)`: Settings read-only, active voting buttons enabled on outstanding tasks they belong to.
    *   `Omar (Preparer)`: Settings read-only, barred from voting on approvals due to Maker-Checker rules.
*   **Demo Toggle (Presentation vs. Builder Views)**: Add a toggle to switch layouts:
    *   *Presentation View*: Clean, client-facing mode. Hides dev logs, linter panels, simulation traces, and RLS metadata.
    *   *Builder View*: Full developer interface showing logs, traces, and metrics.
*   **Decisions Cards (`components/ApprovalAuthorities.tsx`)**: Replace the static checklist with the dynamic requirement configuration drawer and interactive voting checkboxes.

---

## 4. API Routes & Tests
*   Create routes:
    *   `POST /api/platform/authorities/tasks` - Initialize a review request.
    *   `POST /api/platform/authorities/tasks/[id]/decisions` - Record approval/declination.
    *   `GET /api/platform/authorities/tasks?requestId=...` - List tasks for a request.
*   Create `scripts/assert-requirement.ts` and run tests verifying quorums, sequences, Maker-Checker exclusions, and status transitions.
*   Ensure: `npm run test && npm run build && npm run lint` passes cleanly.
