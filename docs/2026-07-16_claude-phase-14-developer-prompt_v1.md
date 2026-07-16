# Developer Task: Phase 14 Event-Driven Webhooks & Pipeline Integration

Target Branch: `feature/webhooks-phase-14`

You are the Lead Developer. Your task is to implement the incoming webhook receiver, signature authentication, and execution pipeline integration. Do NOT follow Codex; write clean, standalone TypeScript.

---

## 1. Webhook Route (`app/api/platform/webhooks/receive/route.ts`)
*   Implement `POST /api/platform/webhooks/receive` accepting `{ event, requestId, orgId, payload }`.
*   Validate incoming requests using the HMAC-SHA256 signature calculated from the body using `process.env.WEBHOOK_SECRET` and compared against the `X-Sweet-Signature` header. If invalid, return HTTP 401.

---

## 2. Pipeline Dispatch
*   Fetch enabled workflows for the payload's `orgId`.
*   Filter workflows by the incoming `event` trigger.
*   For each matching workflow:
    *   Evaluate conditions against the `payload` fields.
    *   If matched, execute actions sequentially using `executeAction` and log results to `rule_executions`.

---

## 3. Test Verification (`scripts/assert-webhooks.ts`)
*   Create a test script `scripts/assert-webhooks.ts` asserting:
    *   Valid signed webhook payloads trigger execution.
    *   Invalid signature payloads are rejected.
    *   Execution audit traces are recorded.
*   Wire the script into `package.json`'s `test` script.
*   Verify `npm run test` and `npm run build && npm run lint` pass successfully.
