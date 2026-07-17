/**
 * Phase 13 four-eyes (maker-checker) suite — which writes need a second pair
 * of eyes, and who is allowed to be that second pair. Database-free: the gate
 * and the approver topology are pure, and the service writes call exactly
 * these helpers.
 * Run: npx tsx scripts/assert-four-eyes.ts
 */
import { proposalPayloadRule, shouldProposeWorkflowWrite } from "../lib/fourEyes";
import { evaluateRequirement } from "../lib/authorityEngine";
import { proposalRequirement } from "../lib/services/workflowProposal";
import { emptyRule, normalizeRule } from "@sweet/rule-core";

let failures = 0;
function t(name: string, condition: boolean, detail?: string) {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${!condition && detail ? ` — ${detail}` : ""}`);
}

const shadowDraft = emptyRule();
const armedRule = { ...emptyRule(), controls: { ...emptyRule().controls, mode: "armed" as const } };
const changedRule = {
  ...shadowDraft,
  conditions: {
    logic: "AND" as const,
    children: [{ field: "bookstatus", operator: "is", value: "Error" }],
  },
};

/* ---- the gate: protected is enabled OR armed -----------------------------
 * Wider than the rule that actually executes (enabled AND armed), on purpose:
 * an enabled shadow rule enforces nothing today but is one toggle away, so it
 * must not be editable solo. Draft freely by leaving the rule disabled. */
t(
  "gate: editing an enabled workflow needs a proposal",
  shouldProposeWorkflowWrite({ currentRule: shadowDraft, currentEnabled: true, nextRule: changedRule })
);
t(
  "gate: editing an armed workflow needs a proposal",
  shouldProposeWorkflowWrite({ currentRule: armedRule, currentEnabled: false, nextRule: changedRule })
);
t(
  "gate: enabling a disabled draft needs a proposal",
  shouldProposeWorkflowWrite({ currentRule: shadowDraft, currentEnabled: false, nextEnabled: true })
);
t(
  "gate: arming a disabled draft needs a proposal",
  shouldProposeWorkflowWrite({ currentRule: shadowDraft, currentEnabled: false, nextRule: armedRule })
);
t(
  "gate: disabling a live rule needs a proposal",
  shouldProposeWorkflowWrite({ currentRule: armedRule, currentEnabled: true, nextEnabled: false })
);

// The escape hatch that keeps the builder usable.
t(
  "gate: editing a disabled shadow draft lands directly",
  !shouldProposeWorkflowWrite({ currentRule: shadowDraft, currentEnabled: false, nextRule: changedRule })
);
t(
  "gate: a metadata-only write lands directly",
  !shouldProposeWorkflowWrite({ currentRule: armedRule, currentEnabled: true })
);

/* ---- the proposal payload ------------------------------------------------- */
t(
  "payload: an edit carries the proposed rule",
  JSON.stringify(proposalPayloadRule(changedRule, normalizeRule(shadowDraft))) ===
    JSON.stringify(normalizeRule(changedRule))
);
t(
  "payload: a status-only change carries the current rule unchanged",
  JSON.stringify(proposalPayloadRule(undefined, normalizeRule(armedRule))) ===
    JSON.stringify(normalizeRule(armedRule))
);

/* ---- maker-checker: the proposer can never be their own checker ----------- */
const req = proposalRequirement("u-anderson");
t("maker-checker: the proposer is not in the approver pool", !JSON.stringify(req).includes("u-anderson"));
t("maker-checker: a peer admin stays eligible", JSON.stringify(req).includes("u-aisha-admin"));

const vote = (approverId: string) =>
  evaluateRequirement(req, {
    decisions: [{ approverId, verdict: "approve" as const }],
    exclusions: ["u-anderson"],
    delegations: [],
  });

t("maker-checker: the proposer's own approval does not satisfy their proposal", !vote("u-anderson").satisfied);
t("maker-checker: a peer admin's approval satisfies the proposal", vote("u-aisha-admin").satisfied);

if (failures) {
  console.error(`\n${failures} four-eyes assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll four-eyes assertions passed.");
