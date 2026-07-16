import { prisma } from "@/lib/prisma";
import { ScheduledAction } from "@prisma/client";
import { planReschedule, ScheduledActionRow } from "@/lib/scheduledActions";

/**
 * Phase 8 (§7): persistence for the scheduled-action data model. The plan
 * itself is pure (lib/scheduledActions.ts); this service applies it
 * transactionally. NO polling scheduler exists — firing stays deferred (no
 * worker/cron in the serverless prototype).
 */
export class ScheduledActionService {
  static async listForRequest(orgId: string, requestId: string): Promise<ScheduledAction[]> {
    if (!orgId) throw new Error("Organization ID is required to list scheduled actions");
    return prisma.scheduledAction.findMany({
      where: { orgId, requestId },
      orderBy: { runAt: "asc" },
    });
  }

  /**
   * Reconcile pending rows after an anchor date changed: supersede-and-reinsert.
   * Old rows are marked `superseded` (never mutated in place — history is
   * immutable); replacements re-derive runAt from the new anchor and chain
   * `supersedes` to the old id. Applied in ONE transaction so a crash can't
   * leave the request half-rescheduled.
   */
  static async reconcile(
    orgId: string,
    requestId: string,
    anchorField: string,
    newAnchorIso: string,
    nowIso: string
  ): Promise<{ superseded: number; created: number }> {
    if (!orgId) throw new Error("Organization ID is required to reconcile scheduled actions");
    if (!requestId || !anchorField) {
      throw new Error("requestId and anchorField are required to reconcile scheduled actions");
    }
    if (Number.isNaN(Date.parse(nowIso))) {
      throw new Error(`Invalid nowIso: ${JSON.stringify(nowIso)}`);
    }

    const pending = await prisma.scheduledAction.findMany({
      where: { orgId, requestId, anchorField, status: "pending" },
    });
    const rows: ScheduledActionRow[] = pending.map((row) => ({
      id: row.id,
      workflowId: row.workflowId,
      requestId: row.requestId,
      actionIndex: row.actionIndex,
      anchorField: row.anchorField,
      offsetMinutes: row.offsetMinutes,
      runAt: row.runAt.toISOString(),
      status: "pending",
      supersedes: row.supersedes,
    }));
    const plan = planReschedule(rows, requestId, anchorField, newAnchorIso);
    if (plan.supersede.length === 0 && plan.insert.length === 0) {
      return { superseded: 0, created: 0 };
    }

    const [updated, created] = await prisma.$transaction([
      prisma.scheduledAction.updateMany({
        where: { orgId, id: { in: plan.supersede }, status: "pending" },
        data: { status: "superseded" },
      }),
      prisma.scheduledAction.createMany({
        data: plan.insert.map((row) => ({
          orgId,
          workflowId: row.workflowId,
          requestId: row.requestId,
          actionIndex: row.actionIndex,
          anchorField: row.anchorField,
          offsetMinutes: row.offsetMinutes,
          runAt: new Date(row.runAt),
          status: "pending",
          supersedes: row.supersedes,
        })),
      }),
    ]);
    return { superseded: updated.count, created: created.count };
  }
}
