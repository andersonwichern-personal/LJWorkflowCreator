import { prisma } from "@/lib/prisma";
import { ApprovalAuthority, Prisma } from "@prisma/client";
import { VersionConflictError } from "@/lib/optimisticWrite";
import {
  ApprovalRequirement,
  MAX_SEQUENCE_STEPS,
  normalizeRequirement,
  requirementApprovers,
} from "@/lib/authorityEngine";

/** Allowed values for the authority matrix dimensions (Option C: Amount + Risk Grade + Product). */
export const RISK_GRADES = ["A", "B", "C", "D", "E"] as const;
export const AUTHORITY_PRODUCTS = ["All", "Term Loan", "Line of Credit"] as const;

/**
 * Validate and normalize a configured approval topology. Null clears the
 * requirement (level falls back to legacy any-of userIds).
 */
function normalizeRequirementInput(raw: unknown): ApprovalRequirement | null {
  if (raw == null) return null;
  const rawSteps = (raw as { type?: unknown; steps?: unknown }).type === "sequence"
    ? (raw as { steps?: unknown }).steps
    : null;
  if (Array.isArray(rawSteps) && rawSteps.length > MAX_SEQUENCE_STEPS) {
    throw new Error(`Sequences must have at most ${MAX_SEQUENCE_STEPS} steps`);
  }
  const requirement = normalizeRequirement(raw);
  const seats = requirementApprovers(requirement);
  if (seats.length === 0) {
    throw new Error("Requirement must name at least one approver");
  }
  if (requirement.type === "n_of" && requirement.count > requirement.approvers.length) {
    throw new Error("Quorum count cannot exceed the number of approvers");
  }
  if (requirement.type === "sequence") {
    for (const step of requirement.steps) {
      if (requirementApprovers(step).length === 0) {
        throw new Error("Every sequence step must name at least one approver");
      }
      if (step.type === "n_of" && step.count > step.approvers.length) {
        throw new Error("Quorum count cannot exceed the number of approvers in a step");
      }
    }
  }
  return requirement;
}

/** List rows carry the escalation target's name for display. */
export type AuthorityWithEscalation = ApprovalAuthority & {
  escalation: { id: string; name: string } | null;
};

const ESCALATION_SELECT = { escalation: { select: { id: true, name: true } } } as const;

function validateMatrix(data: { riskGrade?: string; product?: string; limit?: number }) {
  if (data.riskGrade !== undefined && !RISK_GRADES.includes(data.riskGrade as never)) {
    throw new Error(`Risk grade must be one of: ${RISK_GRADES.join(", ")}`);
  }
  if (data.product !== undefined && !AUTHORITY_PRODUCTS.includes(data.product as never)) {
    throw new Error(`Product must be one of: ${AUTHORITY_PRODUCTS.join(", ")}`);
  }
  if (data.limit !== undefined && (!Number.isFinite(data.limit) || data.limit < 0)) {
    throw new Error("Limit must be a non-negative number");
  }
}

export class ApprovalAuthorityService {
  /** List all authority levels for a tenant, smallest limit first (matrix reads bottom-up). */
  static async listAuthorities(orgId: string): Promise<AuthorityWithEscalation[]> {
    if (!orgId) {
      throw new Error("Organization ID is required to list authorities");
    }

    return prisma.approvalAuthority.findMany({
      where: { orgId },
      orderBy: { limit: "asc" },
      include: ESCALATION_SELECT,
    });
  }

  /** Create a new authority level for a tenant. */
  static async createAuthority(data: {
    orgId: string;
    name: string;
    limit: number;
    riskGrade: string;
    product: string;
    userIds?: string[];
    requirement?: unknown;
    escalationId?: string | null;
    autoApprove?: boolean;
  }): Promise<AuthorityWithEscalation> {
    if (!data.orgId) {
      throw new Error("Organization ID is required to create an authority");
    }
    if (!data.name?.trim()) {
      throw new Error("Authority name is required");
    }
    validateMatrix(data);
    const requirement = normalizeRequirementInput(data.requirement);

    if (data.escalationId) {
      await this.assertEscalationTarget(data.escalationId, data.orgId);
    }

    return prisma.approvalAuthority.create({
      data: {
        orgId: data.orgId,
        name: data.name.trim(),
        limit: data.limit,
        riskGrade: data.riskGrade,
        product: data.product,
        userIds: (data.userIds ?? []) as Prisma.InputJsonValue,
        requirement: requirement === null
          ? Prisma.DbNull
          : (requirement as unknown as Prisma.InputJsonValue),
        escalationId: data.escalationId || null,
        autoApprove: data.autoApprove ?? false,
      },
      include: ESCALATION_SELECT,
    });
  }

  /** Update an authority level with tenant scoping. */
  static async updateAuthority(
    id: string,
    orgId: string,
    updates: Partial<{
      name: string;
      limit: number;
      riskGrade: string;
      product: string;
      userIds: string[];
      requirement: unknown;
      escalationId: string | null;
      autoApprove: boolean;
    }>,
    /** Phase 8 §12: caller's last-read version. Absent → legacy last-write-wins. */
    expectedVersion?: number
  ): Promise<AuthorityWithEscalation> {
    if (!id) {
      throw new Error("Authority ID is required for updates");
    }
    if (!orgId) {
      throw new Error("Organization ID is required for updates");
    }

    const existing = await prisma.approvalAuthority.findFirst({ where: { id, orgId } });
    if (!existing) {
      throw new Error("Authority not found or access denied");
    }

    validateMatrix(updates);
    if (updates.name !== undefined && !updates.name.trim()) {
      throw new Error("Authority name cannot be empty");
    }
    if (updates.escalationId) {
      if (updates.escalationId === id) {
        throw new Error("An authority cannot escalate to itself");
      }
      await this.assertEscalationTarget(updates.escalationId, orgId);
    }

    const data: Prisma.ApprovalAuthorityUpdateInput = {};
    if (updates.name !== undefined) data.name = updates.name.trim();
    if (updates.limit !== undefined) data.limit = updates.limit;
    if (updates.riskGrade !== undefined) data.riskGrade = updates.riskGrade;
    if (updates.product !== undefined) data.product = updates.product;
    if (updates.userIds !== undefined) data.userIds = updates.userIds as Prisma.InputJsonValue;
    if (updates.requirement !== undefined) {
      const requirement = normalizeRequirementInput(updates.requirement);
      data.requirement = requirement === null
        ? Prisma.DbNull
        : (requirement as unknown as Prisma.InputJsonValue);
    }
    if (updates.autoApprove !== undefined) data.autoApprove = updates.autoApprove;
    if (updates.escalationId !== undefined) {
      data.escalation = updates.escalationId
        ? { connect: { id: updates.escalationId } }
        : { disconnect: true };
    }

    if (typeof expectedVersion === "number") {
      // Optimistic-concurrency guard (§12). updateMany cannot express relation
      // connect/disconnect, so the guarded write sets the scalar FK directly.
      const guarded: Prisma.ApprovalAuthorityUpdateManyMutationInput & { escalationId?: string | null } = {
        version: { increment: 1 },
      };
      if (updates.name !== undefined) guarded.name = updates.name.trim();
      if (updates.limit !== undefined) guarded.limit = updates.limit;
      if (updates.riskGrade !== undefined) guarded.riskGrade = updates.riskGrade;
      if (updates.product !== undefined) guarded.product = updates.product;
      if (updates.userIds !== undefined) guarded.userIds = updates.userIds as Prisma.InputJsonValue;
      if (updates.requirement !== undefined) {
        const requirement = normalizeRequirementInput(updates.requirement);
        guarded.requirement =
          requirement === null ? Prisma.DbNull : (requirement as unknown as Prisma.InputJsonValue);
      }
      if (updates.autoApprove !== undefined) guarded.autoApprove = updates.autoApprove;
      if (updates.escalationId !== undefined) guarded.escalationId = updates.escalationId;

      const result = await prisma.approvalAuthority.updateMany({
        where: { id, orgId, version: expectedVersion },
        data: guarded,
      });
      const current = await prisma.approvalAuthority.findFirst({
        where: { id, orgId },
        include: ESCALATION_SELECT,
      });
      if (!current) {
        throw new Error("Authority not found or access denied");
      }
      if (result.count === 0) {
        throw new VersionConflictError(current.version, current);
      }
      return current;
    }

    return prisma.approvalAuthority.update({
      where: { id },
      data,
      include: ESCALATION_SELECT,
    });
  }

  /** Delete an authority level (levels escalating to it fall back to null via ON DELETE SET NULL). */
  static async deleteAuthority(id: string, orgId: string): Promise<ApprovalAuthority> {
    if (!id) {
      throw new Error("Authority ID is required for deletion");
    }
    if (!orgId) {
      throw new Error("Organization ID is required for deletion");
    }

    const existing = await prisma.approvalAuthority.findFirst({ where: { id, orgId } });
    if (!existing) {
      throw new Error("Authority not found or access denied");
    }

    return prisma.approvalAuthority.delete({ where: { id } });
  }

  /** Escalation targets must exist within the same tenant. */
  private static async assertEscalationTarget(escalationId: string, orgId: string): Promise<void> {
    const target = await prisma.approvalAuthority.findFirst({
      where: { id: escalationId, orgId },
    });
    if (!target) {
      throw new Error("Escalation target not found in this organization");
    }
  }
}
