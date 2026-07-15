/**
 * ApprovalRequirement contract suite (Phase 3 §5.5) — quorum math,
 * sequential gates, maker-checker exclusions, delegation substitution, and
 * legacy userIds normalization. Run: npx tsx scripts/assert-requirement.ts
 */
import {
  decideAuthority,
  evaluateRequirement,
  normalizeRequirement,
  type ApprovalRequirement,
  type ApprovalVerdict,
  type ApproverRef,
  type AuthorityLevel,
  type DecisionContext,
  type RequirementStatus,
} from "../lib/authorityEngine";

type Approver = ApproverRef;
type Verdict = ApprovalVerdict;

let failures = 0;
function t(name: string, condition: boolean, detail?: string) {
  if (!condition) failures++;
  console.log(
    `${condition ? "PASS" : "FAIL"} ${name}${!condition && detail ? ` — ${detail}` : ""}`
  );
}

const approver = (id: string, label: string): Approver => ({ id, label });
const wael = approver("u-wael", "Wael");
const sara = approver("u-sara", "Sara");
const mohammed = approver("u-mohammed", "Mohammed");
const aisha = approver("u-aisha", "Aisha");
const omar = approver("u-omar", "Omar");
const committee = [wael, sara, mohammed, aisha, omar];

const decision = (approverId: string, verdict: Verdict) => ({ approverId, verdict });
const ids = (status: RequirementStatus) => status.outstanding.map((a) => a.id).sort();

function evaluate(
  requirement: ApprovalRequirement,
  decisions: DecisionContext["decisions"] = [],
  exclusions: string[] = [],
  delegations: DecisionContext["delegations"] = []
) {
  return evaluateRequirement(requirement, { decisions, exclusions, delegations });
}

/* ---- 2-of-5 quorum ---------------------------------------------------------- */
const twoOfFive: ApprovalRequirement = { type: "n_of", approvers: committee, count: 2 };

const oneDecline = evaluate(twoOfFive, [decision(omar.id, "decline")]);
t("2-of-5: one decline does not satisfy", oneDecline.satisfied === false);
t("2-of-5: one decline leaves quorum viable", oneDecline.declined === false);
t(
  "2-of-5: one decline leaves four voters outstanding",
  ids(oneDecline).join(",") === [aisha.id, mohammed.id, sara.id, wael.id].sort().join(","),
  JSON.stringify(oneDecline)
);

const quorumMet = evaluate(twoOfFive, [
  decision(wael.id, "approve"),
  decision(sara.id, "approve"),
  decision(omar.id, "decline"),
]);
t("2-of-5: two approvals satisfy despite one decline", quorumMet.satisfied === true);
t("2-of-5: a satisfied quorum is not declined", quorumMet.declined === false);

const quorumLost = evaluate(twoOfFive, [
  decision(sara.id, "decline"),
  decision(mohammed.id, "decline"),
  decision(aisha.id, "decline"),
  decision(omar.id, "decline"),
]);
t("2-of-5: four declines cannot satisfy", quorumLost.satisfied === false);
t("2-of-5: four declines make quorum impossible", quorumLost.declined === true);

/* ---- all_of and maker-checker exclusions ----------------------------------- */
const allReviewers: ApprovalRequirement = {
  type: "all_of",
  approvers: [omar, wael, sara],
};

const makerExcluded = evaluate(allReviewers, [], [omar.id]);
t("all_of: excluded maker is not outstanding", !ids(makerExcluded).includes(omar.id));
t(
  "all_of: only eligible checkers remain outstanding",
  ids(makerExcluded).join(",") === [sara.id, wael.id].sort().join(",")
);

const makerVoteIgnored = evaluate(
  allReviewers,
  [decision(omar.id, "approve"), decision(wael.id, "approve")],
  [omar.id]
);
t("maker-checker: excluded maker approval never counts", makerVoteIgnored.satisfied === false);
t("maker-checker: missing checker remains outstanding", ids(makerVoteIgnored)[0] === sara.id);

const checkerApprovals = evaluate(
  allReviewers,
  [decision(wael.id, "approve"), decision(sara.id, "approve")],
  [omar.id]
);
t("all_of: every non-excluded checker satisfies", checkerApprovals.satisfied === true);

const soleMaker: ApprovalRequirement = { type: "any_of", approvers: [omar] };
const deadlocked = evaluate(soleMaker, [], [omar.id]);
t("maker-checker: excluded sole approver is not satisfied", deadlocked.satisfied === false);
t("maker-checker: engine does not invent eligibility", deadlocked.outstanding.length === 0);

/* ---- strict sequence gating ------------------------------------------------- */
const officerThenCommittee: ApprovalRequirement = {
  type: "sequence",
  steps: [
    { type: "any_of", approvers: [wael] },
    { type: "n_of", approvers: [sara, mohammed, aisha], count: 2 },
  ],
};

const sequenceStart = evaluate(officerThenCommittee);
t("sequence: starts at the officer step", sequenceStart.step === 0);
t("sequence: only first-step approver is outstanding", ids(sequenceStart).join(",") === wael.id);

const prematureCommitteeVotes = evaluate(officerThenCommittee, [
  decision(sara.id, "approve"),
  decision(mohammed.id, "approve"),
]);
t("sequence: later approvals cannot bypass first step", prematureCommitteeVotes.satisfied === false);
t("sequence: later approvals do not advance the gate", prematureCommitteeVotes.step === 0);
t("sequence: current officer remains outstanding", ids(prematureCommitteeVotes)[0] === wael.id);

const prematureCommitteeDecline = evaluate(officerThenCommittee, [
  decision(sara.id, "decline"),
]);
t("sequence: later-step decline is ignored while step 0 is open", prematureCommitteeDecline.declined === false);

const committeeOpen = evaluate(officerThenCommittee, [decision(wael.id, "approve")]);
t("sequence: officer approval opens committee step", committeeOpen.step === 1);
t(
  "sequence: committee members become outstanding",
  ids(committeeOpen).join(",") === [aisha.id, mohammed.id, sara.id].sort().join(",")
);

const oneCommitteeApproval = evaluate(officerThenCommittee, [
  decision(wael.id, "approve"),
  decision(sara.id, "approve"),
]);
t("sequence: one committee approval is not enough", oneCommitteeApproval.satisfied === false);
t("sequence: remains on committee step", oneCommitteeApproval.step === 1);

const sequenceSatisfied = evaluate(officerThenCommittee, [
  decision(wael.id, "approve"),
  decision(sara.id, "approve"),
  decision(mohammed.id, "approve"),
]);
t("sequence: officer then 2 committee approvals satisfies", sequenceSatisfied.satisfied === true);

const firstStepDeclined = evaluate(officerThenCommittee, [decision(wael.id, "decline")]);
t("sequence: current-step decline declines the sequence", firstStepDeclined.declined === true);
t("sequence: declined sequence remains on current step", firstStepDeclined.step === 0);

/* ---- active delegation substitution ---------------------------------------- */
const delegatedRequirement: ApprovalRequirement = { type: "any_of", approvers: [wael] };
const delegation = [{ fromId: wael.id, toId: sara.id }];
const delegatedOpen = evaluate(delegatedRequirement, [], [], delegation);
t("delegation: delegate replaces original outstanding approver", ids(delegatedOpen)[0] === sara.id);
t("delegation: original approver is no longer outstanding", !ids(delegatedOpen).includes(wael.id));
t(
  "delegation: delegate approval satisfies original requirement",
  evaluate(delegatedRequirement, [decision(sara.id, "approve")], [], delegation).satisfied === true
);
t(
  "delegation: original approval does not bypass substitution",
  evaluate(delegatedRequirement, [decision(wael.id, "approve")], [], delegation).satisfied === false
);

/* ---- legacy userIds normalization ------------------------------------------ */
const legacy = normalizeRequirement(["Wael", "Sara"]);
t("legacy userIds: normalizes to any_of", legacy.type === "any_of");
t(
  "legacy userIds: labels are preserved with unresolved ids",
  legacy.type === "any_of" &&
    JSON.stringify(legacy.approvers) ===
      JSON.stringify([
        { id: "", label: "Wael" },
        { id: "", label: "Sara" },
      ]),
  JSON.stringify(legacy)
);

/* ---- authority decision integration --------------------------------------- */
const committeeAuthority: AuthorityLevel = {
  id: "auth-committee",
  name: "Credit Committee",
  limit: 1_000_000,
  riskGrade: "C",
  product: "All",
  userIds: [],
  requirement: twoOfFive,
  escalationId: null,
  autoApprove: false,
};
const committeeDecision = decideAuthority(
  { amount: 500_000, riskGrade: "B", product: "Term Loan" },
  [committeeAuthority]
);
t(
  "decideAuthority: configured topology is returned",
  committeeDecision.requirement?.type === "n_of" && committeeDecision.requirement.count === 2
);
t(
  "decideAuthority: audit reason names the quorum",
  committeeDecision.reason.includes("2 of"),
  committeeDecision.reason
);

const legacyAuthority: AuthorityLevel = {
  ...committeeAuthority,
  id: "auth-legacy",
  name: "Legacy Officers",
  userIds: ["Wael", "Sara"],
  requirement: null,
};
const legacyDecision = decideAuthority(
  { amount: 100_000, riskGrade: "A", product: "Term Loan" },
  [legacyAuthority]
);
t("decideAuthority: legacy userIds still become any_of", legacyDecision.requirement?.type === "any_of");
t(
  "decideAuthority: legacy labels survive normalization",
  legacyDecision.requirement?.type === "any_of" &&
    legacyDecision.requirement.approvers.map((a) => a.label).join(",") === "Wael,Sara"
);

if (failures) {
  console.error(`\n${failures} requirement assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll requirement assertions passed.");
