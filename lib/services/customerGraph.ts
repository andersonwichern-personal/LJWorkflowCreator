import { buildCustomerGraph } from "./customerGraphPure";

export type CustomerStatus = "active" | "merged" | "archived";

export interface CustomerNode {
  id: string;
  orgId: string;
  name: string;
  status: CustomerStatus | string;
  mergedIntoId: string | null;
}

export interface CustomerEdge {
  fromId: string;
  toId: string;
  relationType: string;
}

export interface CustomerGraphResult {
  canonical: CustomerNode | null;
  connected: CustomerNode[];
  edges: CustomerEdge[];
  brokenRefs: string[];
}

export async function loadCustomerGraph(orgId: string, customerId: string): Promise<CustomerGraphResult> {
  const { prisma } = await import("@/lib/prisma");
  const [customers, relationships] = await Promise.all([
    prisma.customer.findMany({ where: { orgId } }),
    prisma.customerRelationship.findMany({ where: { orgId } }),
  ]);

  const nodes: CustomerNode[] = customers.map((c) => ({
    id: c.id,
    orgId: c.orgId,
    name: c.name,
    status: c.status,
    mergedIntoId: c.mergedIntoId,
  }));
  const edges: CustomerEdge[] = relationships.map((r) => ({
    fromId: r.fromId,
    toId: r.toId,
    relationType: r.relationType,
  }));

  return buildCustomerGraph(nodes, edges, customerId);
}
