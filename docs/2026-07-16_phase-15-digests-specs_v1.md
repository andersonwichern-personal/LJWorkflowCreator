# Specs: Phase 15 — Notification Digests & Alert Batching

**Date**: 2026-07-16
**Branch Target**: `feature/digests-phase-15`
**Status**: APPROVED SPECIFICATION

---

## 1. Objectives & Scope
This phase mitigates alert fatigue by batching notification actions into aggregated digests (e.g. hourly or daily summaries) instead of dispatching individual messages immediately.

Specifically, we will:
1.  **Prisma Schema Additions**:
    *   Create a `NotificationQueue` model to hold pending notifications and digest metadata.
2.  **Queue Integration**:
    *   Refactor `actionExecutor.ts` to check if a notification should be batched.
    *   If batching is enabled, insert the notification details into `NotificationQueue` instead of dispatching it immediately.
3.  **Flush / Worker Endpoint**:
    *   Implement an API endpoint `POST /api/platform/notifications/flush-digests` representing the worker cron.
    *   Gather all unprocessed notifications, group them by recipient, and compile a single summary digest email/alert payload.
    *   Dispatch the aggregated digest and mark the queue rows as processed.

---

## 2. Technical Specifications

### 2.1 Prisma Schema (`prisma/schema.prisma`)
Add the `NotificationQueue` model (with tenant RLS scoping):
```prisma
model NotificationQueue {
  id           String    @id @default(uuid())
  orgId        String    @map("org_id")
  recipientId  String    @map("recipient_id")
  recipientType String   @map("recipient_type") // "user" | "team"
  actionType   String    @map("action_type")    // "notify" | "email"
  content      Json
  createdAt    DateTime  @default(now()) @map("created_at")
  processedAt  DateTime? @map("processed_at")

  @@index([orgId, recipientId, processedAt])
  @@map("notification_queue")
}
```

Ensure RLS policy is applied to `notification_queue`.

### 2.2 Digest Builder & Flush Worker (`app/api/platform/notifications/flush-digests/route.ts`)
*   Query all rows in `NotificationQueue` where `processedAt` is null.
*   Group these rows by `orgId` and `recipientId`.
*   For each group, build a text digest summary listing all notifications (e.g., `"Alerts Summary:\n- Loan Approved for req-123\n- Document approved for req-456"`).
*   Send the summary using the primary notifier service.
*   Update all grouped rows setting `processedAt = now()`.

---

## 3. Verification Plan
- Create `scripts/assert-digests.ts` asserting:
  - Notifications are correctly placed in the queue rather than dispatched immediately.
  - Flush endpoint correctly groups, compiles, and sends digests.
  - Processed rows are marked as complete.
- Run `npm run test` to verify.
