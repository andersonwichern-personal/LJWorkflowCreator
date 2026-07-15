import { prisma } from "@/lib/prisma";
import { Prisma, RuleExecution } from "@prisma/client";

/**
 * Allowed audit statuses (stored as String, validated here).
 * Phase 1: FIRED / CONDITIONS_NOT_MET / ERROR.
 * Phase 4 (fire route): SHADOW (matched but observe-only), and the guardrail
 * outcomes PAUSED_ORG / SKIPPED_DUPLICATE / PAUSED_RATE_LIMIT.
 */
export const EXECUTION_STATUSES = [
  "FIRED",
  "CONDITIONS_NOT_MET",
  "ERROR",
  "SHADOW",
  "PAUSED_ORG",
  "SKIPPED_DUPLICATE",
  "PAUSED_RATE_LIMIT",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/** List rows carry the workflow's name for the audit table. */
export type ExecutionWithWorkflow = RuleExecution & {
  workflow: { id: string; name: string } | null;
};

export class RuleExecutionService {
  /** Persist one rule-evaluation outcome (simulator dry-runs included). */
  static async logExecution(data: {
    orgId: string;
    workflowId: string;
    requestId: string;
    requestName: string;
    eventName: string;
    status: string;
    mode?: string;
    trace: Prisma.InputJsonValue;
    actions: Prisma.InputJsonValue;
  }): Promise<RuleExecution> {
    if (!data.orgId) {
      throw new Error("Organization ID is required to log an execution");
    }
    if (!data.workflowId) {
      throw new Error("Workflow ID is required to log an execution");
    }
    if (!EXECUTION_STATUSES.includes(data.status as ExecutionStatus)) {
      throw new Error(`Status must be one of: ${EXECUTION_STATUSES.join(", ")}`);
    }

    // Tenant scoping: the workflow being logged against must belong to the org.
    const workflow = await prisma.workflow.findFirst({
      where: { id: data.workflowId, orgId: data.orgId },
    });
    if (!workflow) {
      throw new Error("Workflow not found or access denied");
    }

    return prisma.ruleExecution.create({
      data: {
        orgId: data.orgId,
        workflowId: data.workflowId,
        requestId: data.requestId,
        requestName: data.requestName,
        eventName: data.eventName,
        status: data.status,
        mode: data.mode === "armed" ? "armed" : "shadow",
        evaluationTrace: data.trace,
        actionsDispatched: data.actions,
      },
    });
  }

  /**
   * Has this workflow already FIRED for this request? (`oncePerRequest` gate.)
   * Only real firings dedupe — shadow/guardrail rows never block a later arm.
   */
  static async hasFired(orgId: string, workflowId: string, requestId: string): Promise<boolean> {
    const existing = await prisma.ruleExecution.findFirst({
      where: { orgId, workflowId, requestId, status: "FIRED" },
      select: { id: true },
    });
    return existing !== null;
  }

  /** Count FIRED rows for a workflow in the trailing `windowMs` (rate cap). */
  static async countFiredSince(
    orgId: string,
    workflowId: string,
    since: Date
  ): Promise<number> {
    return prisma.ruleExecution.count({
      where: { orgId, workflowId, status: "FIRED", createdAt: { gte: since } },
    });
  }

  /** Newest-first audit log for a tenant (bounded for the table view). */
  static async listExecutions(orgId: string, limit = 100): Promise<ExecutionWithWorkflow[]> {
    if (!orgId) {
      throw new Error("Organization ID is required to list executions");
    }

    return prisma.ruleExecution.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { workflow: { select: { id: true, name: true } } },
    });
  }
}
