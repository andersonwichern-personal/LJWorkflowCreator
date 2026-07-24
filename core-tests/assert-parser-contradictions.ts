/**
 * Contradiction-detection suite (parser AI engine, Wave 2) — deterministic.
 *
 * Pins findContradictions: every kind fires on its positive fixture and stays
 * silent on the legitimate look-alikes (OR alternatives, gte/lte boundary
 * pins, notify fan-out, cross-lane duplicates), AND-region scoping respects
 * nesting, and clauseIds populate only when a clauses array is provided.
 *
 * Run: npx tsx core-tests/assert-parser-contradictions.ts
 */
import { findContradictions } from "../packages/rule-core/src/parserContradictions";
import type { ParsedClause } from "../packages/rule-core/src/parserClauses";
import {
  ConditionGroup,
  RuleOutput,
  RULE_SCHEMA_VERSION,
  WorkflowRule,
  defaultControls,
} from "../packages/rule-core/src/vocabulary";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const j = (v: unknown) => JSON.stringify(v);

function mkRule(conditions: ConditionGroup, actions: RuleOutput[] = [], elseLane?: RuleOutput[]): WorkflowRule {
  const rule: WorkflowRule = {
    schemaVersion: RULE_SCHEMA_VERSION,
    triggers: [{ event: "LOAN APPROVED" }],
    conditions,
    actions,
    controls: defaultControls(),
  };
  if (elseLane) rule.else = elseLane;
  return rule;
}

function mkClause(id: string, text: string, kind: ParsedClause["kind"] = "condition"): ParsedClause {
  return {
    id,
    span: { start: 0, end: text.length },
    rawSpan: { start: 0, end: text.length },
    text,
    kind,
    material: true,
  };
}

const and = (...children: ConditionGroup["children"]): ConditionGroup => ({ logic: "AND", children });
const or = (...children: ConditionGroup["children"]): ConditionGroup => ({ logic: "OR", children });

/* ---- mutually-exclusive-values --------------------------------------------- */
let f = findContradictions(
  mkRule(and({ field: "stage", operator: "is", value: "Approved" }, { field: "stage", operator: "is", value: "Closed" }))
);
t("mutex: same field, two 'is' values under AND → finding",
  f.length === 1 && f[0].kind === "mutually-exclusive-values", j(f));
t("mutex: paths use the flat conditions.leaf[i] convention",
  j(f[0]?.paths) === j(["conditions.leaf[0]", "conditions.leaf[1]"]), j(f[0]?.paths));
t("mutex: clauseIds empty when no clauses are passed", f[0]?.clauseIds.length === 0);

f = findContradictions(
  mkRule(and({ field: "bookstatus", operator: "is", value: "Error" }, { field: "bookstatus", operator: "is_not", value: "Error" }))
);
t("mutex: 'is X' + 'is not X' on the same field → finding",
  f.length === 1 && f[0].kind === "mutually-exclusive-values", j(f));

f = findContradictions(
  mkRule(and({ field: "stage", operator: "is", value: "Approved" }, { field: "stage", operator: "is_not", value: "Closed" }))
);
t("mutex: 'is X' + 'is not Y' (different values) is legitimate", f.length === 0, j(f));

f = findContradictions(
  mkRule(and({ field: "stage", operator: "is", value: "Approved" }, { field: "queue", operator: "is", value: "Approved" }))
);
t("mutex: different fields never conflict", f.length === 0, j(f));

f = findContradictions(
  mkRule(or({ field: "stage", operator: "is", value: "Approved" }, { field: "stage", operator: "is", value: "Closed" }))
);
t("mutex: OR group states alternatives → no finding", f.length === 0, j(f));

/* ---- nesting scope ---------------------------------------------------------- */
f = findContradictions(
  mkRule(
    and(
      { field: "stage", operator: "is", value: "Approved" },
      or({ field: "stage", operator: "is", value: "Closed" }, { field: "queue", operator: "is", value: "Assigned" })
    )
  )
);
t("scope: a leaf inside a nested OR does not conflict with the outer AND", f.length === 0, j(f));

f = findContradictions(
  mkRule(
    and({ field: "stage", operator: "is", value: "Approved" }, and({ field: "stage", operator: "is", value: "Closed" }))
  )
);
t("scope: AND nested in AND merges into one conflict region",
  f.length === 1 && j(f[0].paths) === j(["conditions.leaf[0]", "conditions.leaf[1]"]), j(f));

f = findContradictions(
  mkRule(
    or(
      and({ field: "stage", operator: "is", value: "Approved" }, { field: "stage", operator: "is", value: "Closed" }),
      { field: "queue", operator: "is", value: "Assigned" }
    )
  )
);
t("scope: an AND branch inside an OR is its own conflict scope",
  f.length === 1 && j(f[0].paths) === j(["conditions.leaf[0]", "conditions.leaf[1]"]), j(f));

/* ---- empty-numeric-range ---------------------------------------------------- */
f = findContradictions(
  mkRule(and({ field: "loan_amount", operator: "gt", value: "100" }, { field: "loan_amount", operator: "lt", value: "100" }))
);
t("range: gt 100 + lt 100 → empty range", f.length === 1 && f[0].kind === "empty-numeric-range", j(f));

f = findContradictions(
  mkRule(and({ field: "loan_amount", operator: "gte", value: "100" }, { field: "loan_amount", operator: "lte", value: "100" }))
);
t("range: gte 100 + lte 100 pins a point — FINE", f.length === 0, j(f));

f = findContradictions(
  mkRule(and({ field: "loan_amount", operator: "gt", value: "100" }, { field: "loan_amount", operator: "lte", value: "100" }))
);
t("range: gt 100 + lte 100 → empty range", f.length === 1 && f[0].kind === "empty-numeric-range", j(f));

f = findContradictions(
  mkRule(
    and({ field: "loan_amount", operator: "gte", value: "500000" }, { field: "loan_amount", operator: "lte", value: "100000" })
  )
);
t("range: gte 500k + lte 100k → empty range", f.length === 1 && f[0].kind === "empty-numeric-range", j(f));

f = findContradictions(
  mkRule(and({ field: "loan_amount", operator: "gt", value: "100000" }, { field: "loan_amount", operator: "lt", value: "500000" }))
);
t("range: a real window (gt 100k + lt 500k) is legitimate", f.length === 0, j(f));

f = findContradictions(
  mkRule(or({ field: "loan_amount", operator: "gt", value: "100" }, { field: "loan_amount", operator: "lt", value: "100" }))
);
t("range: bounds under OR are alternatives → no finding", f.length === 0, j(f));

/* ---- duplicate-action-conflict ---------------------------------------------- */
f = findContradictions(
  mkRule(and(), [
    { action: "change_stage", params: { value: "Approved" } },
    { action: "change_stage", params: { value: "Closed" } },
  ])
);
t("dup: change stage to Approved AND to Closed → conflict",
  f.length === 1 && f[0].kind === "duplicate-action-conflict" && j(f[0].paths) === j(["actions[0]", "actions[1]"]),
  j(f));

f = findContradictions(
  mkRule(and(), [
    { action: "notify", params: { value: "Sara" } },
    { action: "notify", params: { value: "Omar" } },
  ])
);
t("dup: notifying two people is fan-out, not conflict", f.length === 0, j(f));

f = findContradictions(
  mkRule(and(), [
    { action: "change_stage", params: { value: "Closed" } },
    { action: "change_stage", params: { value: "Closed" } },
  ])
);
t("dup: same target twice is redundancy, not contradiction", f.length === 0, j(f));

f = findContradictions(
  mkRule(and(), [], [
    { action: "assign_user", params: { assignee: "Wael" } },
    { action: "assign_user", params: { assignee: "Sara" } },
  ])
);
t("dup: else lane conflicts use else[i] paths",
  f.length === 1 && j(f[0].paths) === j(["else[0]", "else[1]"]), j(f));

f = findContradictions(
  mkRule(and(), [{ action: "change_stage", params: { value: "Approved" } }], [
    { action: "change_stage", params: { value: "Closed" } },
  ])
);
t("dup: then-lane vs else-lane targets never conflict (lanes are exclusive)", f.length === 0, j(f));

/* ---- clauseIds via evidence containment -------------------------------------- */
const clauses = [
  mkClause("c-trig", "when a loan is approved", "trigger"),
  mkClause("c-a", "stage is approved"),
  mkClause("c-b", "stage is closed"),
];
f = findContradictions(
  mkRule(and({ field: "stage", operator: "is", value: "Approved" }, { field: "stage", operator: "is", value: "Closed" })),
  clauses
);
t("clauseIds: evidence containment maps values onto clause ids",
  f.length === 1 && f[0].clauseIds.includes("c-b"), j(f[0]?.clauseIds));

/* ---- negated-and-required ---------------------------------------------------- */
f = findContradictions(
  mkRule(and(), [{ action: "change_stage", params: { value: "Closed" } }]),
  [mkClause("c-neg", "never change the stage", "no-op"), mkClause("c-act", "change stage to closed", "action-primary")]
);
t("negated: prohibition + requirement of the same action → finding",
  f.some((x) => x.kind === "negated-and-required" && j(x.paths) === j(["actions[0]"]) && j(x.clauseIds) === j(["c-neg"])),
  j(f));

f = findContradictions(
  mkRule(and(), [{ action: "assign_user", params: { assignee: "Sara" } }]),
  [mkClause("c-neg", "don't assign to wael", "no-op"), mkClause("c-act", "notify sara", "action-primary")]
);
t("negated: 'don't assign to Wael' does not contradict assigning to Sara",
  f.every((x) => x.kind !== "negated-and-required"), j(f));

f = findContradictions(mkRule(and(), [{ action: "change_stage", params: { value: "Closed" } }]));
t("negated: kind is undetectable without the clause layer", f.length === 0, j(f));

/* ---- determinism -------------------------------------------------------------- */
const detRule = mkRule(
  and(
    { field: "stage", operator: "is", value: "Approved" },
    { field: "stage", operator: "is", value: "Closed" },
    { field: "loan_amount", operator: "gt", value: "100" },
    { field: "loan_amount", operator: "lt", value: "100" }
  ),
  [
    { action: "change_stage", params: { value: "Approved" } },
    { action: "change_stage", params: { value: "Closed" } },
  ]
);
t("determinism: identical input → byte-identical findings",
  j(findContradictions(detRule, clauses)) === j(findContradictions(detRule, clauses)));

/* ---- exit ---------------------------------------------------------------------- */
if (failures) {
  console.error(`\n${failures} contradiction assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll contradiction assertions passed.");
