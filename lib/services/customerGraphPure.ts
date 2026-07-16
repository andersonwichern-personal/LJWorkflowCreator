export type CustomerStatus = "active" | "merged" | "archived";

export interface CustomerNodeLike {
  id: string;
  orgId: string;
  name: string;
  status: CustomerStatus | string;
  mergedIntoId: string | null;
}

export interface CustomerEdgeLike {
  fromId: string;
  toId: string;
  relationType: string;
}

export interface CustomerGraphShape<TNode extends CustomerNodeLike> {
  canonical: TNode | null;
  connected: TNode[];
  edges: CustomerEdgeLike[];
  brokenRefs: string[];
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

export function buildCustomerGraph<TNode extends CustomerNodeLike>(
  nodes: TNode[],
  edges: CustomerEdgeLike[],
  customerId: string
): CustomerGraphShape<TNode> {
  const canonical = canonicalizeCustomerNode(nodes, customerId) as TNode | null;
  if (!canonical) {
    return { canonical: null, connected: [], edges, brokenRefs: [`Customer ${customerId} not found`] };
  }

  // Partition before walking: a dangling edge is one broken reference, but the
  // walk below re-scans every edge on each pass, so detecting inline would
  // report it once per pass.
  const known = new Set(nodes.map((n) => n.id));
  const brokenRefs: string[] = [];
  const walkable: CustomerEdgeLike[] = [];
  for (const edge of edges) {
    if (!known.has(edge.fromId) || !known.has(edge.toId)) {
      brokenRefs.push(`Broken customer edge ${edge.fromId} -> ${edge.toId}`);
      continue;
    }
    walkable.push(edge);
  }

  const connectedIds = new Set<string>([canonical.id]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const edge of walkable) {
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
    .map((id) => canonicalizeCustomerNode(nodes, id) as TNode | null)
    .filter((n): n is TNode => Boolean(n))
    .filter((node, index, arr) => arr.findIndex((candidate) => candidate.id === node.id) === index);

  return { canonical, connected, edges, brokenRefs };
}
