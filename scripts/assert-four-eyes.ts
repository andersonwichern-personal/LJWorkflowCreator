export {};

// Phase 13 — maker-checker workflow proposal contract. Database-free coverage
// for the same pure interception predicate and approval requirement builder the
// API/service paths use.

import { requiresProposal } from "../lib/fourEyes";
import { evaluateRequirement } from "../lib/authorityEngine";
import { proposalRequirement } from "../lib/services/workflowProposal";
import { emptyRule } from "../lib/vocabulary";

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

t(
  "intercept: editing an enabled armed workflow creates a proposal",
  requiresProposal({
    enabled: true,
    ruleJson: armedRule,
  }, {
    ruleJson: changedRule,
  })
);
t(
  "intercept: editing a disabled armed workflow can save directly",
  !requiresProposal({
    enabled: false,
    ruleJson: armedRule,
  }, {
    ruleJson: changedRule,
  })
);
t(
  "intercept: enabling an armed draft creates a proposal",
  requiresProposal({
    enabled: false,
    ruleJson: armedRule,
  }, {
    enabled: true,
  })
);
t(
  "intercept: switching an enabled draft rule to armed creates a proposal",
  requiresProposal({
    enabled: true,
    ruleJson: shadowDraft,
  }, {
    ruleJson: armedRule,
  })
);
t(
  "intercept: editing a disabled shadow draft can save directly",
  !requiresProposal({
    enabled: false,
    ruleJson: shadowDraft,
  }, {
    ruleJson: changedRule,
  })
);
t(
  "intercept: metadata-only updates can save directly",
  !requiresProposal({
    enabled: true,
    ruleJson: armedRule,
  }, {
  })
);

const req = proposalRequirement("u-anderson");
t("maker-checker: proposer is excluded from proposal approvers", !JSON.stringify(req).includes("u-anderson"));
t("maker-checker: peer admin remains eligible", JSON.stringify(req).includes("u-aisha-admin"));

const proposerVote = evaluateRequirement(req, {
  decisions: [{ approverId: "u-anderson", verdict: "approve" }],
  exclusions: ["u-anderson"],
  delegations: [],
});
t("maker-checker: proposer vote does not satisfy approval", !proposerVote.satisfied);

const peerVote = evaluateRequirement(req, {
  decisions: [{ approverId: "u-aisha-admin", verdict: "approve" }],
  exclusions: ["u-anderson"],
  delegations: [],
});
t("maker-checker: peer admin approval satisfies proposal", peerVote.satisfied);

if (failures) {
  console.error(`\n${failures} four-eyes assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll four-eyes assertions passed.");
