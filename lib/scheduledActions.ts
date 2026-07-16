/**
 * Phase 8 (§7): scheduled-action data model logic — pure.
 *
 * The scheduler itself stays DEFERRED (no worker/cron exists in this serverless
 * prototype). This module ships the correctness substrate so that when a
 * scheduler exists, rescheduling is right by construction:
 *
 *   `runAt` is NEVER authored directly — always derived from the anchor field's
 *   current value + offsetMinutes. When an anchor date changes, pending rows are
 *   marked `superseded` (principle A: history is immutable) and re-inserted with
 *   the recomputed runAt (principle C: snapshot + reconcile-on-change).
 *
 * Business-day offsets (hardening T7) are NOT solved here: offsets are raw
 * calendar minutes until a business-calendar input exists.
 */

export interface ScheduledActionRow {
  id: string;
  workflowId: string;
  requestId: string;
  actionIndex: number;
  anchorField: string;
  offsetMinutes: number;
  runAt: string; // ISO — cached derivation, see module note
  status: "pending" | "fired" | "canceled" | "superseded";
  supersedes: string | null;
}

export interface ReschedulePlan {
  /** Ids of pending rows to mark `superseded`. */
  supersede: string[];
  /** Replacement rows (no id — the store assigns one), `supersedes` chained. */
  insert: Omit<ScheduledActionRow, "id" | "status">[];
}

/** Derive a run time from an anchor instant and a signed minute offset. */
export function computeRunAt(anchorIso: string, offsetMinutes: number): string {
  const t = Date.parse(anchorIso);
  if (Number.isNaN(t)) {
    throw new Error(`Invalid anchor date: ${JSON.stringify(anchorIso)}`);
  }
  return new Date(t + offsetMinutes * 60_000).toISOString();
}

/**
 * Plan the reschedule for one anchor-field change on one request.
 *
 * Only `pending` rows whose (requestId, anchorField) match are superseded —
 * fired/canceled/superseded rows are history and are never touched. Each
 * replacement carries `supersedes: <old id>` so the chain is auditable.
 */
export function planReschedule(
  rows: ScheduledActionRow[],
  requestId: string,
  anchorField: string,
  newAnchorIso: string
): ReschedulePlan {
  const affected = rows.filter(
    (r) => r.status === "pending" && r.requestId === requestId && r.anchorField === anchorField
  );
  return {
    supersede: affected.map((r) => r.id),
    insert: affected.map((r) => ({
      workflowId: r.workflowId,
      requestId: r.requestId,
      actionIndex: r.actionIndex,
      anchorField: r.anchorField,
      offsetMinutes: r.offsetMinutes,
      runAt: computeRunAt(newAnchorIso, r.offsetMinutes),
      supersedes: r.id,
    })),
  };
}
