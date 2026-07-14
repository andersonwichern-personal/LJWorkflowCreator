import { prisma } from "@/lib/prisma";
import { Prisma, RuleExecution } from "@prisma/client";

/** Allowed audit statuses (prompt §1 — stored as String, validated here). */
export const EXECUTION_STATUSES = ["FIRED", "CONDITIONS_NOT_MET", "ERROR"] as const;
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
        evaluationTrace: data.trace,
        actionsDispatched: data.actions,
      },
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
