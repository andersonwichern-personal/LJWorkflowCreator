// PORTED from scripts/assert-validation.ts (Vercel track) — drift guard for the shared rule core.
/**
 * Validator suite (hardening plan §3.2) — every error + warning code has a red
 * fixture, plus a clean rule that produces none. Run:
 *   npx tsx scripts/assert-validation.ts
 */
import { validateRule } from "../src/app/core/ruleValidation";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

function has(raw: unknown, code: string, severity: "error" | "warning"): boolean {
  const { issues } = validateRule(raw);
  return issues.some((i) => i.code === code && i.severity === severity);
}

// A base valid v3 rule; spread + override to build fixtures.
const base = {
  schemaVersion: 3,
  triggers: [{ event: "SYSTEM ERROR" }],
  conditions: { logic: "AND", children: [{ field: "bookstatus", operator: "is", value: "Error" }] },
  actions: [{ action: "assign_user", params: { assignee: "Escalation Team" } }],
  controls: { mode: "shadow", oncePerRequest: true, maxFiresPerHour: 25, missingData: "no_match", priority: 100 },
};

/** Build a group nested to a total depth (root counts as 1). */
function nested(depth: number): unknown {
  let g: unknown = { logic: "AND", children: [{ field: "bookstatus", operator: "is", value: "Error" }] };
  for (let i = 1; i < depth; i++) g = { logic: "AND", children: [g] };
  return g;
}

/* ---- ERRORS ---------------------------------------------------------------- */
t("SCHEMA_VERSION_UNKNOWN", has({ ...base, schemaVersion: 99 }, "SCHEMA_VERSION_UNKNOWN", "error"));
t("EMPTY_TRIGGERS", has({ ...base, triggers: [] }, "EMPTY_TRIGGERS", "error"));
t("UNKNOWN_EVENT", has({ ...base, triggers: [{ event: "NOT_AN_EVENT" }] }, "UNKNOWN_EVENT", "error"));
t("GROUP_DEPTH_EXCEEDED (depth 5)", has({ ...base, conditions: nested(5) }, "GROUP_DEPTH_EXCEEDED", "error"));
t("UNKNOWN_FIELD", has({ ...base, conditions: { logic: "AND", children: [{ field: "not_a_field", operator: "is", value: "x" }] } }, "UNKNOWN_FIELD", "error"));
t("INVALID_OPERATOR", has({ ...base, triggers: [{ event: "LOAN APPROVED" }], conditions: { logic: "AND", children: [{ field: "loan_amount", operator: "contains", value: "1" }] } }, "INVALID_OPERATOR", "error"));
t("NON_NUMERIC_VALUE", has({ ...base, triggers: [{ event: "LOAN APPROVED" }], conditions: { logic: "AND", children: [{ field: "loan_amount", operator: "gte", value: "lots" }] } }, "NON_NUMERIC_VALUE", "error"));
t("UNKNOWN_ACTION", has({ ...base, actions: [{ action: "fly_to_moon", params: {} }] }, "UNKNOWN_ACTION", "error"));
t("INVALID_ACTION_PARAM", has({ ...base, actions: [{ action: "change_stage", params: { value: "Neverland" } }] }, "INVALID_ACTION_PARAM", "error"));
t("NO_ACTIONS_WHEN_ARMED", has({ ...base, actions: [], controls: { ...base.controls, mode: "armed" } }, "NO_ACTIONS_WHEN_ARMED", "error"));
t("INVALID_RATE_LIMIT", has({ ...base, controls: { ...base.controls, maxFiresPerHour: 0 } }, "INVALID_RATE_LIMIT", "error"));
t("FIELD_NOT_ALLOWED_FOR_TRIGGERS", has({ ...base, conditions: { logic: "AND", children: [{ field: "loan_amount", operator: "gte", value: "100" }] } }, "FIELD_NOT_ALLOWED_FOR_TRIGGERS", "error"));

/* ---- WARNINGS -------------------------------------------------------------- */
t("UNCONFIRMED_TOKEN (trigger)", has({ ...base, triggers: [{ event: "REQUEST CREATED" }] }, "UNCONFIRMED_TOKEN", "warning"));
t("FORM_FIELD_TRIGGER_MISMATCH", has(
  { ...base, conditions: { logic: "AND", children: [{ field: { kind: "formField", formTemplateId: "t1", fieldId: "f1", label: "Crop", fieldKind: "text" }, operator: "is", value: "corn" }] } },
  "FORM_FIELD_TRIGGER_MISMATCH", "warning"));
t("EMPTY_ELSE", has({ ...base, else: [] }, "EMPTY_ELSE", "warning"));
t("DEPTH_OVER_UI_CAP (depth 3)", has({ ...base, conditions: nested(3) }, "DEPTH_OVER_UI_CAP", "warning"));

/* ---- CLEAN RULE ------------------------------------------------------------ */
const clean = validateRule(base);
t("valid rule → no errors", clean.issues.filter((i) => i.severity === "error").length === 0, JSON.stringify(clean.issues));
t("valid rule → rule returned (not null)", clean.rule !== null);

/* ---- rule is null when errors present -------------------------------------- */
const bad = validateRule({ ...base, triggers: [] });
t("errors → rule is null", bad.rule === null);

if (failures) {
  console.error(`\n${failures} validation assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll validation assertions passed.");
