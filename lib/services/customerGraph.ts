import { canonicalizeCustomerNode } from "./customerGraphPure";

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

  const canonical = canonicalizeCustomerNode(nodes, customerId) as CustomerNode | null;
  if (!canonical) {
    return { canonical: null, connected: [], edges, brokenRefs: [`Customer ${customerId} not found`] };
  }

  const connectedIds = new Set<string>([canonical.id]);
  const brokenRefs: string[] = [];
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const edge of edges) {
      const fromExists = nodes.some((n) => n.id === edge.fromId);
      const toExists = nodes.some((n) => n.id === edge.toId);
      if (!fromExists || !toExists) {
        brokenRefs.push(`Broken customer edge ${edge.fromId} -> ${edge.toId}`);
        continue;
      }
      if (connectedIds.has(edge.fromId) && !connectedIds.has(edge.toId)) {
        connectedIds.add(edge.toId);
        expanded = true;
      } else if (connectedIds.has(edge.toId) && !connectedIds.has(edge.fromId)) {
        connectedIds.add(edge.fromId);
        expanded = true;
      }
    }
  }

  const connected = [...connectedIds]
    .map((id) => canonicalizeCustomerNode(nodes, id) as CustomerNode | null)
    .filter((n): n is CustomerNode => Boolean(n))
    .filter((node, index, arr) => arr.findIndex((candidate) => candidate.id === node.id) === index);

  return { canonical, connected, edges, brokenRefs };
}
