/**
 * Exposure calculations test suite.
 * Run: npx tsx scripts/assert-exposure.ts
 *
 * Covers the REAL Phase 9 path: computeAggregateExposure (the pure core that the
 * DB-bound calculateAggregateExposure delegates to, after loading these same four
 * inputs from Postgres) AND the evaluator integration — a rule whose condition
 * references aggregate_exposure, run through the real simulateRule.
 *
 * The DB wrapper itself is a thin query + map over this core, covered by live
 * smoke testing — the same split assert-merge.ts uses (pure rewrite tested here,
 * transaction tested live).
 */
import { computeAggregateExposure, isOutstandingExposure } from "../lib/services/exposure";
import { CustomerNodeLike, CustomerEdgeLike } from "../lib/services/customerGraphPure";
import { simulateRule } from "../lib/ruleEvaluator";
import { WorkflowRule, defaultControls, parseDelay, formatDelay } from "../lib/vocabulary";
import { getRequest } from "../lib/platformData";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const mockNodes: CustomerNodeLike[] = [
  { id: "c1", orgId: "org-1", name: "Borrower A", status: "active", mergedIntoId: null },
  { id: "c2", orgId: "org-1", name: "Guarantor B", status: "active", mergedIntoId: null },
  { id: "c3", orgId: "org-1", name: "Related C", status: "active", mergedIntoId: null },
  { id: "c4-merged", orgId: "org-1", name: "Borrower A Alias", status: "merged", mergedIntoId: "c1" },
  { id: "c5-unrelated", orgId: "org-1", name: "Unrelated D", status: "active", mergedIntoId: null },
];

const mockEdges: CustomerEdgeLike[] = [
  { fromId: "c1", toId: "c2", relationType: "Guarantor" },
  { fromId: "c2", toId: "c3", relationType: "Affiliate" },
];

const mockRequests = [
  { id: "req-1", loanAmount: 100000, stage: "Approved" },
  { id: "req-2", loanAmount: 200000, stage: "In Review" },
  { id: "req-3", loanAmount: 50000, stage: "Closed" }, // should be ignored (closed)
  { id: "req-unrelated", loanAmount: 150000, stage: "Approved" },
];

const mockRoles = [
  { requestId: "req-1", customerId: "c1" }, // c1 on req-1
  { requestId: "req-1", customerId: "c2" }, // c2 also on req-1 (co-borrower / guarantor) -> tests deduplication
  { requestId: "req-2", customerId: "c4-merged" }, // c4-merged resolves to c1, c1 is in the graph -> req-2 should be counted
  { requestId: "req-3", customerId: "c3" }, // req-3 is on c3, but req-3 is Closed -> should not be counted
  { requestId: "req-unrelated", customerId: "c5-unrelated" }, // unrelated -> should not be counted
];

// Exposure calculation tests
const exp = computeAggregateExposure(mockNodes, mockEdges, mockRoles, mockRequests, "c1");
t("Total aggregate exposure is correct", exp === 300000, `Expected 300000, got ${exp}`);

// Assert individual helper behaviors
t("isOutstandingExposure returns true for active stages", isOutstandingExposure({ id: "1", loanAmount: 10, stage: "Approved" }) === true);
t("isOutstandingExposure returns false for Closed stage", isOutstandingExposure({ id: "2", loanAmount: 10, stage: "Closed" }) === false);

/* -------------------------------------------------------------------------- */
/* Why the 300000 is right — each exclusion pinned separately, so a regression  */
/* names its own cause instead of just moving the total.                       */
/* -------------------------------------------------------------------------- */

// req-1 ties c1 AND c2. Summing per role would bill that loan twice (400000).
t("a loan shared by two connected parties counts once, not per party", exp !== 400000, `deduplication failed: got ${exp}`);
// req-2 is held by c4-merged, an alias of c1 — dropping it would lose 200000.
t("a role on a merged-away alias still counts toward the survivor", exp >= 200000);
// req-3 (Closed) and req-unrelated (outside the graph) must not appear.
t("a Closed request contributes nothing", exp !== 350000);
t("an unconnected customer's loan never leaks in", exp < 450000);

// Traversal is undirected and transitive: c3 sits two hops out (c1→c2→c3).
const twoHop = computeAggregateExposure(
  mockNodes, mockEdges,
  [...mockRoles, { requestId: "req-4", customerId: "c3" }],
  [...mockRequests, { id: "req-4", loanAmount: 25000, stage: "Approved" }],
  "c1"
);
t("exposure reaches a customer two hops away", twoHop === 325000, `Expected 325000, got ${twoHop}`);

// Every member of a connected group sees the same group total.
t("c3 sees the same group exposure as c1 (graph is symmetric)",
  computeAggregateExposure(mockNodes, mockEdges, mockRoles, mockRequests, "c3") === 300000);
t("the unconnected customer sees only its own loan",
  computeAggregateExposure(mockNodes, mockEdges, mockRoles, mockRequests, "c5-unrelated") === 150000);

// Degenerate inputs must return 0, not throw.
t("an unknown customer has no exposure", computeAggregateExposure(mockNodes, mockEdges, mockRoles, mockRequests, "nope") === 0);
t("a role pointing at a vanished request is skipped",
  computeAggregateExposure(mockNodes, mockEdges, [{ requestId: "gone", customerId: "c1" }], mockRequests, "c1") === 0);

/* -------------------------------------------------------------------------- */
/* Rule evaluation referencing aggregate_exposure (through the real evaluator) */
/* -------------------------------------------------------------------------- */

function exposureRule(operator: string, value: string): WorkflowRule {
  return {
    schemaVersion: 3,
    triggers: [{ event: "REQUEST CREATED" }], // always-true trigger; isolates the condition
    conditions: { logic: "AND", children: [{ field: "aggregate_exposure", operator, value }] },
    actions: [],
    controls: defaultControls(),
  };
}

const req = getRequest("REQ-4821")!;
const ctx = { aggregateExposure: exp };

t("aggregate_exposure >= 500000 does not match a 300000 group",
  simulateRule(exposureRule("gte", "500000"), req, ctx).matched === false);
t("aggregate_exposure >= 250000 matches a 300000 group",
  simulateRule(exposureRule("gte", "250000"), req, ctx).matched === true);
t("aggregate_exposure gte is inclusive at the exact boundary",
  simulateRule(exposureRule("gte", "300000"), req, ctx).matched === true);
t("aggregate_exposure gt is exclusive at the exact boundary",
  simulateRule(exposureRule("gt", "300000"), req, ctx).matched === false);

// The traced value is what the audit log renders for the decision.
const trace = simulateRule(exposureRule("gte", "250000"), req, ctx).trace.conditions[0];
t("the trace reports the resolved exposure as the actual value", trace.actual === "300000");
t("the trace labels the field for the audit log", trace.label === "aggregate exposure");

// Fail-closed: exposure the caller never resolved must read as unknown, never as
// $0 — a silent 0 would sail under every exposure ceiling a covenant rule sets.
const noCtx = simulateRule(exposureRule("gte", "250000"), req);
t("unresolved exposure fails closed rather than matching", noCtx.matched === false);
t("unresolved exposure traces as unknown (null), not as $0", noCtx.trace.conditions[0].actual === null);
t("unresolved exposure does not pass a 'less than' check either",
  simulateRule(exposureRule("lt", "1"), req).matched === false);

const alertRule = exposureRule("gte", "250000");
alertRule.controls.missingData = "alert";
t("missingData:alert surfaces unresolved exposure instead of failing silently",
  simulateRule(alertRule, req).alerts.length === 1);

/* -------------------------------------------------------------------------- */
/* SLA delay parsing — a misparse silently means "run immediately"             */
/* -------------------------------------------------------------------------- */

t('parseDelay("2 hours") is 120', parseDelay("2 hours") === 120);
t('parseDelay("3 days") is 4320', parseDelay("3 days") === 4320);
t('parseDelay("90") treats a bare number as minutes', parseDelay("90") === 90);
t('parseDelay("45 mins") accepts an alias', parseDelay("45 mins") === 45);
t('parseDelay("soon") rejects unparseable text', parseDelay("soon") === null);
t('parseDelay("2 fortnights") rejects an unknown unit', parseDelay("2 fortnights") === null);
t('parseDelay("5000 weeks") rejects beyond the 90-day cap', parseDelay("5000 weeks") === null);
t('formatDelay round-trips "3 days"', formatDelay(parseDelay("3 days")!) === "3 days");
t("formatDelay(0) reads as immediately", formatDelay(0) === "immediately");
t("formatDelay renders a negative offset as before-anchor", formatDelay(-7200) === "5 days before");

if (failures) {
  console.error(`\n${failures} exposure assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll exposure assertions passed.");
