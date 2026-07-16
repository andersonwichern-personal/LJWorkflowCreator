# Specs: Phase 14 — Event-Driven Webhooks & Pipeline Integration

**Date**: 2026-07-16
**Branch Target**: `feature/webhooks-phase-14`
**Status**: APPROVED SPECIFICATION

---

## 1. Objectives & Scope
This phase replaces manual execution triggers with an automated, edge-triggered incoming webhook pipeline. It supports authenticating payloads using signature headers and matching them against workflow rules for sequential in-process execution.

Specifically, we will:
1.  **Incoming Webhook Endpoint**:
    *   Create `POST /api/platform/webhooks/receive` handler.
    *   Accept and authenticate incoming JSON payloads using signature validation (`X-Sweet-Signature` header checked against a local secret `WEBHOOK_SECRET`).
2.  **Pipeline Integration**:
    *   On a valid webhook event, query all enabled workflows for the tenant that match the event type.
    *   Evaluate conditions in-process using the `evaluateGroup` helper.
    *   If conditions match, dispatch the actions sequentially using the consolidated `executeAction` service, logging the execution trace in the `rule_executions` audit log.

---

## 2. Technical Specifications

### 2.1 Webhook Receiver (`app/api/platform/webhooks/receive/route.ts`)
*   Create a POST route that accepts a body containing:
    ```json
    {
      "event": "LOAN APPROVED",
      "requestId": "uuid-123",
      "orgId": "org-uuid",
      "payload": { "loan_amount": 350000, "stage": "Approved" }
    }
    ```
*   Verify signature:
    *   Compute the HMAC-SHA256 hash of the request body using `process.env.WEBHOOK_SECRET`.
    *   Verify it matches the `X-Sweet-Signature` header.
    *   If mismatch, return HTTP 401.

### 2.2 Execution Pipeline Wiring
*   Query `prisma.workflow.findMany({ where: { orgId, enabled: true } })`.
*   Filter workflows whose `ruleJson.triggers` contain the matching event.
*   Resolve request attributes from the webhook payload.
*   Run the evaluator. If `matched` is true, invoke the action dispatcher sequentially.
*   Log the execution output in the `RuleExecution` table.

---

## 3. Verification Plan
- Create `scripts/assert-webhooks.ts` asserting:
  - Valid signed webhook payloads are successfully matched and executed.
  - Invalid signature payloads are rejected with HTTP 401.
  - Audit traces are created for webhook execution runs.
- Run `npm run test` to verify.
