/**
 * Phase 6 aggregate exposure lookup + Phase 9 exposure amounts.
 *
 * The graph loader already has the data we need, so this module turns that into
 * a stable summary for the customer panel and request-scoped exposure views.
 * No mock counts, no fake connectivity: the output mirrors the current entity
 * graph for the requested customer.
 *
 * Phase 9 adds the money: `calculateAggregateExposure` walks that same graph and
 * sums what the connected group actually owes. This closes the T6 recompute that
 * lib/services/merge.ts deferred ("no cross-request query path yet") — the path
 * is RequestCustomerRole (real, org-scoped) joined to request amounts.
 *
 * DATA-SOURCE CAVEAT: the amounts come from the lib/platformData seed, not a
 * live ledger — this prototype has no Request/Loan table, and that seed is the
 * only request data the whole app has (lib/analytics.ts sums the same rows).
 * Exposure is therefore exactly as real as every other number in the demo, and
 * becomes live the day requests arrive from the backend. Nothing is fabricated
 * here: an unseeded customer sums to 0 rather than to an invented figure.
 */

import { ruleReferencesField, WorkflowRule } from "@/lib/vocabulary";
import { EvaluationContext } from "@/lib/ruleEvaluator";
import {
  buildCustomerGraph,
  canonicalizeCustomerNode,
  CustomerEdgeLike,
  CustomerNodeLike,
} from "./customerGraphPure";

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

/* -------------------------------------------------------------------------- */
/* Phase 9 — aggregate exposure amount                                        */
/* -------------------------------------------------------------------------- */

/** The exposure-bearing facts of a request, as PlatformRequest supplies them. */
export interface ExposureRequestLike {
  id: string;
  loanAmount: number;
  stage: string;
}

/** A customer's tie to a request (RequestCustomerRole, any role). */
export interface ExposureRoleLike {
  requestId: string;
  customerId: string;
}

/**
 * Outstanding == not yet Closed, matching lib/analytics.ts exactly. A rule that
 * fires on aggregate_exposure and a dashboard that reports portfolio value must
 * never disagree about which loans still count.
 */
export function isOutstandingExposure(request: ExposureRequestLike): boolean {
  return request.stage !== "Closed";
}

/**
 * Pure aggregate-exposure calculation: total outstanding amount across the
 * borrower and every entity connected to it.
 *
 * Two things this deliberately gets right, both of which inflate the number if
 * ignored — and an overstated exposure trips covenant rules that should not fire:
 *
 *  - Deduped by requestId. One loan routinely ties several connected parties
 *    (borrower + guarantor). Both sit in the graph, so summing per role would
 *    count that loan once per party.
 *  - Roles are canonicalized through the merge alias chain before membership is
 *    tested. `connected` holds canonical ids, but a role can still point at a
 *    merged-away duplicate (services/customer.ts `seedCustomers` matches by name
 *    and does not skip `merged` rows), which would otherwise drop real exposure.
 */
export function computeAggregateExposure(
  nodes: readonly CustomerNodeLike[],
  edges: readonly CustomerEdgeLike[],
  roles: readonly ExposureRoleLike[],
  requests: readonly ExposureRequestLike[],
  customerId: string
): number {
  const graph = buildCustomerGraph([...nodes], [...edges], customerId);
  if (!graph.canonical) return 0;

  const inGraph = new Set(graph.connected.map((node) => node.id));
  const requestIds = new Set<string>();
  for (const role of roles) {
    const canonical = canonicalizeCustomerNode([...nodes], role.customerId);
    if (canonical && inGraph.has(canonical.id)) requestIds.add(role.requestId);
  }

  const byId = new Map(requests.map((request) => [request.id, request]));
  let total = 0;
  for (const requestId of requestIds) {
    const request = byId.get(requestId);
    if (!request || !isOutstandingExposure(request)) continue;
    total += request.loanAmount;
  }
  return total;
}

/**
 * Total outstanding exposure for a customer's whole connected group.
 *
 * The signature carries no orgId, but every table involved is org-scoped, so the
 * org is read off the customer's own row rather than querying across tenants.
 * That keeps one tenant's graph from ever summing another's loans. Callers still
 * owe the usual authorization check on `customerId` before trusting the result —
 * this resolves an id, it does not decide who may ask about it.
 *
 * An unknown customer returns 0.
 */
export async function calculateAggregateExposure(customerId: string): Promise<number> {
  const { prisma } = await import("@/lib/prisma");
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return 0;

  const orgId = customer.orgId;
  const [customers, relationships, roles] = await Promise.all([
    prisma.customer.findMany({ where: { orgId } }),
    prisma.customerRelationship.findMany({ where: { orgId } }),
    prisma.requestCustomerRole.findMany({ where: { orgId } }),
  ]);

  const { REQUESTS } = await import("@/lib/platformData");
  return computeAggregateExposure(
    customers.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      status: row.status,
      mergedIntoId: row.mergedIntoId,
    })),
    relationships.map((row) => ({
      fromId: row.fromId,
      toId: row.toId,
      relationType: row.relationType,
    })),
    roles.map((row) => ({ requestId: row.requestId, customerId: row.customerId })),
    REQUESTS,
    customerId
  );
}

/**
 * Aggregate exposure for the group behind a request — the borrower's connected
 * entities. Prefers the Borrower role, falling back to any role holder.
 *
 * Returns undefined (not 0) when the request has no customer on file, so the
 * evaluator can report `aggregate_exposure` as unknown and fail closed. "We
 * couldn't look it up" and "this group owes nothing" must not collapse into the
 * same answer — one of them silently passes an exposure ceiling.
 */
export async function calculateAggregateExposureForRequest(
  orgId: string,
  requestId: string
): Promise<number | undefined> {
  // Go through CustomerService, not the table: no migration populates customers
  // or roles — they are seeded lazily on read — so a direct query finds nothing
  // on a cold database and every exposure would read as unknown.
  const { CustomerService } = await import("./customer");
  const roles = await CustomerService.listRolesForRequest(orgId, requestId);
  if (!roles.length) return undefined;
  const primary = roles.find((role) => role.role === "Borrower") ?? roles[0];
  return calculateAggregateExposure(primary.customerId);
}

/**
 * Resolve the caller-supplied half of an evaluation (lib/ruleEvaluator.ts's
 * EvaluationContext) for one rule against one request. Server-only — it reads
 * the database, which is exactly why the evaluator itself can't do this.
 *
 * Only resolves what the rule actually asks for: walking the customer graph for
 * a rule with no `aggregate_exposure` condition would be pure overhead on every
 * fire.
 */
export async function evaluationContextFor(
  rule: WorkflowRule,
  orgId: string,
  requestId: string
): Promise<EvaluationContext> {
  const context: EvaluationContext = {};
  if (ruleReferencesField(rule, "aggregate_exposure")) {
    context.aggregateExposure = await calculateAggregateExposureForRequest(orgId, requestId);
  }
  return context;
}
