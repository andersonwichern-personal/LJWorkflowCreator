import { prisma } from "@/lib/prisma";
import { ApprovalDecision, ApprovalTask, Prisma } from "@prisma/client";
import {
  ApprovalRequirement,
  ApprovalVerdict,
  DecisionContext,
  RequirementStatus,
  evaluateRequirement,
  normalizeRequirement,
  requirementApprovers,
} from "@/lib/authorityEngine";
import { DelegationService } from "@/lib/services/delegation";

export type TaskStatus = "open" | "approved" | "declined" | "expired" | "overridden";

const VERDICTS: ApprovalVerdict[] = ["approve", "decline", "abstain"];

/**
 * The `requirement` Json column stores an envelope so server-side enforcement
 * survives round-trips: the topology itself plus the maker-checker exclusion
 * list frozen at task creation (requester + rule author ids).
 */
export interface TaskRequirementEnvelope {
  requirement: ApprovalRequirement;
  exclusions: string[];
  delegations: { fromId: string; toId: string }[];
}

export type TaskWithDecisions = ApprovalTask & {
  decisions: ApprovalDecision[];
  authority: { id: string; name: string } | null;
};

const TASK_INCLUDE = {
  decisions: { orderBy: { createdAt: "asc" } },
  authority: { select: { id: true, name: true } },
} satisfies Prisma.ApprovalTaskInclude;

/** Parse a stored requirement column, tolerating a bare requirement (no envelope). */
export function parseTaskEnvelope(raw: unknown): TaskRequirementEnvelope {
  const o = (raw ?? {}) as {
    requirement?: unknown;
    exclusions?: unknown;
    delegations?: unknown;
    type?: unknown;
  };
  const bare = typeof o.type === "string"; // bare ApprovalRequirement, not an envelope
  return {
    requirement: normalizeRequirement(bare ? o : o.requirement),
    exclusions: Array.isArray(o.exclusions) ? o.exclusions.map(String) : [],
    delegations: Array.isArray(o.delegations)
      ? o.delegations
          .map((d) => d as { fromId?: unknown; toId?: unknown })
          .filter((d) => typeof d.fromId === "string" && typeof d.toId === "string")
          .map((d) => ({ fromId: String(d.fromId), toId: String(d.toId) }))
      : [],
  };
}

function contextFor(envelope: TaskRequirementEnvelope, decisions: ApprovalDecision[]): DecisionContext {
  return {
    decisions: decisions.map((d) => ({
      approverId: d.approverId,
      verdict: d.verdict as ApprovalVerdict,
    })),
    exclusions: envelope.exclusions,
    delegations: envelope.delegations,
  };
}

/** Evaluate a task's requirement against its recorded decisions. */
export function taskRequirementStatus(task: TaskWithDecisions): RequirementStatus {
  const envelope = parseTaskEnvelope(task.requirement);
  return evaluateRequirement(envelope.requirement, contextFor(envelope, task.decisions));
}

function statusFrom(rs: RequirementStatus): TaskStatus {
  return rs.satisfied ? "approved" : rs.declined ? "declined" : "open";
}

function delegationFor(envelope: TaskRequirementEnvelope, approverId: string) {
  return envelope.delegations.find((d) => d.toId === approverId) ?? null;
}

export class ApprovalTaskService {
  /** List review tasks for a tenant, newest first, optionally scoped to one request. */
  static async listTasks(orgId: string, requestId?: string): Promise<TaskWithDecisions[]> {
    if (!orgId) {
      throw new Error("Organization ID is required to list approval tasks");
    }
    return prisma.approvalTask.findMany({
      where: { orgId, ...(requestId ? { requestId } : {}) },
      orderBy: { createdAt: "desc" },
      include: TASK_INCLUDE,
    });
  }

  /**
   * Initialize a review task for a request against an authority level. The
   * requirement defaults to the authority's configured topology (legacy
   * `userIds` fall back to any-of); exclusions freeze the maker-checker rule.
   */
  static async createTask(data: {
    orgId: string;
    authorityId: string;
    requestId: string;
    requirement?: unknown;
    exclusions?: string[];
    delegations?: { fromId: string; toId: string }[];
  }): Promise<TaskWithDecisions> {
    if (!data.orgId) throw new Error("Organization ID is required to create a task");
    if (!data.requestId?.trim()) throw new Error("Request ID is required to create a task");
    if (!data.authorityId) throw new Error("Authority ID is required to create a task");

    const authority = await prisma.approvalAuthority.findFirst({
      where: { id: data.authorityId, orgId: data.orgId },
    });
    if (!authority) {
      throw new Error("Authority not found or access denied");
    }

    const requirement = normalizeRequirement(
      data.requirement ?? authority.requirement ?? authority.userIds
    );
    if (requirementApprovers(requirement).length === 0) {
      throw new Error("Requirement must name at least one approver");
    }

    const delegations =
      data.delegations ??
      (await DelegationService.listActive(data.orgId, data.authorityId));

    const envelope: TaskRequirementEnvelope = {
      requirement,
      exclusions: (data.exclusions ?? []).map(String),
      delegations,
    };

    // A task nobody can ever satisfy (all seats excluded) must not be created.
    const initial = evaluateRequirement(requirement, contextFor(envelope, []));
    if (initial.declined) {
      throw new Error(
        "Requirement cannot be satisfied: every approver seat is excluded by maker-checker rules"
      );
    }

    return prisma.approvalTask.create({
      data: {
        orgId: data.orgId,
        authorityId: data.authorityId,
        requestId: data.requestId.trim(),
        requirement: envelope as unknown as Prisma.InputJsonValue,
        status: statusFrom(initial),
      },
      include: TASK_INCLUDE,
    });
  }

  /**
   * Record (or revise, while the task is open) one approver's verdict, then
   * re-evaluate the topology and roll the task status forward.
   */
  static async recordDecision(
    taskId: string,
    orgId: string,
    input: { approverId: string; approverLabel?: string; verdict: string; note?: string | null }
  ): Promise<{ task: TaskWithDecisions; status: RequirementStatus }> {
    if (!taskId) throw new Error("Task ID is required to record a decision");
    if (!orgId) throw new Error("Organization ID is required to record a decision");
    if (!input.approverId?.trim()) throw new Error("Approver ID is required");
    if (!VERDICTS.includes(input.verdict as ApprovalVerdict)) {
      throw new Error(`Verdict must be one of: ${VERDICTS.join(", ")}`);
    }

    const task = await prisma.approvalTask.findFirst({
      where: { id: taskId, orgId },
      include: TASK_INCLUDE,
    });
    if (!task) {
      throw new Error("Task not found or access denied");
    }
    if (task.status !== "open") {
      throw new Error(`Task is already ${task.status} — voting is closed`);
    }

    const envelope = parseTaskEnvelope(task.requirement);
    const approverId = input.approverId.trim();

    // Maker-checker: the requester / rule author cannot vote, full stop.
    if (envelope.exclusions.includes(approverId)) {
      throw new Error("Voting is barred by maker-checker rules for this approver");
    }
    if (task.decisions.some((decision) => decision.approverId === approverId)) {
      throw new Error("Approver has already voted on this task");
    }

    // Strict sequence gating: only seats outstanding on the current step may
    // vote. Later-step approvers become eligible after prior steps satisfy.
    const current = evaluateRequirement(
      envelope.requirement,
      contextFor(envelope, task.decisions)
    );
    const seat = current.outstanding.find((candidate) => candidate.id === approverId);
    if (!seat) {
      throw new Error("Approver is not eligible at the current review step");
    }

    const delegated = delegationFor(envelope, approverId);
    const label =
      input.approverLabel?.trim() ||
      seat.label ||
      approverId;
    const note = [
      input.note?.trim() || null,
      delegated ? `${input.verdict} by ${approverId} as delegate of ${delegated.fromId}` : null,
    ].filter(Boolean).join(" · ") || null;

    await prisma.approvalDecision.create({
      data: {
        taskId,
        approverId,
        approverLabel: label,
        verdict: input.verdict,
        note,
      },
    });

    const decisions = await prisma.approvalDecision.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
    });
    const status = evaluateRequirement(envelope.requirement, contextFor(envelope, decisions));

    const updated = await prisma.approvalTask.update({
      where: { id: taskId },
      data: { status: statusFrom(status) },
      include: TASK_INCLUDE,
    });
    if (status.satisfied) {
      const { WorkflowProposalService } = await import("@/lib/services/workflowProposal");
      await WorkflowProposalService.applyApprovedTask(taskId);
    }

    return { task: updated, status };
  }

  /** Emergency override for all open approval tasks on a request. */
  static async overrideRequest(data: {
    orgId: string;
    requestId: string;
    reason: string;
  }): Promise<{ count: number }> {
    if (!data.orgId) throw new Error("Organization ID is required to override approval tasks");
    if (!data.requestId?.trim()) throw new Error("Request ID is required to override approval tasks");
    if (!data.reason?.trim()) throw new Error("Break-glass reason is required");

    const result = await prisma.approvalTask.updateMany({
      where: { orgId: data.orgId, requestId: data.requestId.trim(), status: "open" },
      data: { status: "overridden" },
    });
    return { count: result.count };
  }
}
