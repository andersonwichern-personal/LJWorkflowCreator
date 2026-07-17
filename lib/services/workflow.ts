import { prisma } from "@/lib/prisma";
import { Workflow, Prisma } from "@prisma/client";
import { validateRule } from "@sweet/rule-core";
import { VersionConflictError } from "@/lib/optimisticWrite";
import { shouldProposeWorkflowWrite } from "@/lib/fourEyes";

/**
 * Phase 13 four-eyes: the caller tried to change a protected rule directly.
 * The change is not lost — it has been filed as `proposalId` for a peer admin
 * to approve — so this is a redirect, not a failure. The route turns it into a
 * 202 carrying the proposal id.
 */
export class ProposalRequiredError extends Error {
  constructor(readonly proposalId: string) {
    super("This rule is protected — your change was filed as a proposal for a peer admin to approve.");
    this.name = "ProposalRequiredError";
  }
}

/**
 * The versioned rule JSON contract lives in `@/lib/vocabulary` (the single
 * source of truth). The service validates + normalizes `ruleJson` through the
 * one validator (`validateRule`) — the same code the client runs pre-save — and
 * persists the normalized v3 rule. Legacy v1/v2 rows upgrade on write.
 */
function assertValidRule(raw: unknown): Prisma.InputJsonValue {
  const { rule, issues } = validateRule(raw);
  if (!rule) {
    const errs = issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ");
    throw new Error(`Invalid rule: ${errs || "unknown validation error"}`);
  }
  return rule as unknown as Prisma.InputJsonValue;
}

export class WorkflowService {
  /**
   * List all workflows for a specific organization/tenant.
   */
  static async listWorkflows(orgId: string): Promise<Workflow[]> {
    if (!orgId) {
      throw new Error("Organization ID is required to list workflows");
    }
    
    return prisma.workflow.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Fetch a single workflow by its unique ID and organization ID (tenant scoping).
   */
  static async getWorkflowById(id: string, orgId: string): Promise<Workflow | null> {
    if (!id) {
      throw new Error("Workflow ID is required to fetch details");
    }
    if (!orgId) {
      throw new Error("Organization ID is required to fetch details");
    }

    return prisma.workflow.findFirst({
      where: { id, orgId },
    });
  }

  /**
   * Create a new workflow for a tenant.
   */
  static async createWorkflow(data: {
    orgId: string;
    name: string;
    description?: string;
    ruleJson: Prisma.InputJsonValue;
    enabled?: boolean;
  }): Promise<Workflow> {
    if (!data.orgId) {
      throw new Error("Organization ID is required to create a workflow");
    }
    if (!data.name?.trim()) {
      throw new Error("Workflow name is required");
    }
    if (!data.ruleJson) {
      throw new Error("Workflow rule JSON is required");
    }

    // Validate + normalize through the single validator (throws on errors).
    const ruleJson = assertValidRule(data.ruleJson);

    return prisma.workflow.create({
      data: {
        orgId: data.orgId,
        name: data.name.trim(),
        description: data.description || null,
        ruleJson,
        enabled: data.enabled !== undefined ? data.enabled : true,
      },
    });
  }

  /**
   * Update an existing workflow with organization ID scoping (tenant isolation).
   */
  static async updateWorkflow(
    id: string,
    orgId: string,
    updates: Partial<{
      name: string;
      description: string | null;
      enabled: boolean;
      ruleJson: Prisma.InputJsonValue;
    }>,
    /** Phase 8 §12: caller's last-read version. Absent → legacy last-write-wins. */
    expectedVersion?: number,
    /** Phase 13: who is making the change. Absent → unattributed/system write. */
    proposerId?: string
  ): Promise<Workflow> {
    if (!id) {
      throw new Error("Workflow ID is required for updates");
    }
    if (!orgId) {
      throw new Error("Organization ID is required for updates");
    }

    // Verify ownership before updating
    const existing = await prisma.workflow.findFirst({
      where: { id, orgId },
    });
    if (!existing) {
      throw new Error("Workflow not found or access denied");
    }

    // Four-eyes: a change to a protected rule never lands directly — it becomes
    // a proposal for someone else to approve. Only an attributed caller can be
    // held to the gate; an unattributed write has no maker to check against, so
    // it is refused rather than waved through.
    if (
      shouldProposeWorkflowWrite({
        currentRule: existing.ruleJson,
        currentEnabled: existing.enabled,
        nextRule: updates.ruleJson,
        nextEnabled: updates.enabled,
      })
    ) {
      if (!proposerId?.trim()) {
        throw new Error("A proposer ID is required to change a live rule");
      }
      const { WorkflowProposalService } = await import("@/lib/services/workflowProposal");
      const proposal = await WorkflowProposalService.createProposal({
        orgId,
        workflowId: id,
        proposerId,
        proposedRule: updates.ruleJson ?? existing.ruleJson,
        proposedEnabled: updates.enabled ?? null,
      });
      throw new ProposalRequiredError(proposal.id);
    }

    const data: Prisma.WorkflowUpdateInput = {};

    if (updates.name !== undefined) {
      if (!updates.name.trim()) {
        throw new Error("Workflow name cannot be empty");
      }
      data.name = updates.name.trim();
    }

    if (updates.description !== undefined) {
      data.description = updates.description;
    }

    if (updates.enabled !== undefined) {
      data.enabled = updates.enabled;
    }

    if (updates.ruleJson !== undefined) {
      data.ruleJson = assertValidRule(updates.ruleJson);
    }

    if (typeof expectedVersion === "number") {
      // Optimistic-concurrency guard: the write lands only if nobody else has
      // bumped the version since the caller read it. Zero rows = conflict, and
      // the caller gets the current record to resolve with (never silent loss).
      const result = await prisma.workflow.updateMany({
        where: { id, orgId, version: expectedVersion },
        data: { ...data, version: { increment: 1 } } as Prisma.WorkflowUpdateManyMutationInput,
      });
      const current = await prisma.workflow.findFirst({ where: { id, orgId } });
      if (!current) {
        throw new Error("Workflow not found or access denied");
      }
      if (result.count === 0) {
        throw new VersionConflictError(current.version, current);
      }
      return current;
    }

    return prisma.workflow.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete a workflow by ID and organization ID (tenant scoping).
   */
  static async deleteWorkflow(id: string, orgId: string): Promise<Workflow> {
    if (!id) {
      throw new Error("Workflow ID is required for deletion");
    }
    if (!orgId) {
      throw new Error("Organization ID is required for deletion");
    }

    // Verify ownership before deleting
    const existing = await prisma.workflow.findFirst({
      where: { id, orgId },
    });
    if (!existing) {
      throw new Error("Workflow not found or access denied");
    }

    return prisma.workflow.delete({
      where: { id },
    });
  }

  /**
   * Toggle the enabled state of a workflow under tenant isolation.
   */
  static async toggleWorkflow(id: string, orgId: string, enabled: boolean): Promise<Workflow> {
    if (!id) {
      throw new Error("Workflow ID is required to toggle enabled state");
    }
    if (!orgId) {
      throw new Error("Organization ID is required to toggle enabled state");
    }

    // Verify ownership before toggling
    const existing = await prisma.workflow.findFirst({
      where: { id, orgId },
    });
    if (!existing) {
      throw new Error("Workflow not found or access denied");
    }

    return prisma.workflow.update({
      where: { id },
      data: { enabled },
    });
  }
}
