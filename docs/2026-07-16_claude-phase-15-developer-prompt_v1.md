# Developer Task: Phase 15 Notification Digests & Alert Batching

Target Branch: `feature/digests-phase-15`

You are the Lead Developer. Your task is to implement the notification queue, queue routing inside the action executor, and the digest flusher worker API. Do NOT follow Codex; write clean, standalone TypeScript.

---

## 1. Schema Additions (`prisma/schema.prisma`)
*   Add the `NotificationQueue` model scoped to `org_id` with appropriate RLS policies. Run migrations.

---

## 2. Queue Routing & Executor (`lib/services/actionExecutor.ts`)
*   Refactor the notification execution:
    *   If a rule action is a notification or email, check if batching/digest mode is active.
    *   If active, do not trigger the live notification. Instead, insert the content details into `NotificationQueue`.

---

## 3. Flush API (`app/api/platform/notifications/flush-digests/route.ts`)
*   Implement `POST /api/platform/notifications/flush-digests`:
    *   Load all unprocessed notifications.
    *   Group by org and recipient.
    *   Synthesize a consolidated digest summary list.
    *   Dispatch the summary and mark the queue records as `processedAt`.

---

## 4. Test Verification (`scripts/assert-digests.ts`)
*   Create a test script `scripts/assert-digests.ts` asserting:
    *   Notifications are queued rather than immediately sent.
    *   Flush groups, summarizes, and dispatches digests.
    *   Processed rows are updated.
*   Wire the script into `package.json`'s `test` script.
*   Verify `npm run test` and `npm run build && npm run lint` pass successfully.
