export {};

// Exercises REAL pure entity-integrity logic: the customer alias-walk
// (canonicalize) and role-holder exclusion derivation. No mock literals stand in
// for the functions under test.

import {
  buildCustomerGraph,
  canonicalizeCustomerNode,
  type CustomerNodeLike,
} from "../lib/services/customerGraphPure";
import { summarizeExposureGraph } from "../lib/services/exposure";
import { roleHolderExclusions, sortCustomersByName } from "../lib/services/customer";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const org = "org-test";
const node = (id: string, mergedIntoId: string | null, status = "active"): CustomerNodeLike => ({
  id,
  orgId: org,
  name: id,
  status,
  mergedIntoId,
});

// 1. canonicalize follows the merge alias one-or-more hops to the survivor.
const nodes: CustomerNodeLike[] = [
  node("c1", null),
  node("c2", "c1", "merged"),
  node("c3", "c2", "merged"), // two hops: c3 → c2 → c1
];
t("canonical of an active customer is itself", canonicalizeCustomerNode(nodes, "c1")?.id === "c1");
t("canonical of a merged customer resolves to survivor", canonicalizeCustomerNode(nodes, "c2")?.id === "c1");
t("canonical follows a two-hop alias chain", canonicalizeCustomerNode(nodes, "c3")?.id === "c1");
t("canonical of an unknown id is null", canonicalizeCustomerNode(nodes, "missing") === null);

// 2. a cyclic alias cannot loop forever (terminates, returns a node).
const cyclic: CustomerNodeLike[] = [node("a", "b", "merged"), node("b", "a", "merged")];
t("canonical terminates on a cyclic alias", canonicalizeCustomerNode(cyclic, "a") != null);

// 3. role-holder exclusions map every role-holding customer to an approver seat.
const exclusions = roleHolderExclusions(
  [
    { id: "r1", orgId: org, requestId: "req1", customerId: "c1", role: "Borrower" },
    { id: "r2", orgId: org, requestId: "req1", customerId: "c2", role: "Guarantor" },
    { id: "r3", orgId: org, requestId: "req1", customerId: "missing", role: "Co-Applicant" },
  ],
  [
    { id: "c1", orgId: org, type: "Business", name: "Prairie Gold", status: "active", mergedIntoId: null, version: 1 },
    { id: "c2", orgId: org, type: "Individual", name: "Dale Hendricks", status: "active", mergedIntoId: null, version: 1 },
  ]
);
t("exclusions include the borrower's seat", exclusions.includes("u-prairie-gold"));
t("exclusions include the guarantor's seat", exclusions.includes("u-dale-hendricks"));
t("exclusions skip roles whose customer is missing", !exclusions.some((e) => e.includes("missing")));
t("exclusions are deduped", new Set(exclusions).size === exclusions.length);

const sorted = sortCustomersByName([
  { id: "2", orgId: org, type: "Individual", name: "Zulu", status: "active", mergedIntoId: null, version: 1 },
  { id: "1", orgId: org, type: "Business", name: "Alpha", status: "active", mergedIntoId: null, version: 1 },
]);
t("customers sort by name", sorted.map((c) => c.name).join(",") === "Alpha,Zulu");

// 4. exposure summaries are derived from graph data, not stubbed zeros.
const exposureSummary = summarizeExposureGraph({
  canonical: { id: "c1", orgId: org, name: "Prairie Gold", status: "active", mergedIntoId: null },
  connected: [
    { id: "c1", name: "Prairie Gold", status: "active" },
    { id: "c2", name: "Dale Hendricks", status: "merged" },
  ],
  edges: [{ fromId: "c2", toId: "c1", relationType: "Guarantor" }],
  brokenRefs: ["Broken customer edge x -> y"],
});
t("aggregate exposure anchors to the canonical customer", exposureSummary.canonicalCustomerId === "c1");
t("aggregate exposure counts connected parties", exposureSummary.connectedPartyCount === 1);
t("aggregate exposure counts relationships and broken refs", exposureSummary.relationshipCount === 1 && exposureSummary.brokenReferenceCount === 1);
t("aggregate exposure preserves connected customers", exposureSummary.connectedCustomers.length === 2);

// 5. the graph walk counts a dangling edge once, not once per traversal pass.
// Edge order here forces three passes: n3 is only reachable after n2 is added.
const walkNodes: CustomerNodeLike[] = [node("n1", null), node("n2", null), node("n3", null)];
const walked = buildCustomerGraph(
  walkNodes,
  [
    { fromId: "n2", toId: "n3", relationType: "Guarantor" },
    { fromId: "gone", toId: "n1", relationType: "Guarantor" },
    { fromId: "n1", toId: "n2", relationType: "Guarantor" },
  ],
  "n1"
);
t("graph walk reaches a node only linked on a later pass", walked.connected.length === 3);
t("a dangling edge is reported exactly once", walked.brokenRefs.length === 1, `got ${walked.brokenRefs.length}`);
t("a dangling endpoint never enters the connected set", !walked.connected.some((n) => n.id === "gone"));
t("an unknown anchor reports itself broken", buildCustomerGraph(walkNodes, [], "nope").brokenRefs.length === 1);

async function main() {
  if (failures) {
    console.error(`\n${failures} entity-integrity assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll entity-integrity assertions passed.");
}

void main();
