/**
 * Reference-audit suite (Phase 2 §4.5) — the pure scanner behind
 * GET /api/workflows/audit-refs. Run: npx tsx scripts/assert-refaudit.ts
 */
import { auditWorkflowRefs } from "../lib/refAudit";
import { emptyInstances } from "../lib/liveVocabulary";
import { defaultControls, RULE_SCHEMA_VERSION } from "@sweet/rule-core";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const registry = {
  ...emptyInstances(),
  retailers: [{ id: "r1", label: "Growmark" }],
  users: [{ id: "u1", label: "Wael Hamdan" }],
  templates: [{ id: "t1", label: "Ag Term Loan" }],
  stages: [{ id: "t1:s1", label: "Ag Term Loan › Intake" }],
  authorities: [{ id: "a1", label: "Loan Officer" }],
};

const rule = (over: object) => ({
  schemaVersion: RULE_SCHEMA_VERSION,
  triggers: [{ event: "SYSTEM ERROR" }],
  conditions: { logic: "AND", children: [] },
  actions: [],
  controls: defaultControls(),
  ...over,
});

const wf = (id: string, ruleJson: object) => ({ id, name: `wf-${id}`, ruleJson });

/* ---- instance ok / missing --------------------------------------------------- */
const okMissing = auditWorkflowRefs(
  [
    wf("1", rule({ conditions: { logic: "AND", children: [{ field: "retailer", operator: "is", value: { level: "instance", id: "r1", label: "Growmark" } }] } })),
    wf("2", rule({ conditions: { logic: "AND", children: [{ field: "retailer", operator: "is", value: { level: "instance", id: "GONE", label: "Closed Retailer" } }] } })),
  ],
  registry
);
t("verified=true with populated registries", okMissing.verified === true);
t("instance id in registry → ok", okMissing.entries.find((e) => e.workflowId === "1")?.status === "ok");
t("instance id absent → missing", okMissing.entries.find((e) => e.workflowId === "2")?.status === "missing");

/* ---- legacy-unresolved --------------------------------------------------------- */
const legacy = auditWorkflowRefs(
  [wf("3", rule({
    conditions: { logic: "AND", children: [{ field: "team_member", operator: "is", value: "Wael" }] },
    actions: [{ action: "assign_user", params: { assignee: "Sara" } }],
  }))],
  registry
);
t("bare string on instance-shaped condition → legacy-unresolved",
  legacy.entries.some((e) => e.path.startsWith("conditions") && e.status === "legacy-unresolved"));
t("bare string on instance-shaped param → legacy-unresolved",
  legacy.entries.some((e) => e.path === "actions[0].assignee" && e.status === "legacy-unresolved"));
t("counts add up", legacy.counts.legacyUnresolved === 2);

/* ---- non-scoped fields and empty strings produce no entries -------------------- */
const quiet = auditWorkflowRefs(
  [wf("4", rule({
    conditions: { logic: "AND", children: [
      { field: "bookstatus", operator: "is", value: "Error" },      // not instance-shaped
      { field: "retailer", operator: "is", value: "" },              // empty = unfilled, not a ref
      { field: "customer_name", operator: "is", value: { level: "category", category: "Business" } }, // category — nothing to rot
    ] },
  }))],
  registry
);
t("non-scoped fields, empty strings, and categories are silent", quiet.entries.length === 0, JSON.stringify(quiet.entries));

/* ---- trigger scopes + else lane -------------------------------------------------- */
const deep = auditWorkflowRefs(
  [wf("5", rule({
    triggers: [{ event: "SYSTEM ERROR", scope: { level: "instance", id: "t9", label: "Deleted Template" } }],
    else: [{ action: "notify", params: { value: { level: "instance", id: "u1", label: "Wael Hamdan" } } }],
  }))],
  registry
);
t("trigger scope audited (missing template)", deep.entries.some((e) => e.path === "triggers[0].scope" && e.status === "missing"));
t("else lane audited (ok user)", deep.entries.some((e) => e.path === "else[0].value" && e.status === "ok"));

/* ---- per-source verification: empty registry never false-alarms ------------------ */
const partial = auditWorkflowRefs(
  [wf("6", rule({
    conditions: { logic: "AND", children: [{ field: "retailer", operator: "is", value: { level: "instance", id: "r-unknown", label: "X" } }] },
    actions: [{ action: "assign_authority", params: { value: { level: "instance", id: "a-gone", label: "Old Authority" } } }],
  }))],
  { ...emptyInstances(), authorities: [{ id: "a1", label: "Loan Officer" }] } // retailers registry EMPTY
);
t("empty retailer registry → unverifiable → ok (no false alarm)",
  partial.entries.find((e) => e.path.startsWith("conditions"))?.status === "ok");
t("populated authorities registry still verifies → missing",
  partial.entries.find((e) => e.path.startsWith("actions"))?.status === "missing");

/* ---- legacy v1/v2 rows flow through normalizeRule inside the scanner ------------- */
const v1row = auditWorkflowRefs(
  [wf("7", { event: "SYSTEM ERROR", conds: [{ field: "retailer", operator: "is", value: "Growmark" }], outputs: [], condLogic: "AND" })],
  registry
);
t("legacy v1 row scans (string retailer → legacy-unresolved)",
  v1row.entries.some((e) => e.status === "legacy-unresolved"));

if (failures) {
  console.error(`\n${failures} ref-audit assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll ref-audit assertions passed.");
