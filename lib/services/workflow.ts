import { prisma } from "@/lib/prisma";
import { Workflow, Prisma } from "@prisma/client";

/**
 * TypeScript interface representing the rule JSON structure contract
 * as defined in the Workflow Creator Foundation Brief.
 * A rule is structured as: event → conditions → outputs.
 */
export interface RuleCondition {
  field: string;
  operator: string;
  value: any;
}

export interface RuleOutput {
  action: string;
  params: Record<string, any>;
}

export interface WorkflowRule {
  event: string;
  conds: RuleCondition[];
  outputs: RuleOutput[];
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
    ruleJson: WorkflowRule | Prisma.InputJsonValue;
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

    // Validate the minimum structure of the rule JSON.
    // Supports both the versioned live schema (v2) and the legacy mockup shape.
    const rule = data.ruleJson as any;
    const isNewSchema = rule.schemaVersion !== undefined;
    if (isNewSchema) {
      if (!rule.trigger?.event || !rule.conditions?.rules || !Array.isArray(rule.actions)) {
        throw new Error(
          "Invalid rule JSON structure (v2). Must contain 'schemaVersion', " +
          "'trigger.event', 'conditions.rules', and 'actions'."
        );
      }
    } else if (!rule.event || !Array.isArray(rule.conds) || !Array.isArray(rule.outputs)) {
      throw new Error(
        "Invalid rule JSON structure. Must contain 'event' (string), " +
        "'conds' (array), and 'outputs' (array)."
      );
    }

    return prisma.workflow.create({
      data: {
        orgId: data.orgId,
        name: data.name.trim(),
        description: data.description || null,
        ruleJson: rule as Prisma.InputJsonValue,
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
      ruleJson: WorkflowRule | Prisma.InputJsonValue;
    }>
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
      const rule = updates.ruleJson as any;
      if (rule) {
        const isNewSchema = rule.schemaVersion !== undefined;
        if (isNewSchema) {
          if (!rule.trigger?.event || !rule.conditions?.rules || !Array.isArray(rule.actions)) {
            throw new Error(
              "Invalid rule JSON structure (v2). Must contain 'schemaVersion', " +
              "'trigger.event', 'conditions.rules', and 'actions'."
            );
          }
        } else if (!rule.event || !Array.isArray(rule.conds) || !Array.isArray(rule.outputs)) {
          throw new Error(
            "Invalid rule JSON structure. Must contain 'event' (string), " +
            "'conds' (array), and 'outputs' (array)."
          );
        }
      }
      data.ruleJson = rule as Prisma.InputJsonValue;
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
