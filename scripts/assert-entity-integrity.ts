export {};

// Exercises REAL pure entity-integrity logic: the customer alias-walk
// (canonicalize) and role-holder exclusion derivation. No mock literals stand in
// for the functions under test.

import { canonicalizeCustomerNode, type CustomerNodeLike } from "../lib/services/customerGraphPure";
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

if (failures) {
  console.error(`\n${failures} entity-integrity assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll entity-integrity assertions passed.");
