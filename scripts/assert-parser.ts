/**
 * Parser honesty suite (hardening plan §2.7) — deterministic eval harness.
 * Run: npx tsx scripts/assert-parser.ts
 */
import { parseInstruction } from "../lib/nlParser";
import { walkLeaves, WorkflowRule } from "../lib/vocabulary";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

/** Flat leaf list of a parsed rule (v3 root group is flat). */
const leaves = (rule: WorkflowRule | null) => (rule ? walkLeaves(rule.conditions) : []);

/* ---- Baseline: the 4 ChatBox pill examples ------------------------------- */
/* Fixtures now assert the v3 emit (Phase 1): triggers[], root condition group
 * with `children`, and default (shadow) controls. Pill 2 still reflects the
 * Phase-0 fix where "loan amount is at least 250k" parses to gte (was dropped). */
const PILLS: Array<[string, string]> = [
  [
    "If there is a system error and booking status is Error, assign to Wael",
    '{"schemaVersion":3,"triggers":[{"event":"SYSTEM ERROR"}],"conditions":{"logic":"AND","children":[{"field":"bookstatus","operator":"is","value":"Error"},{"field":"data_status","operator":"is","value":"Error"},{"field":"processing_status","operator":"is","value":"Error"}]},"actions":[{"action":"assign_user","params":{"assignee":"Wael"}}],"controls":{"mode":"shadow","oncePerRequest":true,"maxFiresPerHour":25,"missingData":"no_match","priority":100}}',
  ],
  [
    "When a loan is approved and loan amount is at least 250k, assign to Underwriting Team",
    '{"schemaVersion":3,"triggers":[{"event":"LOAN APPROVED"}],"conditions":{"logic":"AND","children":[{"field":"loan_amount","operator":"gte","value":"250000"}]},"actions":[{"action":"assign_user","params":{"assignee":"Underwriting Team"}}],"controls":{"mode":"shadow","oncePerRequest":true,"maxFiresPerHour":25,"missingData":"no_match","priority":100}}',
  ],
  [
    "When a Fiserv loan booking status is Error, notify Booking Team and add tag booking-failed",
    '{"schemaVersion":3,"triggers":[{"event":"FISERV LOAN"}],"conditions":{"logic":"AND","children":[{"field":"bookstatus","operator":"is","value":"Error"},{"field":"data_status","operator":"is","value":"Error"},{"field":"processing_status","operator":"is","value":"Error"},{"field":"core","operator":"is","value":"FISERV LOAN"}]},"actions":[{"action":"notify","params":{"value":"Booking Team"}},{"action":"add_tag","params":{"value":"booking-failed"}}],"controls":{"mode":"shadow","oncePerRequest":true,"maxFiresPerHour":25,"missingData":"no_match","priority":100}}',
  ],
  [
    "When a loan is rejected, change stage to Closed",
    '{"schemaVersion":3,"triggers":[{"event":"LOAN REJECTED"}],"conditions":{"logic":"AND","children":[{"field":"stage","operator":"is","value":"Closed"}]},"actions":[{"action":"change_stage","params":{"value":"Closed"}}],"controls":{"mode":"shadow","oncePerRequest":true,"maxFiresPerHour":25,"missingData":"no_match","priority":100}}',
  ],
];
PILLS.forEach(([input, expected], i) => {
  const got = JSON.stringify(parseInstruction(input).rule);
  t(`pill ${i + 1} fixture`, got === expected, `got ${got}`);
});
PILLS.forEach(([input], i) => {
  const r = parseInstruction(input);
  t(`pill ${i + 1} fully covered + resolved`, r.uncovered.length === 0 && r.unresolved.length === 0,
    `uncovered=${JSON.stringify(r.uncovered)} unresolved=${r.unresolved.length}`);
});

/* ---- N1: reject, don't coerce --------------------------------------------- */
let r = parseInstruction("When a loan is approved, assign to Santa Claus");
t("N1: unknown assignee → unresolved slot, empty param",
  r.rule?.actions[0]?.action === "assign_user" &&
    Object.keys(r.rule.actions[0].params).length === 0 &&
    r.unresolved.length === 1 &&
    r.unresolved[0].where === "action-param" &&
    r.unresolved[0].heard === "santa claus");
t("N1: nothing fabricated", JSON.stringify(r.rule).includes("Santa") === false);

r = parseInstruction("When a loan is approved, assign to wael");
t("N1: case-insensitive resolve → Wael", r.rule?.actions[0]?.params.assignee === "Wael" && r.unresolved.length === 0);

r = parseInstruction("When a loan is approved, assign to Waell");
t("N1: near-miss gets fuzzy suggestion", r.unresolved[0]?.suggestions.includes("Wael") === true,
  JSON.stringify(r.unresolved));

r = parseInstruction("When a loan is approved, change stage to Finished");
t("N1: unknown stage → unresolved slot (no fabricated stage)",
  r.rule?.actions[0]?.action === "change_stage" &&
    Object.keys(r.rule.actions[0].params).length === 0 &&
    r.unresolved[0]?.param === "value");

r = parseInstruction("When a loan is approved, change stage to Close");
t("N1: near-miss stage suggests Closed",
  r.unresolved[0]?.suggestions.includes("Closed") === true, JSON.stringify(r.unresolved));

/* live-list resolution for instance-shaped condition values */
r = parseInstruction("When a loan is approved and retailer is Growmarc, assign to wael", {
  instanceOptions: { retailer: ["Growmark", "FCS Financial"] },
});
t("N1: instance condition resolves/slots against live list",
  r.unresolved.some((s) => s.where === "condition-value" && s.suggestions.includes("Growmark")),
  JSON.stringify(r.unresolved));

/* ---- N2: coverage --------------------------------------------------------- */
r = parseInstruction("When a loan is approved, assign to wael and request tax returns");
t("N2: unparsed clause surfaces in uncovered",
  r.uncovered.some((u) => u.includes("request tax returns")), JSON.stringify(r.uncovered));

/* ---- N3: ambiguity --------------------------------------------------------- */
r = parseInstruction("When a document is approved, notify sara");
t("N3: document+approved → question, no rule",
  r.rule === null && r.ambiguities.length === 1 && r.ambiguities[0].options.includes("DOCUMENT APPROVED"));

r = parseInstruction("When a document is approved, notify sara", { forceEvent: "DOCUMENT APPROVED" });
t("N3: forceEvent resolves the ambiguity",
  r.rule?.triggers[0].event === "DOCUMENT APPROVED" && r.rule?.actions[0]?.params.value === "Sara");

r = parseInstruction("When the offer is declined, add tag lost-deal");
t("N3: offer+declined → question", r.rule === null && r.ambiguities[0]?.options.includes("OFFER REJECTED"));

/* ---- N4: negation ---------------------------------------------------------- */
r = parseInstruction("When a loan is approved, don't assign to Wael, notify Sara");
t("N4: negated assign excluded, notify kept",
  r.rule?.actions.length === 1 && r.rule.actions[0].action === "notify" && r.rule.actions[0].params.value === "Sara");
t("N4: negation note present", r.notes.some((n) => n.startsWith("Ignored negated")));

/* ---- Operators from language ----------------------------------------------- */
r = parseInstruction("When a loan is approved and loan amount over 250k, notify sara");
t("numeric: over → gt", leaves(r.rule).some((c) => c.field === "loan_amount" && c.operator === "gt" && c.value === "250000") === true);

r = parseInstruction("When a loan is approved and risk grade worse than B, assign to wael");
t("orderedEnum: worse than → worse_than/B",
  leaves(r.rule).some((c) => c.field === "risk_grade" && c.operator === "worse_than" && c.value === "B") === true,
  JSON.stringify(leaves(r.rule)));

/* ---- exit ------------------------------------------------------------------- */
if (failures) {
  console.error(`\n${failures} parser assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll parser assertions passed.");
