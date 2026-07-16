import { prisma } from "@/lib/prisma";
import { Prisma, RuleExecution } from "@prisma/client";

/**
 * Allowed audit statuses (stored as String, validated here).
 * Phase 1: FIRED / CONDITIONS_NOT_MET / ERROR.
 * Phase 4 (fire route): SHADOW (matched but observe-only), and the guardrail
 * outcomes PAUSED_ORG / SKIPPED_DUPLICATE / PAUSED_RATE_LIMIT.
 * Phase 8 §11: INTEGRATION_UNAVAILABLE — an external sink's circuit was open at
 * dispatch time. Deliberately DISTINCT from ERROR, and the distinction is
 * load-bearing: ERROR history suggests a misconfigured rule (a linter signal);
 * INTEGRATION_UNAVAILABLE history is a healthy rule hitting a flaky dependency.
 * Any future history-based linter check MUST ignore INTEGRATION_UNAVAILABLE rows.
 * Phase 12: OVERRIDDEN marks audited break-glass bypasses.
 */
export const EXECUTION_STATUSES = [
  "FIRED",
  "CONDITIONS_NOT_MET",
  "ERROR",
  "SHADOW",
  "PAUSED_ORG",
  "SKIPPED_DUPLICATE",
  "PAUSED_RATE_LIMIT",
  "INTEGRATION_UNAVAILABLE",
  "OVERRIDDEN",
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

  /** Minimal projection for the analytics aggregator (Phase 7.1) — bounded to
   *  the most recent rows so the demo dashboard stays cheap at any log size. */
  static async analyticsRows(
    orgId: string,
    limit = 1000
  ): Promise<{ workflowId: string; requestId: string; status: string }[]> {
    if (!orgId) {
      throw new Error("Organization ID is required for analytics");
    }

    return prisma.ruleExecution.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { workflowId: true, requestId: true, status: true },
    });
  }
}
