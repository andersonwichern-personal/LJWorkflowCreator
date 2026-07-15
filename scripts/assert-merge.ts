export {};

// Exercises the REAL pure merge logic: rewriteCustomerInstanceRefs, the transform
// mergeCustomers applies to workflow rules when a duplicate customer is merged
// away. (The DB-bound parts of mergeCustomers are covered by live smoke testing;
// the rule-ref rewrite is the interesting pure logic and is tested here.)

import {
  ConditionGroup,
  ConditionLeaf,
  ConditionNode,
  WorkflowRule,
  defaultControls,
  isGroup,
  isScopeRef,
} from "../lib/vocabulary";
import { rewriteCustomerInstanceRefs } from "../lib/customerRefRewrite";

let failures = 0;
function t(name: string, cond: boolean) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
}

const inst = (id: string, label: string): ConditionLeaf["value"] =>
  ({ level: "instance", id, label });

function leafAt(group: ConditionGroup, path: number[]): ConditionLeaf {
  let node: ConditionNode = group;
  for (const i of path) {
    if (!isGroup(node)) throw new Error("expected group on path");
    node = node.children[i];
  }
  if (isGroup(node)) throw new Error("expected leaf at path");
  return node;
}
function refId(leaf: ConditionLeaf): string | null {
  return isScopeRef(leaf.value) && leaf.value.level === "instance" ? leaf.value.id : null;
}
function refLabel(leaf: ConditionLeaf): string | null {
  return isScopeRef(leaf.value) && leaf.value.level === "instance" ? leaf.value.label : null;
}

function ruleWithCustomer(field: string, id: string, label: string): WorkflowRule {
  return {
    schemaVersion: 3,
    triggers: [{ event: "REQUEST CREATED" }],
    conditions: {
      logic: "AND",
      children: [
        { field, operator: "is", value: inst(id, label) },
        // nested sub-group with the same ref → proves recursion
        { logic: "OR", children: [{ field, operator: "is", value: inst(id, label) }] },
      ],
    },
    actions: [],
    controls: defaultControls(),
  };
}

// 1. dup → survivor repoints every customer_name instance ref, at any depth.
const r1 = rewriteCustomerInstanceRefs(
  ruleWithCustomer("customer_name", "dup-1", "Prairie Gold Farms"),
  "dup-1",
  "surv-1",
  "Prairie Gold Farms LLC"
);
t("merge rewrite reports changed", r1.changed === true);
t("merge repoints top-level leaf id", refId(leafAt(r1.rule.conditions, [0])) === "surv-1");
t("merge refreshes survivor label", refLabel(leafAt(r1.rule.conditions, [0])) === "Prairie Gold Farms LLC");
t("merge repoints nested-group leaf id", refId(leafAt(r1.rule.conditions, [1, 0])) === "surv-1");

// 2. A ref to a different customer is left untouched.
const r2 = rewriteCustomerInstanceRefs(
  ruleWithCustomer("customer_name", "other-9", "Someone Else"),
  "dup-1",
  "surv-1",
  "X"
);
t("merge leaves unrelated customer refs unchanged", r2.changed === false);
t("merge keeps unrelated ref id", refId(leafAt(r2.rule.conditions, [0])) === "other-9");

// 3. Field guard: a non-customer field carrying the same id is NOT rewritten.
const r3 = rewriteCustomerInstanceRefs(
  ruleWithCustomer("retailer", "dup-1", "Growmark"),
  "dup-1",
  "surv-1",
  "X"
);
t("merge does not touch same-id refs on non-customer fields", r3.changed === false);

if (failures) {
  console.error(`\n${failures} merge assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll merge assertions passed.");
