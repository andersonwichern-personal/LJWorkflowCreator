// Rule-core regression coverage retained as a drift guard.
/**
 * Operator semantics + evaluator-parity suite (hardening plan §2.4/§2.6).
 * Run: npx tsx core-tests/assert-operators.ts
 */
import { evaluateCondition, simulateRule } from "../src/app/core/ruleEvaluator";
import { matchingRequests } from "../src/app/core/ruleEngine";
import { REQUESTS } from "../src/app/core/platformData";
import { OPERATORS, FIELDS, WorkflowRule, normalizeRule } from "../src/app/core/vocabulary";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

/* ---- Empty operators: unknown ≠ empty (§2.4) ------------------------------ */
t("is_empty: null matches", evaluateCondition(null, "is_empty", "", "text") === true);
t("is_empty: empty string matches", evaluateCondition("", "is_empty", "", "text") === true);
t("is_empty: empty array matches", evaluateCondition([], "is_empty", "", "text") === true);
t("is_empty: value present → no", evaluateCondition("x", "is_empty", "", "text") === false);
t("is_not_empty: inverse", evaluateCondition("x", "is_not_empty", "", "text") === true &&
  evaluateCondition(null, "is_not_empty", "", "text") === false);
t("is_empty available on every kind",
  (Object.keys(OPERATORS) as Array<keyof typeof OPERATORS>).every((k) =>
    OPERATORS[k].some((o) => o.value === "is_empty") && OPERATORS[k].some((o) => o.value === "is_not_empty")));

/* ---- orderedEnum: worse_than / better_than -------------------------------- */
const GRADES = FIELDS.risk_grade.options!;
t("risk_grade is orderedEnum", FIELDS.risk_grade.kind === "orderedEnum");
t("worse_than: C worse than B", evaluateCondition("C", "worse_than", "B", "orderedEnum", GRADES) === true);
t("worse_than: A not worse than B", evaluateCondition("A", "worse_than", "B", "orderedEnum", GRADES) === false);
t("better_than: A better than B", evaluateCondition("A", "better_than", "B", "orderedEnum", GRADES) === true);
t("worse_than: unknown value ranks worst", evaluateCondition("Z", "worse_than", "E", "orderedEnum", GRADES) === true);
t("orderedEnum is/is_not still work", evaluateCondition("B", "is", "b", "orderedEnum", GRADES) === true &&
  evaluateCondition("B", "is_not", "B", "orderedEnum", GRADES) === false);

/* ---- Numeric guards -------------------------------------------------------- */
t("numeric NaN never matches", evaluateCondition("abc", "gte", "10", "numeric") === false);
t("numeric gte", evaluateCondition(485000, "gte", "250000", "numeric") === true);
t("numeric is_empty on null", evaluateCondition(null, "is_empty", "", "numeric") === true);

/* ---- Arrays (tags) ---------------------------------------------------------- */
t("tags membership", evaluateCondition(["priority", "large-loan"], "is", "priority", "text") === true);
t("tags is_not absence", evaluateCondition(["a"], "is_not", "b", "text") === true);
t("tags is_empty", evaluateCondition([], "is_empty", "", "text") === true);

/* ---- Parity: list engine (ruleEngine) vs traced simulator (§2.6) -----------
   Authored as legacy v2 literals and upgraded through normalizeRule → exercises
   the v2→v3 conversion path at the same time. */
const CASES: WorkflowRule[] = [
  { schemaVersion: 2, trigger: { event: "SYSTEM ERROR" }, conditions: { logic: "AND", rules: [{ field: "bookstatus", operator: "is", value: "Error" }] }, actions: [] },
  { schemaVersion: 2, trigger: { event: "LOAN APPROVED" }, conditions: { logic: "AND", rules: [{ field: "loan_amount", operator: "gte", value: "250000" }] }, actions: [] },
  { schemaVersion: 2, trigger: { event: "LOAN APPROVED" }, conditions: { logic: "OR", rules: [{ field: "risk_grade", operator: "worse_than", value: "B" }, { field: "tags", operator: "is", value: "priority" }] }, actions: [] },
  { schemaVersion: 2, trigger: { event: "LOAN APPROVED" }, conditions: { logic: "AND", rules: [{ field: "team_member", operator: "is_not_empty", value: "" }] }, actions: [] },
  { schemaVersion: 2, trigger: { event: "LOAN APPROVED" }, conditions: { logic: "AND", rules: [{ field: "risk_grade", operator: "is_empty", value: "" }] }, actions: [] },
].map(normalizeRule);
CASES.forEach((rule, i) => {
  const listed = new Set(matchingRequests(rule).map((r) => r.id));
  const simulated = new Set(REQUESTS.filter((r) => simulateRule(rule, r).matched).map((r) => r.id));
  const same = listed.size === simulated.size && [...listed].every((id) => simulated.has(id));
  t(`parity case ${i + 1}: engine === simulator`, same,
    `listed=${[...listed]} simulated=${[...simulated]}`);
});

/* risk_grade is UNKNOWN in seed data: is_empty must NOT match (unknown ≠ empty) */
const unknownEmpty = CASES[4];
t("unknown field: is_empty does not match (unknown ≠ empty)", matchingRequests(unknownEmpty).length === 0);

if (failures) {
  console.error(`\n${failures} operator assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll operator assertions passed.");
