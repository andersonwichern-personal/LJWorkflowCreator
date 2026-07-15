export type CustomerStatus = "active" | "merged" | "archived";

export interface CustomerNodeLike {
  id: string;
  orgId: string;
  name: string;
  status: CustomerStatus | string;
  mergedIntoId: string | null;
}

export function canonicalizeCustomerNode(
  nodes: CustomerNodeLike[],
  customerId: string
): CustomerNodeLike | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let current = byId.get(customerId) ?? null;
  const seen = new Set<string>();
  while (current?.mergedIntoId && !seen.has(current.id)) {
    seen.add(current.id);
    const next = byId.get(current.mergedIntoId);
    if (!next) break;
    current = next;
  }
  return current;
}
