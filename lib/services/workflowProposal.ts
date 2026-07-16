import { prisma } from "@/lib/prisma";
import { Prisma, WorkflowProposal } from "@prisma/client";
import { validateRule } from "@/lib/ruleValidation";
import { ApprovalTaskService } from "@/lib/services/approvalTask";
import { ApprovalRequirement } from "@/lib/authorityEngine";

export type WorkflowProposalStatus = "pending" | "approved" | "rejected";

export type WorkflowProposalWithWorkflow = WorkflowProposal & {
  workflow: { id: string; name: string; ruleJson: Prisma.JsonValue; enabled: boolean } | null;
};

const DEMO_ADMIN_APPROVERS = [
  { id: "u-anderson", label: "Anderson" },
  { id: "u-aisha-admin", label: "Aisha Admin" },
];

function assertValidRule(raw: unknown): Prisma.InputJsonValue {
  const { rule, issues } = validateRule(raw);
  if (!rule) {
    const errs = issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ");
    throw new Error(`Invalid rule: ${errs || "unknown validation error"}`);
  }
  return rule as unknown as Prisma.InputJsonValue;
}

export function proposalRequirement(proposerId: string): ApprovalRequirement {
  const approvers = DEMO_ADMIN_APPROVERS.filter((admin) => admin.id !== proposerId);
  return { type: "any_of", approvers: approvers.length ? approvers : DEMO_ADMIN_APPROVERS };
}

export class WorkflowProposalService {
  static async listPending(orgId: string): Promise<WorkflowProposalWithWorkflow[]> {
    if (!orgId) throw new Error("Organization ID is required to list proposals");
    return prisma.workflowProposal.findMany({
      where: { orgId, status: "pending" },
      orderBy: { createdAt: "desc" },
      include: { workflow: { select: { id: true, name: true, ruleJson: true, enabled: true } } },
    });
  }

  static async createProposal(data: {
    orgId: string;
    workflowId: string;
    proposerId: string;
    proposedRule: unknown;
    proposedEnabled?: boolean | null;
  }): Promise<WorkflowProposal> {
    if (!data.orgId) throw new Error("Organization ID is required to create a proposal");
    if (!data.workflowId) throw new Error("Workflow ID is required to create a proposal");
    if (!data.proposerId?.trim()) throw new Error("Proposer ID is required");

    const workflow = await prisma.workflow.findFirst({
      where: { id: data.workflowId, orgId: data.orgId },
      select: { id: true },
    });
    if (!workflow) throw new Error("Workflow not found or access denied");

    const proposedRule = assertValidRule(data.proposedRule);
    const proposal = await prisma.workflowProposal.create({
      data: {
        orgId: data.orgId,
        workflowId: data.workflowId,
        proposedRule,
        proposedEnabled: data.proposedEnabled ?? null,
        proposerId: data.proposerId.trim(),
        status: "pending",
      },
    });

    const authority = await prisma.approvalAuthority.findFirst({
      where: { orgId: data.orgId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!authority) return proposal;

    const task = await ApprovalTaskService.createTask({
      orgId: data.orgId,
      authorityId: authority.id,
      requestId: `workflow:${data.workflowId}:proposal:${proposal.id}`,
      requirement: proposalRequirement(data.proposerId.trim()),
      exclusions: [data.proposerId.trim()],
      delegations: [],
    });

    return prisma.workflowProposal.update({
      where: { id: proposal.id },
      data: { taskId: task.id },
    });
  }

  static async applyProposal(
    proposalId: string,
    orgId: string,
    approverId: string
  ): Promise<WorkflowProposal> {
    if (!proposalId) throw new Error("Proposal ID is required");
    if (!orgId) throw new Error("Organization ID is required to apply a proposal");
    if (!approverId?.trim()) throw new Error("Approver ID is required");

    const proposal = await prisma.workflowProposal.findFirst({
      where: { id: proposalId, orgId },
    });
    if (!proposal) throw new Error("Proposal not found or access denied");
    if (proposal.status !== "pending") throw new Error(`Proposal is already ${proposal.status}`);
    if (proposal.proposerId === approverId.trim()) {
      throw new Error("Proposer cannot approve their own workflow proposal");
    }

    await prisma.workflow.update({
      where: { id: proposal.workflowId },
      data: {
        ruleJson: proposal.proposedRule as Prisma.InputJsonValue,
        ...(proposal.proposedEnabled !== null ? { enabled: proposal.proposedEnabled } : {}),
        version: { increment: 1 },
      },
    });

    return prisma.workflowProposal.update({
      where: { id: proposal.id },
      data: { status: "approved" },
    });
  }

  static async rejectProposal(
    proposalId: string,
    orgId: string,
    approverId: string
  ): Promise<WorkflowProposal> {
    if (!proposalId) throw new Error("Proposal ID is required");
    if (!orgId) throw new Error("Organization ID is required to reject a proposal");
    if (!approverId?.trim()) throw new Error("Approver ID is required");
    const proposal = await prisma.workflowProposal.findFirst({ where: { id: proposalId, orgId } });
    if (!proposal) throw new Error("Proposal not found or access denied");
    if (proposal.status !== "pending") throw new Error(`Proposal is already ${proposal.status}`);
    if (proposal.proposerId === approverId.trim()) {
      throw new Error("Proposer cannot reject their own workflow proposal");
    }
    return prisma.workflowProposal.update({
      where: { id: proposal.id },
      data: { status: "rejected" },
    });
  }

  static async applyApprovedTask(taskId: string): Promise<WorkflowProposal | null> {
    const proposal = await prisma.workflowProposal.findFirst({
      where: { taskId, status: "pending" },
    });
    if (!proposal) return null;
    await prisma.workflow.update({
      where: { id: proposal.workflowId },
      data: {
        ruleJson: proposal.proposedRule as Prisma.InputJsonValue,
        ...(proposal.proposedEnabled !== null ? { enabled: proposal.proposedEnabled } : {}),
        version: { increment: 1 },
      },
    });
    return prisma.workflowProposal.update({
      where: { id: proposal.id },
      data: { status: "approved" },
    });
  }
}
