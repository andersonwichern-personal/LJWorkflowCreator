import { loadCustomerGraph, type CustomerGraphResult } from "./customerGraph";
import { sortCustomersByName } from "./customer";

export interface ExposureSummary {
  canonicalCustomerId: string | null;
  connectedPartyCount: number;
  relationshipCount: number;
  brokenReferenceCount: number;
  connectedCustomers: Array<{
    id: string;
    name: string;
    status: "active" | "merged" | "archived" | string;
  }>;
}

export interface ExposureResult {
  graph: CustomerGraphResult;
  summary: ExposureSummary;
}

export async function aggregateExposure(orgId: string, customerId: string): Promise<ExposureResult> {
  const graph = await loadCustomerGraph(orgId, customerId);
  return {
    graph,
    summary: {
      canonicalCustomerId: graph.canonical?.id ?? null,
      connectedPartyCount: graph.connected.length,
      relationshipCount: graph.edges.length,
      brokenReferenceCount: graph.brokenRefs.length,
      connectedCustomers: sortCustomersByName(
        graph.connected.map((party) => ({
          id: party.id,
          name: party.name,
          status: party.status as "active" | "merged" | "archived",
        }))
      ),
    },
  };
}
