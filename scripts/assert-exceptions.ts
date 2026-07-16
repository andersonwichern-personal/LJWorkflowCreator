export {};

// Phase 12 — tolerance bands, delegation substitution, and break-glass audit
// payloads. Kept database-free: service/route writes are covered by using the
// same pure engine and payload helpers they call.

import {
  decideAuthority,
  evaluateRequirement,
  type ApprovalRequirement,
  type AuthorityLevel,
} from "../lib/authorityEngine";
import { buildBreakGlassAudit, normalizeBreakGlassInput } from "../lib/breakGlass";
import { EXECUTION_STATUSES } from "../lib/services/execution";

let failures = 0;
function t(name: string, condition: boolean, detail?: string) {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${!condition && detail ? ` — ${detail}` : ""}`);
}

const officer: AuthorityLevel = {
  id: "auth-officer",
  name: "Loan Officer",
  limit: 100_000,
  riskGrade: "C",
  product: "Term Loan",
  userIds: [],
  requirement: {
    type: "any_of",
    approvers: [
      { id: "u-wael", label: "Wael" },
      { id: "u-sara", label: "Sara" },
      { id: "u-aisha", label: "Aisha" },
    ],
  },
  escalationId: "auth-committee",
  autoApprove: false,
  overageTolerancePercent: 10,
  overageToleranceAmount: 5_000,
};

const committee: AuthorityLevel = {
  id: "auth-committee",
  name: "Credit Committee",
  limit: 500_000,
  riskGrade: "D",
  product: "Term Loan",
  userIds: ["Committee"],
  requirement: { type: "any_of", approvers: [{ id: "u-committee", label: "Committee" }] },
  escalationId: null,
  autoApprove: false,
};

const coSign = decideAuthority(
  { amount: 113_000, riskGrade: "B", product: "Term Loan" },
  [officer, committee]
);
t("tolerance: marginal overage uses co-sign lane", coSign.lane === "co-sign", coSign.reason);
t("tolerance: marginal overage stays on original authority", coSign.authority?.id === officer.id);
t(
  "tolerance: co-sign requirement asks for two peer signatures",
  coSign.requirement?.type === "n_of" && coSign.requirement.count === 2,
  JSON.stringify(coSign.requirement)
);

const escalated = decideAuthority(
  { amount: 116_000, riskGrade: "B", product: "Term Loan" },
  [officer, committee]
);
t("tolerance: amount beyond tolerance does not use co-sign", escalated.lane !== "co-sign", escalated.reason);

const delegatedRequirement: ApprovalRequirement = {
  type: "any_of",
  approvers: [{ id: "u-wael", label: "Wael" }],
};
const delegated = evaluateRequirement(delegatedRequirement, {
  decisions: [{ approverId: "u-sara", verdict: "approve" }],
  exclusions: [],
  delegations: [{ fromId: "u-wael", toId: "u-sara" }],
});
t("delegation: delegate approval satisfies original approver seat", delegated.satisfied);

const originalAfterDelegation = evaluateRequirement(delegatedRequirement, {
  decisions: [{ approverId: "u-wael", verdict: "approve" }],
  exclusions: [],
  delegations: [{ fromId: "u-wael", toId: "u-sara" }],
});
t("delegation: original approver no longer satisfies after substitution", !originalAfterDelegation.satisfied);

t("break-glass: OVERRIDDEN is an allowed execution status", EXECUTION_STATUSES.includes("OVERRIDDEN"));
try {
  normalizeBreakGlassInput({ requestId: "REQ-1", reason: "   " });
  t("break-glass: reason is mandatory", false, "blank reason was accepted");
} catch (error) {
  t("break-glass: reason is mandatory", error instanceof Error && /reason/i.test(error.message));
}

const input = normalizeBreakGlassInput({
  requestId: "REQ-4815",
  requestName: "Two Rivers Orchard",
  reason: "Emergency continuity approval by incident commander",
  actorId: "u-admin-2",
});
const audit = buildBreakGlassAudit(input, 3);
t("break-glass: audit status is OVERRIDDEN", audit.status === "OVERRIDDEN");
t("break-glass: audit event names the override", audit.eventName === "BREAK_GLASS_OVERRIDE");
t("break-glass: audit trace carries reason and task count", JSON.stringify(audit.trace).includes("tasksOverridden") && JSON.stringify(audit.trace).includes(input.reason));
t("break-glass: dispatched action records override detail", JSON.stringify(audit.actions).includes("break_glass"));

if (failures) {
  console.error(`\n${failures} exception assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll exception assertions passed.");
