# Prompt: Phase 4 — Trust Machinery: Shadow/Armed, Backtesting, Linter, and Kill Switch

## Task Description
Implement **Phase 4 (Trust Machinery)** of the Hardening Plan. You will introduce shadow vs armed enforcement modes, automated rate limiting checks, batch backtesting against requests, static rule linting (contradictory filters, broken refs, and missing notice checks), and a global pauses automation switch.

You MUST perform this work on a new git branch: `feature/hardening-phase-4`.

---

## 1. Database & Action Executor (`prisma/schema.prisma` & `lib/services/actionExecutor.ts`)
*   **Schema modifications**:
    *   Add `mode String @default("shadow")` to `RuleExecution`.
    *   Add `WorkflowOrgControls` model:
        ```prisma
        model WorkflowOrgControls {
          orgId             String   @id @map("org_id")
          automationsPaused Boolean  @default(false) @map("automations_paused")
          updatedAt         DateTime @updatedAt @map("updated_at")
          @@map("workflow_org_controls")
        }
        ```
    *   Generate and run database migrations. Set up RLS orgId policies copying from existing tables.
*   **Action Executor (`lib/services/actionExecutor.ts`)**:
    *   Extract the core execution handler from `app/api/execute/route.ts` to `lib/services/actionExecutor.ts` as `executeAction(action, params, ctx)`.
    *   Route `/api/execute` should become a thin wrapper that imports this service.
    *   Enforce action execution parameters (retries, halt-on-failure).

---

## 2. API Routes (`fire` and `backtest`)
*   **`POST /api/workflows/[id]/fire`** (body: `{ requestId }`):
    *   Verify if automations are paused via `WorkflowOrgControls`. If paused, log execution as `PAUSED_ORG` and return.
    *   Verify `oncePerRequest` controls: check if an execution row already exists with status `FIRED` for this request and workflow. If so, log as `SKIPPED_DUPLICATE` and return.
    *   Verify `maxFiresPerHour` rate cap: count the `FIRED` execution rows for this workflow in the last hour. If it exceeds the cap, auto-disable the workflow (`enabled=false`), log a `PAUSED_RATE_LIMIT` execution row, send a notification, and return.
    *   Run rule evaluation: if matched and mode is `armed`, execute actions sequentially. If `shadow`, skip action calls and log execution with `mode: "shadow"`.
*   **`POST /api/workflows/backtest`** (body: `{ rule }`):
    *   Run rule evaluation over all existing mock/live request records in the database.
    *   Return `{ total, matches: [{ requestId, name, matchedTrigger, actions }], alerts }`.

---

## 3. Linter Logic (`lib/ruleLinter.ts`)
*   Implement `lintRule(rule, ctx)` returning `RuleIssue[]` checking for:
    *   `DEAD_CONDITION`: Overlapping filters (e.g. `amount gt 50k` AND `amount lt 10k` under AND).
    *   `OVERLAP`: Warnings when a rule's leaves are a subset of another active armed rule's leaves.
    *   `BROKEN_REF`: Broken stage, field, user, or template references.
    *   `MISSING_DATA_EXPOSURE`: References fields not populated by live template fields.
    *   `AUTO_REJECT_WITHOUT_NOTICE`: Bar rejections without paired notification actions (Blocking Error).
    *   `PROHIBITED_BASIS_REVIEW`: Warning on GEO/demographic filters.
    *   `GATED_TOKEN_ARMED`: Warnings if using un-executable mock tokens.
*   Enforce this linter in `save()` (block save on error severity).

---

## 4. Frontend Integration
*   **AuditLogs Upgrades**: Add `All`, `Armed`, `Shadow` filters and render colored mode tags on the execution row cards.
*   **Linter Dashboard**: Render issues dynamically below the builder matrix, highlighting blocking errors.
*   **Backtest UI**: Add a **Backtest** button next to simulation that triggers the backtesting endpoint and shows the count of matching requests.
*   **Pause Automations Switch**: Add a header button `⏸ Pause all automations` and display a prominent orange banner in the layout when paused.

---

## 5. Verification
*   Create `scripts/assert-linter.ts` testing all 7 linter warning/error codes.
*   Verify full test suites: `npm run test && npm run build && npm run lint`.
