// Rule-core regression coverage retained as a drift guard.
export {};

// Exercises the REAL evaluator path for customer_name conditions against the real
// seed requests (customer_name resolves to a request's mainBorrower, ruleEngine.ts).

import { WorkflowRule, defaultControls } from "../src/app/core/vocabulary";
import { matchingRequests } from "../src/app/core/ruleEngine";
import { REQUESTS } from "../src/app/core/platformData";

let failures = 0;
function t(name: string, cond: boolean) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
}

function customerRule(operator: string, value: string): WorkflowRule {
  return {
    schemaVersion: 3,
    triggers: [{ event: "REQUEST CREATED" }], // always-true trigger; isolates the condition
    conditions: { logic: "AND", children: [{ field: "customer_name", operator, value }] },
    actions: [],
    controls: defaultControls(),
  };
}

const target = REQUESTS[0].mainBorrower; // a real borrower from seed data

// 1. "is" matches exactly the requests whose borrower equals the value.
const exact = matchingRequests(customerRule("is", target));
t("customer_name 'is' matches at least the target request", exact.length >= 1);
t("customer_name 'is' matches only that borrower", exact.every((r) => r.mainBorrower === target));
t("customer_name 'is' excludes other borrowers", exact.length < REQUESTS.length);

// 2. "contains" is a real substring match over the borrower label.
const token = target.split(" ")[0]; // first word of the borrower name
const partial = matchingRequests(customerRule("contains", token));
t("customer_name 'contains' matches the target", partial.some((r) => r.id === REQUESTS[0].id));
t("customer_name 'contains' only returns borrowers holding the token", partial.every((r) => r.mainBorrower.toLowerCase().includes(token.toLowerCase())));

// 3. A borrower that does not exist matches nothing.
const none = matchingRequests(customerRule("is", "No Such Borrower ZZZ"));
t("customer_name 'is' on an unknown borrower matches nothing", none.length === 0);

if (failures) {
  console.error(`\n${failures} customer-eval assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll customer-eval assertions passed.");
