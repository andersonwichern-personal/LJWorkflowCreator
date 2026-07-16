/**
 * Phase 6 aggregate exposure lookup.
 *
 * The graph loader already has the data we need, so this module turns that into
 * a stable summary for the customer panel and request-scoped exposure views.
 * No mock counts, no fake connectivity: the output mirrors the current entity
 * graph for the requested customer.
 */

export interface ConnectedCustomerSummary {
  id: string;
  name: string;
  status: string;
}

export interface ExposureSummary {
  canonicalCustomerId: string | null;
  connectedPartyCount: number;
  relationshipCount: number;
  brokenReferenceCount: number;
  connectedCustomers: ConnectedCustomerSummary[];
}

export interface ExposureResult {
  graph: {
    canonical: {
      id: string;
      orgId: string;
      name: string;
      status: string;
      mergedIntoId: string | null;
    } | null;
    connected: ConnectedCustomerSummary[];
    edges: {
      fromId: string;
      toId: string;
      relationType: string;
    }[];
    brokenRefs: string[];
  };
  summary: ExposureSummary;
}

export function summarizeExposureGraph(graph: ExposureResult["graph"]): ExposureSummary {
  return {
    canonicalCustomerId: graph.canonical?.id ?? null,
    connectedPartyCount: Math.max(0, graph.connected.length - 1),
    relationshipCount: graph.edges.length,
    brokenReferenceCount: graph.brokenRefs.length,
    connectedCustomers: graph.connected,
  };
}

export async function aggregateExposure(orgId: string, customerId: string): Promise<ExposureResult> {
  const { loadCustomerGraph } = await import("./customerGraph");
  const graph = await loadCustomerGraph(orgId, customerId);
  const connectedCustomers = graph.connected.map((customer) => ({
    id: customer.id,
    name: customer.name,
    status: customer.status,
  }));

  return {
    graph: {
      canonical: graph.canonical,
      connected: connectedCustomers,
      edges: graph.edges,
      brokenRefs: graph.brokenRefs,
    },
    summary: summarizeExposureGraph({
      canonical: graph.canonical,
      connected: connectedCustomers,
      edges: graph.edges,
      brokenRefs: graph.brokenRefs,
    }),
  };
}
