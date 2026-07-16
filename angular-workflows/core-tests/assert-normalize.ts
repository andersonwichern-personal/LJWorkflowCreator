// PORTED from scripts/assert-normalize.ts (Vercel track) — drift guard for the shared rule core.
/**
 * Normalization suite (hardening plan §3.1) — v1 / v2 / v3 / garbage all become
 * well-formed v3 rules, idempotently. Run: npx tsx scripts/assert-normalize.ts
 */
import {
  normalizeRule,
  RULE_SCHEMA_VERSION,
  isGroup,
  walkLeaves,
  WorkflowRule,
} from "../src/app/core/vocabulary";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

/** A rule is structurally a valid v3 shape. */
function isValidV3(r: WorkflowRule): boolean {
  return (
    r.schemaVersion === RULE_SCHEMA_VERSION &&
    Array.isArray(r.triggers) &&
    !!r.conditions &&
    Array.isArray(r.conditions.children) &&
    (r.conditions.logic === "AND" || r.conditions.logic === "OR") &&
    Array.isArray(r.actions) &&
    !!r.controls &&
    (r.controls.mode === "shadow" || r.controls.mode === "armed") &&
    typeof r.controls.oncePerRequest === "boolean" &&
    typeof r.controls.maxFiresPerHour === "number" &&
    (r.controls.missingData === "no_match" || r.controls.missingData === "alert") &&
    typeof r.controls.priority === "number"
  );
}

/* ---- v1: legacy flat { event, conds, outputs, condLogic } ------------------ */
const v1 = {
  event: "SYSTEM ERROR",
  conds: [{ field: "bookstatus", operator: "is", value: "Error" }],
  outputs: [{ action: "assign_user", params: { assignee: "Escalation Team" } }],
  condLogic: "AND",
};
const nv1 = normalizeRule(v1);
t("v1 → valid v3 shape", isValidV3(nv1));
t("v1 → triggers[0].event preserved", nv1.triggers[0]?.event === "SYSTEM ERROR");
t("v1 → conds became root group children", walkLeaves(nv1.conditions).length === 1 && nv1.conditions.children[0] && !isGroup(nv1.conditions.children[0]));
t("v1 → outputs became actions", nv1.actions.length === 1 && nv1.actions[0].action === "assign_user");
t("v1 → controls default to shadow", nv1.controls.mode === "shadow" && nv1.controls.oncePerRequest === true && nv1.controls.maxFiresPerHour === 25);

/* ---- v2: { schemaVersion:2, trigger, conditions.rules, actions } ----------- */
const v2 = {
  schemaVersion: 2,
  trigger: { event: "LOAN APPROVED" },
  conditions: { logic: "OR", rules: [{ field: "loan_amount", operator: "gte", value: "250000" }] },
  actions: [{ action: "assign_user", params: { assignee: "Wael" } }],
};
const nv2 = normalizeRule(v2);
t("v2 → valid v3 shape", isValidV3(nv2));
t("v2 → single trigger from trigger.event", nv2.triggers.length === 1 && nv2.triggers[0].event === "LOAN APPROVED");
t("v2 → conditions.rules became children, logic preserved", nv2.conditions.logic === "OR" && walkLeaves(nv2.conditions).length === 1);

/* ---- v3: passthrough + missing controls coerced + nested groups preserved -- */
const v3 = {
  schemaVersion: 3,
  triggers: [{ event: "SYSTEM ERROR" }, { event: "FISERV LOAN" }],
  conditions: {
    logic: "AND",
    children: [
      { field: "bookstatus", operator: "is", value: "Error" },
      { logic: "OR", children: [{ field: "core", operator: "is", value: "FISERV LOAN" }, { field: "tags", operator: "is", value: "priority" }] },
    ],
  },
  actions: [{ action: "assign_user", params: { assignee: "Wael" } }],
  // controls intentionally omitted → must be coerced to defaults
};
const nv3 = normalizeRule(v3);
t("v3 → valid v3 shape", isValidV3(nv3));
t("v3 → multi-trigger preserved", nv3.triggers.length === 2);
t("v3 → nested group preserved (not flattened)", nv3.conditions.children.length === 2 && isGroup(nv3.conditions.children[1]));
t("v3 → walkLeaves finds all 3 leaves across nesting", walkLeaves(nv3.conditions).length === 3);
t("v3 → missing controls coerced to defaults", nv3.controls.mode === "shadow" && nv3.controls.maxFiresPerHour === 25);

/* ---- partial controls fallback-coerced ------------------------------------- */
const partialControls = normalizeRule({
  schemaVersion: 3,
  triggers: [{ event: "SYSTEM ERROR" }],
  conditions: { logic: "AND", children: [] },
  actions: [],
  controls: { mode: "armed", maxFiresPerHour: "oops" }, // bad number → default; missing fields → default
});
t("partial controls: valid mode kept", partialControls.controls.mode === "armed");
t("partial controls: bad number → default 25", partialControls.controls.maxFiresPerHour === 25);
t("partial controls: missing fields → defaults", partialControls.controls.oncePerRequest === true && partialControls.controls.priority === 100);

/* ---- garbage → safe empty v3 rule ------------------------------------------ */
t("garbage null → valid v3", isValidV3(normalizeRule(null)));
t("garbage number → valid v3", isValidV3(normalizeRule(42)));
t("garbage empty object → valid v3", isValidV3(normalizeRule({})));

/* ---- malformed children dropped, valid ones kept --------------------------- */
const mixed = normalizeRule({
  schemaVersion: 3,
  triggers: [{ event: "SYSTEM ERROR" }, { notEvent: true }],
  conditions: { logic: "AND", children: [{ field: "bookstatus", operator: "is", value: "Error" }, { garbage: true }, { field: 123 }] },
  actions: [{ action: "assign_user", params: {} }, { noAction: true }],
  controls: {},
});
t("malformed: invalid triggers dropped", mixed.triggers.length === 1);
t("malformed: invalid leaves dropped, valid kept", walkLeaves(mixed.conditions).length === 1);
t("malformed: invalid actions dropped", mixed.actions.length === 1);

/* ---- idempotency ----------------------------------------------------------- */
for (const [name, raw] of [["v1", v1], ["v2", v2], ["v3", v3], ["mixed input", mixed]] as const) {
  const once = normalizeRule(raw);
  const twice = normalizeRule(once);
  t(`idempotent: ${name}`, JSON.stringify(once) === JSON.stringify(twice));
}

if (failures) {
  console.error(`\n${failures} normalize assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll normalize assertions passed.");
