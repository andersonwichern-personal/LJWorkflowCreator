import { prisma } from "@/lib/prisma";
import { mergeCustomers } from "./services/merge";

export interface EntityIntegrityIssue {
  code: "MERGED_REF" | "ARCHIVED_REF" | "BROKEN_RELATIONSHIP" | "UNRESOLVED_SCOPE_REF";
  severity: "warning" | "error";
  message: string;
  refId?: string;
}

export interface EntityIntegrityReport {
  issues: EntityIntegrityIssue[];
}

export async function auditEntityIntegrity(orgId: string): Promise<EntityIntegrityReport> {
  const issues: EntityIntegrityIssue[] = [];
  const [customers, relationships, roles] = await Promise.all([
    prisma.customer.findMany({ where: { orgId } }),
    prisma.customerRelationship.findMany({ where: { orgId } }),
    prisma.requestCustomerRole.findMany({ where: { orgId } }),
  ]);

  const byId = new Map(customers.map((c) => [c.id, c]));
  for (const customer of customers) {
    if (customer.status === "merged" && customer.mergedIntoId) {
      issues.push({
        code: "MERGED_REF",
        severity: "warning",
        refId: customer.id,
        message: `${customer.name} is merged into ${customer.mergedIntoId}`,
      });
    }
    if (customer.status === "archived") {
      issues.push({
        code: "ARCHIVED_REF",
        severity: "warning",
        refId: customer.id,
        message: `${customer.name} is archived`,
      });
    }
  }

  for (const rel of relationships) {
    if (!byId.has(rel.fromId) || !byId.has(rel.toId)) {
      issues.push({
        code: "BROKEN_RELATIONSHIP",
        severity: "error",
        refId: rel.id,
        message: `Broken relationship ${rel.fromId} -> ${rel.toId}`,
      });
    }
  }

  for (const role of roles) {
    if (!byId.has(role.customerId)) {
      issues.push({
        code: "UNRESOLVED_SCOPE_REF",
        severity: "error",
        refId: role.id,
        message: `Request role ${role.role} points at a missing customer`,
      });
    }
  }

  return { issues };
}

export { mergeCustomers };

