import { prisma } from "@/lib/prisma";
import { WorkflowOrgControls } from "@prisma/client";

/**
 * Per-org automation kill switch (Phase 4 §1/§4). A single row per tenant holds
 * the global pause flag the `fire` route consults before running any workflow.
 */
export class OrgControlsService {
  /** Read the tenant's controls, defaulting to "not paused" when no row exists. */
  static async get(orgId: string): Promise<{ orgId: string; automationsPaused: boolean; updatedAt: string | null }> {
    if (!orgId) throw new Error("Organization ID is required to read controls");
    const row = await prisma.workflowOrgControls.findUnique({ where: { orgId } });
    return {
      orgId,
      automationsPaused: row?.automationsPaused ?? false,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  /** True when automations are globally paused for the tenant. */
  static async isPaused(orgId: string): Promise<boolean> {
    if (!orgId) return false;
    const row = await prisma.workflowOrgControls.findUnique({
      where: { orgId },
      select: { automationsPaused: true },
    });
    return row?.automationsPaused ?? false;
  }

  /** Set the global pause flag (upsert — the row is created on first toggle). */
  static async setPaused(orgId: string, paused: boolean): Promise<WorkflowOrgControls> {
    if (!orgId) throw new Error("Organization ID is required to set controls");
    return prisma.workflowOrgControls.upsert({
      where: { orgId },
      create: { orgId, automationsPaused: paused },
      update: { automationsPaused: paused },
    });
  }
}
