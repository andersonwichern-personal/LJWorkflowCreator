// PORTED from scripts/assert-scope.ts (Vercel track) — drift guard for the shared rule core.
/**
 * ScopeRef suite (Phase 2) — helper totality, scopeMatches semantics (incl.
 * the C7 stage-collision kill), evaluator integration on seed data, rendering
 * (never "[object Object]"), normalization preservation, validator guards.
 * Run: npx tsx scripts/assert-scope.ts
 */
import {
  ScopeRef,
  scopeLabel,
  scopeInstanceId,
  isLegacyString,
  isScopeRef,
  normalizeRule,
  WorkflowRule,
  walkLeaves,
  defaultControls,
  RULE_SCHEMA_VERSION,
} from "../src/app/core/vocabulary";
import { scopeMatches, simulateRule } from "../src/app/core/ruleEvaluator";
import { describeActions, matchingRequests } from "../src/app/core/ruleEngine";
import { validateRule } from "../src/app/core/ruleValidation";
import { getRequest } from "../src/app/core/platformData";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const inst = (id: string, label: string): ScopeRef => ({ level: "instance", id, label });
const cat = (category: string): ScopeRef => ({ level: "category", category });

/* ---- helper totality -------------------------------------------------------- */
t("scopeLabel: string passthrough", scopeLabel("Wael") === "Wael");
t("scopeLabel: instance → label", scopeLabel(inst("u1", "Wael Hamdan")) === "Wael Hamdan");
t("scopeLabel: category → name", scopeLabel(cat("Business")) === "Business");
t("scopeLabel: any → 'any'", scopeLabel({ level: "any" }) === "any");
t("scopeLabel: null/undefined → ''", scopeLabel(null) === "" && scopeLabel(undefined) === "");
t("scopeInstanceId: instance → id", scopeInstanceId(inst("u1", "W")) === "u1");
t("scopeInstanceId: string/category/any → null",
  scopeInstanceId("x") === null && scopeInstanceId(cat("B")) === null && scopeInstanceId({ level: "any" }) === null);
t("isLegacyString guards", isLegacyString("x") === true && isLegacyString(inst("i", "l")) === false);
t("isScopeRef rejects malformed", !isScopeRef({ level: "instance", id: 5 }) && !isScopeRef({ level: "nope" }) && !isScopeRef("str"));

/* ---- scopeMatches ------------------------------------------------------------ */
t("string label match (case-insensitive)", scopeMatches("growmark", null, "Growmark") === true);
t("any matches vacuously", scopeMatches({ level: "any" }, null, "whatever") === true);
t("category matches the category attribute", scopeMatches(cat("Business"), null, "Business") === true);
t("category mismatch", scopeMatches(cat("Business"), null, "Individual") === false);
t("instance: id wins when actualId present", scopeMatches(inst("r1", "Old Label"), "r1", "Renamed") === true);
t("instance: id mismatch fails even when label matches", scopeMatches(inst("r1", "Growmark"), "r2", "Growmark") === false);
t("instance: label fallback when no id", scopeMatches(inst("r1", "Growmark"), null, "Growmark") === true);
t("C7: stage instance label fallback matches bare stage segment",
  scopeMatches(inst("t1:s2", "Ag Loan › Processing"), null, "Processing") === true);
t("C7: two same-named stages distinct by id when ids present",
  scopeMatches(inst("t1:s2", "Ag Loan › Processing"), "t2:s9", "Processing") === false);

/* ---- evaluator integration on seed data (label fallback path) ---------------- */
const v3 = (partial: Partial<WorkflowRule>): WorkflowRule => ({
  schemaVersion: RULE_SCHEMA_VERSION,
  triggers: [{ event: "LOAN APPROVED" }],
  conditions: { logic: "AND", children: [] },
  actions: [],
  controls: defaultControls(),
  ...partial,
});

// REQ-4821 Prairie Gold: retailer Growmark, customerType Business, stage Approved.
const rInstRetailer = v3({
  triggers: [{ event: "SYSTEM ERROR" }],
  conditions: { logic: "AND", children: [{ field: "retailer", operator: "is", value: inst("ret-1", "Growmark") }] },
});
t("instance retailer matches seed by label fallback", simulateRule(rInstRetailer, getRequest("REQ-4821")!).matched === true);

const rCatCustomer = v3({
  conditions: { logic: "AND", children: [{ field: "customer_name", operator: "is", value: cat("Business") }] },
});
t("category customer (Business) resolves via custtype attribute", simulateRule(rCatCustomer, getRequest("REQ-4821")!).matched === true);
t("category customer (Individual) fails on a Business request", simulateRule(v3({
  conditions: { logic: "AND", children: [{ field: "customer_name", operator: "is", value: cat("Individual") }] },
}), getRequest("REQ-4821")!).matched === false);

const rStageInst = v3({
  conditions: { logic: "AND", children: [{ field: "stage", operator: "is", value: inst("t1:s3", "Ag Term Loan › Approved") }] },
});
t("stage instance matches seed stage via segment fallback", simulateRule(rStageInst, getRequest("REQ-4821")!).matched === true);

t("is_not inverts a ScopeRef match", simulateRule(v3({
  conditions: { logic: "AND", children: [{ field: "retailer", operator: "is_not", value: inst("r", "Growmark") }] },
  triggers: [{ event: "SYSTEM ERROR" }],
}), getRequest("REQ-4821")!).matched === false);

/* ---- trigger scope ------------------------------------------------------------ */
const scoped = v3({ triggers: [{ event: "SYSTEM ERROR", scope: inst("tmpl-1", "Ag Term Loan") }] });
t("trigger instance scope fail-closed on seed data (template unknown)",
  simulateRule(scoped, getRequest("REQ-4821")!).matched === false);
const anyScoped = v3({ triggers: [{ event: "SYSTEM ERROR", scope: { level: "any" } }] });
t("trigger any scope matches", simulateRule(anyScoped, getRequest("REQ-4821")!).matched === true);

/* ---- rendering: never [object Object] ---------------------------------------- */
const withRefs = v3({
  conditions: { logic: "AND", children: [{ field: "retailer", operator: "is", value: inst("r1", "Growmark") }] },
  actions: [{ action: "assign_user", params: { assignee: inst("u1", "Wael Hamdan") } }],
  else: [{ action: "notify", params: { value: cat("Underwriting Team") } }],
});
const rendered = JSON.stringify({
  actions: describeActions(withRefs),
  trace: simulateRule(withRefs, getRequest("REQ-4821")!),
});
t("no [object Object] in descriptions/traces", !rendered.includes("[object Object]"), rendered.slice(0, 200));
t("describeActions uses the instance label", describeActions(withRefs)[0].includes("Wael Hamdan"));

/* ---- normalization preserves ScopeRefs (idempotent) --------------------------- */
const normalized = normalizeRule(JSON.parse(JSON.stringify(withRefs)));
const leaf = walkLeaves(normalized.conditions)[0];
t("normalize preserves instance leaf value", !isLegacyString(leaf.value) && scopeInstanceId(leaf.value) === "r1");
t("normalize preserves ScopeRef params", scopeInstanceId(normalized.actions[0].params.assignee) === "u1");
t("normalize preserves category else param", scopeLabel(normalized.else![0].params.value) === "Underwriting Team");
t("normalize idempotent with ScopeRefs", JSON.stringify(normalizeRule(normalized)) === JSON.stringify(normalized));
const trigScoped = normalizeRule(v3({ triggers: [{ event: "SYSTEM ERROR", scope: inst("t1", "Ag") }] }));
t("normalize preserves trigger scope", trigScoped.triggers[0].scope?.level === "instance");
t("normalize drops malformed scope objects to string ''", (() => {
  const bad = normalizeRule(v3({
    conditions: { logic: "AND", children: [{ field: "retailer", operator: "is", value: { junk: true } as never }] },
  }));
  return walkLeaves(bad.conditions)[0].value === "";
})());

/* ---- validator guards ---------------------------------------------------------- */
const numRef = validateRule(v3({
  conditions: { logic: "AND", children: [{ field: "loan_amount", operator: "gte", value: inst("x", "y") }] },
}));
t("validator: ScopeRef on numeric field → NON_NUMERIC_VALUE error",
  numRef.issues.some((i) => i.code === "NON_NUMERIC_VALUE" && i.severity === "error"));
const enumRef = validateRule(v3({
  actions: [{ action: "change_stage", params: { value: inst("t1:s1", "Ag › Intake") } }],
}));
t("validator: instance ref on enum param is allowed (registry-picked)",
  !enumRef.issues.some((i) => i.code === "INVALID_ACTION_PARAM"));

/* ---- engine parity (list matcher uses the same path) --------------------------- */
t("matchingRequests agrees with simulateRule for ScopeRef rules",
  matchingRequests(rInstRetailer).some((r) => r.id === "REQ-4821"));

if (failures) {
  console.error(`\n${failures} scope assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll scope assertions passed.");
