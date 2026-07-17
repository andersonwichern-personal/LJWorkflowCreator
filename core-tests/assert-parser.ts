// Rule-core regression coverage retained as a drift guard.
/**
 * Parser honesty suite (hardening plan §2.7) — deterministic eval harness.
 * Run: npx tsx core-tests/assert-parser.ts
 */
import { parseInstruction } from "../src/app/core/nlParser";
import { walkLeaves, WorkflowRule } from "../src/app/core/vocabulary";

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

r = parseInstruction("When a loan is approved or rejected and loan amount over 500k, assign to wael");
t("P2: approved or rejected → multi-trigger rule",
  r.rule?.triggers?.length === 2 &&
    r.rule.triggers.some((t) => t.event === "LOAN APPROVED") &&
    r.rule.triggers.some((t) => t.event === "LOAN REJECTED"),
  JSON.stringify(r.rule?.triggers));

r = parseInstruction("When a loan over 500k is approved or rejected, escalate to the credit committee and add tag jumbo");
t("P2: loan over 500k approved or rejected → multi-trigger rule",
  r.rule?.triggers?.length === 2 &&
    r.rule.triggers.some((t) => t.event === "LOAN APPROVED") &&
    r.rule.triggers.some((t) => t.event === "LOAN REJECTED") &&
    leaves(r.rule).some((c) => c.field === "loan_amount" && c.operator === "gt" && c.value === "500000") &&
    r.rule?.actions.some((a) => a.action === "assign_authority") &&
    r.rule?.actions.some((a) => a.action === "add_tag"),
  JSON.stringify({ triggers: r.rule?.triggers, conditions: leaves(r.rule), actions: r.rule?.actions }));

r = parseInstruction("When a loan is approved, assign to the credit committee");
t("P2: assign to credit committee → authority action",
  r.rule?.actions?.[0]?.action === "assign_authority" &&
    r.rule?.actions?.[0]?.params.value === "Credit Committee",
  JSON.stringify(r.rule?.actions));

r = parseInstruction("When a loan is approved, escalate to authority");
t("P2: escalate to authority → authority action",
  r.rule?.actions?.[0]?.action === "assign_authority" &&
    Object.keys(r.rule?.actions?.[0]?.params ?? {}).length === 0 &&
    r.unresolved.some((slot) => slot.where === "action-param" && slot.param === "value" && slot.heard === "authority"),
  JSON.stringify({ actions: r.rule?.actions, unresolved: r.unresolved }));

r = parseInstruction("When a loan is approved, escalate to the approval authority");
t("P2: escalate to approval authority → authority action",
  r.rule?.actions?.[0]?.action === "assign_authority" &&
    Object.keys(r.rule?.actions?.[0]?.params ?? {}).length === 0 &&
    r.unresolved.some((slot) => slot.where === "action-param" && slot.param === "value" && slot.heard === "authority"),
  JSON.stringify({ actions: r.rule?.actions, unresolved: r.unresolved }));

r = parseInstruction("When a loan is approved, escalate to authority", {
  instanceOptions: { assign_authority: ["Tier 1", "Tier 2"] },
});
t("P2: live authority options drive suggestions",
  r.rule?.actions?.[0]?.action === "assign_authority" &&
    Object.keys(r.rule?.actions?.[0]?.params ?? {}).length === 0 &&
    r.unresolved.some((slot) => slot.where === "action-param" && slot.param === "value" &&
      slot.heard === "authority" && slot.suggestions.includes("Tier 1") && slot.suggestions.includes("Tier 2")),
  JSON.stringify({ actions: r.rule?.actions, unresolved: r.unresolved }));

r = parseInstruction("When a loan is approved, arm this rule and assign to Wael");
t("P2: explicit arm language sets controls to armed",
  r.rule?.controls.mode === "armed" && r.rule?.actions?.[0]?.action === "assign_user",
  JSON.stringify(r.rule?.controls));

r = parseInstruction("When a loan is approved, arm this rule, once per request, and cap 10 fires per hour");
t("P2: explicit control language is parsed",
  r.rule?.controls.mode === "armed" &&
    r.rule?.controls.oncePerRequest === true &&
    r.rule?.controls.maxFiresPerHour === 10,
  JSON.stringify(r.rule?.controls));

r = parseInstruction("When a loan is approved, cap 10/hour");
t("P2: compact rate shorthand is parsed",
  r.rule?.controls.maxFiresPerHour === 10,
  JSON.stringify(r.rule?.controls));

r = parseInstruction("When a loan is approved, one per request");
t("P2: one per request sets dedupe",
  r.rule?.controls.oncePerRequest === true,
  JSON.stringify(r.rule?.controls));

r = parseInstruction("When a loan is approved, per request");
t("P2: bare per request sets dedupe",
  r.rule?.controls.oncePerRequest === true,
  JSON.stringify(r.rule?.controls));

r = parseInstruction("When a loan is approved, remind Sara 5 days before the maturity date");
t("P2: reminder timing becomes delayMinutes",
  r.rule?.actions?.[0]?.delayMinutes === -7200,
  JSON.stringify(r.rule?.actions));

r = parseInstruction("When a loan is approved, notify Sara otherwise add tag clean");
t("P2: otherwise branch becomes else lane",
  r.rule?.actions?.[0]?.action === "notify" &&
    r.rule?.else?.[0]?.action === "add_tag" &&
    r.rule?.else?.[0]?.params.value === "clean",
  JSON.stringify({ actions: r.rule?.actions, else: r.rule?.else }));

r = parseInstruction("When a loan is approved, notify Sara if risk grade is A");
const gatedLeaf = r.rule?.actions?.[0]?.when ? leaves({ schemaVersion: 3, triggers: [], conditions: r.rule.actions[0].when, actions: [], controls: r.rule.controls })[0] : undefined;
t("P2: gated action captures when clause",
  r.rule?.actions?.[0]?.action === "notify" &&
    gatedLeaf?.field === "risk_grade" &&
    gatedLeaf?.operator === "is" &&
    gatedLeaf?.value === "A",
  JSON.stringify(r.rule?.actions));

r = parseInstruction("When a loan is approved, keep it in shadow mode");
t("P2: explicit shadow mode stays shadow",
  r.rule?.controls.mode === "shadow",
  JSON.stringify(r.rule?.controls));

r = parseInstruction("When a loan is approved, switch to live mode");
t("P2: explicit live mode sets armed",
  r.rule?.controls.mode === "armed",
  JSON.stringify(r.rule?.controls));

/* ---- Phase 2: ScopeRef emission + category words ---------------------------- */
r = parseInstruction("When a loan is approved, assign to Wael Hamdan", {
  assignees: ["Wael Hamdan"],
  instanceRegistry: { assign_user: [{ id: "u1", label: "Wael Hamdan" }] },
});
{
  const v = r.rule?.actions[0]?.params.assignee;
  t("P2: registry-resolved assignee → instance ScopeRef",
    typeof v === "object" && v !== null && (v as { level?: string }).level === "instance" &&
      (v as { id?: string }).id === "u1",
    JSON.stringify(v));
}

r = parseInstruction("When a loan is approved, assign to wael");
t("P2: no registry → resolved assignee stays a plain string",
  r.rule?.actions[0]?.params.assignee === "Wael");

r = parseInstruction("When a loan is approved for business customers, notify sara");
{
  const catLeaf = leaves(r.rule).find((c) => c.field === "customer_name");
  t("P2: 'business customers' → customer_name category ref",
    !!catLeaf && typeof catLeaf.value === "object" &&
      (catLeaf.value as { level?: string; category?: string }).level === "category" &&
      (catLeaf.value as { category?: string }).category === "Business",
    JSON.stringify(catLeaf));
}

r = parseInstruction("When any origination request is approved, notify sara");
{
  const catLeaf = leaves(r.rule).find((c) => c.field === "template");
  t("P2: 'any origination request' → template category ref",
    !!catLeaf && (catLeaf.value as { category?: string }).category === "Origination",
    JSON.stringify(catLeaf));
}

/* ---- dual-trigger honesty (Phase 7 review findings — locked regressions) ---- */
r = parseInstruction("When an offer is approved or rejected, notify sam");
t("dual: offer approved/rejected maps onto REAL keys (no OFFER APPROVED)",
  JSON.stringify(r.rule?.triggers.map((x) => x.event)) === JSON.stringify(["OFFER ACCEPTED", "OFFER REJECTED"]));

r = parseInstruction("When a document is accepted or rejected, notify sam");
t("dual: 'accepted' never crosses subjects",
  JSON.stringify(r.rule?.triggers.map((x) => x.event)) === JSON.stringify(["DOCUMENT APPROVED", "DOCUMENT REJECTED"]));

r = parseInstruction("When a loan is approved or rejected and loan amount over 500k and risk grade worse than B, assign to wael");
t("dual: trigger 'or' does not flip AND conditions to OR", r.rule?.conditions.logic === "AND");
t("dual: two triggers still emitted", r.rule?.triggers.length === 2);

r = parseInstruction("when a loan is approved and status is rejected or denied assign to wael");
t("dual: a verb pair inside the condition clause cannot hijack the trigger",
  r.rule?.triggers[0]?.event === "LOAN APPROVED" && r.rule?.triggers.length === 1);

r = parseInstruction("when a loan or document is approved or rejected assign to wael");
t("dual: several subjects → ambiguity question, never a precedence guess",
  r.rule === null && r.ambiguities.length > 0);

/* ---- exit ------------------------------------------------------------------- */
if (failures) {
  console.error(`\n${failures} parser assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll parser assertions passed.");
