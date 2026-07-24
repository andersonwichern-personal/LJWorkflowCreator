/**
 * assert-brain-consultant — the consultant's contracts: exact deterministic
 * patches (proposals), evidence-backed analyzers (recommendations), and the
 * structured, stale-safe consultant turn (consultant).
 *
 * Fixtures are built through the REAL deterministic parser (parseInstruction)
 * plus makeEnvelope, so these assertions pin the integrated behavior — not a
 * hand-mocked shadow of it.
 *
 * Run: npx tsx core-tests/assert-brain-consultant.ts
 */
import { parseInstruction, ParseResult } from "../packages/rule-core/src/nlParser";
import { makeEnvelope, ParseEnvelope } from "../packages/rule-core/src/parserProvenance";
import { validateRule } from "../packages/rule-core/src/ruleValidation";
import {
  MAX_DELAY_MINUTES,
  WorkflowRule,
  defaultControls,
  RULE_SCHEMA_VERSION,
} from "../packages/rule-core/src/vocabulary";
import {
  applyRulePatch,
  describePatch,
  patchTouches,
  RulePatchOp,
} from "../packages/workflow-brain/src/proposals";
import {
  AnalyzerInput,
  ConsultantFact,
  Recommendation,
  deriveFacts,
  deriveRecommendations,
} from "../packages/workflow-brain/src/recommendations";
import {
  acceptRecommendation,
  planConsultantTurn,
  rejectRecommendation,
} from "../packages/workflow-brain/src/consultant";
import { BrainContextSnapshot, RelatedWorkflowSummary } from "../packages/workflow-brain/src/context";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function snap(overrides: Partial<BrainContextSnapshot> = {}): BrainContextSnapshot {
  return {
    snapshotId: "snap-1",
    profile: "standalone-demo",
    identity: { tenantKey: "tenant-a" },
    vocabularyHash: "vh-1",
    instanceOptions: {},
    instanceRegistry: {},
    assignees: ["Wael", "Sara"],
    entities: [
      {
        registry: "customers",
        id: "cust-42",
        label: "ZAPHOD-BEEBLEBROX-HOLDINGS",
        confidence: "verified",
        privacy: "customer-data",
      },
    ],
    relatedWorkflows: [],
    allowedActionKeys: [],
    sources: [
      { source: "static-vocabulary", fetchedAt: 1721772000000, version: "vocab-v1" },
      { source: "workflows/templates", fetchedAt: 1721772000000, version: "tpl-v9" },
    ],
    budget: { maxBytes: 65536, usedBytes: 1024, truncated: [] },
    privacyCeiling: "customer-data",
    ...overrides,
  };
}

function baseResult(rule: WorkflowRule | null): ParseResult {
  return { rule, notes: [], unresolved: [], uncovered: [], ambiguities: [] };
}

const conditioned = parseInstruction(
  "when a loan is approved and the loan amount is at least 250000, assign to Wael"
);
const conditionedRule = conditioned.rule as WorkflowRule;
t("fixture: conditioned parse landed", conditionedRule !== null && conditioned.unresolved.length === 0);

const broad = parseInstruction("when a request is created, notify Sara");
const broadRule = broad.rule as WorkflowRule;
t("fixture: broad parse landed", broadRule !== null && broadRule.conditions.children.length === 0);

const unresolvedParse = parseInstruction("when a loan is approved, assign to Santa Claus");
t("fixture: unresolved parse has the slot", unresolvedParse.unresolved.length === 1);

/* -------------------------------------------------------------------------- */
/* applyRulePatch — happy paths per op                                        */
/* -------------------------------------------------------------------------- */

{
  const out = applyRulePatch(conditionedRule, [{ op: "add-trigger", event: "SYSTEM ERROR" }]);
  t("add-trigger appends a known event", out.ok && out.rule.triggers.length === 2 && out.rule.triggers[1].event === "SYSTEM ERROR");
  t("applyRulePatch never mutates its input", conditionedRule.triggers.length === 1);
}
{
  const two = applyRulePatch(conditionedRule, [{ op: "add-trigger", event: "SYSTEM ERROR" }]);
  const out = two.ok ? applyRulePatch(two.rule, [{ op: "remove-trigger", index: 1 }]) : two;
  t("remove-trigger removes by index", out.ok && out.rule.triggers.length === 1);
}
{
  const out = applyRulePatch(conditionedRule, [{ op: "set-trigger", index: 0, event: "LOAN REJECTED" }]);
  t("set-trigger swaps the event", out.ok && out.rule.triggers[0].event === "LOAN REJECTED");
}
{
  const out = applyRulePatch(conditionedRule, [
    { op: "add-condition", path: [], leaf: { field: "risk_grade", operator: "is", value: "A" } },
  ]);
  t("add-condition appends to the root group", out.ok && out.rule.conditions.children.length === 2);
}
{
  const out = applyRulePatch(conditionedRule, [
    { op: "update-condition", path: [0], leaf: { field: "loan_amount", operator: "gte", value: "500000" } },
  ]);
  t(
    "update-condition replaces the leaf",
    out.ok && (out.rule.conditions.children[0] as { value: unknown }).value === "500000"
  );
}
{
  const out = applyRulePatch(conditionedRule, [{ op: "remove-condition", path: [0] }]);
  t("remove-condition removes the leaf", out.ok && out.rule.conditions.children.length === 0);
}
{
  const out = applyRulePatch(conditionedRule, [{ op: "set-logic", path: [], logic: "OR" }]);
  t("set-logic flips the root group", out.ok && out.rule.conditions.logic === "OR");
}
{
  const out = applyRulePatch(conditionedRule, [
    { op: "add-action", lane: "then", output: { action: "notify", params: { value: "Sara" } }, index: 0 },
  ]);
  t("add-action inserts at the requested index", out.ok && out.rule.actions.length === 2 && out.rule.actions[0].action === "notify");
}
{
  const out = applyRulePatch(conditionedRule, [
    { op: "add-action", lane: "else", output: { action: "add_tag", params: { value: "did-not-qualify" } } },
    { op: "update-action", lane: "else", index: 0, output: { action: "add_tag", params: { value: "below-threshold" } } },
  ]);
  t(
    "add-action creates the else lane; update-action edits it in the same program",
    out.ok && out.rule.else?.length === 1 && String(out.rule.else[0].params.value) === "below-threshold"
  );
  const removed = out.ok ? applyRulePatch(out.rule, [{ op: "remove-action", lane: "else", index: 0 }]) : out;
  t("remove-action dropping the last else action removes the lane stub", removed.ok && removed.rule.else === undefined);
}
{
  const out = applyRulePatch(conditionedRule, [{ op: "remove-action", lane: "then", index: 0 }]);
  t("remove-action on a shadow rule may empty the then lane", out.ok && out.rule.actions.length === 0);
}
{
  const out = applyRulePatch(conditionedRule, [{ op: "set-delay", lane: "then", index: 0, delayMinutes: 120 }]);
  t("set-delay writes the bounded delay", out.ok && out.rule.actions[0].delayMinutes === 120);
  const cleared = out.ok ? applyRulePatch(out.rule, [{ op: "set-delay", lane: "then", index: 0, delayMinutes: null }]) : out;
  t("set-delay null clears the delay entirely", cleared.ok && cleared.rule.actions[0].delayMinutes === undefined);
}
{
  const out = applyRulePatch(conditionedRule, [
    { op: "set-control", key: "maxFiresPerHour", value: 10 },
    { op: "set-control", key: "oncePerRequest", value: false },
    { op: "set-control", key: "missingData", value: "alert" },
    { op: "set-control", key: "priority", value: 50 },
    { op: "set-control", key: "mode", value: "shadow" },
  ]);
  t(
    "set-control accepts every non-arming control",
    out.ok &&
      out.rule.controls.maxFiresPerHour === 10 &&
      out.rule.controls.oncePerRequest === false &&
      out.rule.controls.missingData === "alert" &&
      out.rule.controls.priority === 50 &&
      out.rule.controls.mode === "shadow"
  );
}

/* -------------------------------------------------------------------------- */
/* applyRulePatch — refusals                                                  */
/* -------------------------------------------------------------------------- */

{
  const out = applyRulePatch(conditionedRule, [{ op: "add-trigger", event: "LOAN TELEPORTED" }]);
  t("unknown event on add-trigger refused", !out.ok && out.reason.includes("unknown trigger event"));
}
{
  const out = applyRulePatch(conditionedRule, [{ op: "set-trigger", index: 4, event: "SYSTEM ERROR" }]);
  t("set-trigger out-of-range refused", !out.ok);
}
{
  const out = applyRulePatch(conditionedRule, [{ op: "remove-trigger", index: 0 }]);
  t("removing the last trigger refused", !out.ok && out.reason.includes("at least one trigger"));
}
{
  const out = applyRulePatch(conditionedRule, [
    { op: "add-condition", path: [0], leaf: { field: "risk_grade", operator: "is", value: "A" } },
  ]);
  t("add-condition onto a leaf path refused", !out.ok && out.reason.includes("not a group"));
}
{
  const out = applyRulePatch(conditionedRule, [
    { op: "update-condition", path: [], leaf: { field: "risk_grade", operator: "is", value: "A" } },
  ]);
  t("update-condition on the root refused", !out.ok && out.reason.includes("not a leaf"));
}
{
  const out = applyRulePatch(conditionedRule, [{ op: "remove-condition", path: [5] }]);
  t("remove-condition unknown path refused", !out.ok);
}
{
  const out = applyRulePatch(conditionedRule, [
    { op: "add-action", lane: "then", output: { action: "teleport_loan", params: {} } },
  ]);
  t("unknown action key refused", !out.ok && out.reason.includes("unknown action"));
}
{
  const armed = clone(conditionedRule);
  armed.controls.mode = "armed";
  const out = applyRulePatch(armed, [{ op: "remove-action", lane: "then", index: 0 }]);
  t("removing the last action of an armed rule refused", !out.ok && out.reason.includes("NO_ACTIONS_WHEN_ARMED"));
}
{
  const out = applyRulePatch(conditionedRule, [
    { op: "set-delay", lane: "then", index: 0, delayMinutes: MAX_DELAY_MINUTES + 1 },
  ]);
  t("set-delay beyond MAX_DELAY_MINUTES refused", !out.ok && out.reason.includes("maximum"));
}
{
  const out = applyRulePatch(conditionedRule, [{ op: "set-control", key: "mode", value: "armed" }]);
  t(
    "set-control mode armed refused outright",
    !out.ok && out.reason.includes("arming is an activation decision made through the existing controls, not a consultant patch")
  );
}
{
  const out = applyRulePatch(conditionedRule, [{ op: "set-control", key: "maxFiresPerHour", value: 0 }]);
  t("rate cap below 1 refused", !out.ok);
}
{
  const before = JSON.stringify(conditionedRule);
  const out = applyRulePatch(conditionedRule, [
    { op: "set-logic", path: [], logic: "OR" },
    { op: "add-trigger", event: "LOAN TELEPORTED" },
  ]);
  t("all-or-nothing: second op invalid fails the whole patch", !out.ok && out.reason.startsWith("op 2"));
  t("all-or-nothing: input rule byte-identical after refusal", JSON.stringify(conditionedRule) === before);
}
{
  const withRef = clone(conditionedRule);
  withRef.actions[0].params.assignee = { level: "instance", id: "user-9", label: "Wael" };
  const out = applyRulePatch(withRef, [{ op: "set-delay", lane: "then", index: 0, delayMinutes: 60 }]);
  const ref = out.ok ? (out.rule.actions[0].params.assignee as { level?: string; id?: string }) : {};
  t("ScopeRef param survives a patch structurally untouched", out.ok && ref.level === "instance" && ref.id === "user-9");
}

/* -------------------------------------------------------------------------- */
/* describePatch + patchTouches                                               */
/* -------------------------------------------------------------------------- */

{
  const ops: RulePatchOp[] = [
    { op: "add-condition", path: [], leaf: { field: "loan_amount", operator: "gte", value: "250000" } },
    { op: "set-delay", lane: "then", index: 0, delayMinutes: null },
    { op: "set-control", key: "maxFiresPerHour", value: 10 },
  ];
  const a = describePatch(ops);
  const b = describePatch(ops);
  t("describePatch is deterministic", a === b && a.length > 0);
  t(
    "describePatch reads from the ops, not from AI text",
    a ===
      'add condition "loan amount is at least 250000" to the root group; clear the written delay on action #1; set control maxFiresPerHour to 10'
  );
  t(
    "patchTouches uses the existing path conventions",
    eq(patchTouches(ops), ["conditions", "actions[0].delayMinutes", "controls.maxFiresPerHour"])
  );
  t(
    "patchTouches nested condition + trigger paths",
    eq(
      patchTouches([
        { op: "add-trigger", event: "SYSTEM ERROR" },
        { op: "update-condition", path: [1, 0], leaf: { field: "stage", operator: "is", value: "Processing" } },
      ]),
      ["triggers", "conditions.children[1].children[0]"]
    )
  );
}

/* -------------------------------------------------------------------------- */
/* Analyzers — facts + recommendations per fixture                            */
/* -------------------------------------------------------------------------- */

const allFixtures: Array<{ name: string; input: AnalyzerInput; facts: ConsultantFact[]; recs: Recommendation[] }> = [];

function analyze(name: string, input: AnalyzerInput) {
  const facts = deriveFacts(input);
  const recs = deriveRecommendations(input, facts);
  allFixtures.push({ name, input, facts, recs });
  return { facts, recs };
}

/* Conditioned rule without an else lane. */
const fxConditioned = analyze("conditioned", {
  rule: conditionedRule,
  envelope: makeEnvelope(conditioned, {}),
  snapshot: snap(),
  ruleVersion: 1,
});
{
  const fact = fxConditioned.facts.find((f) => f.kind === "missing-alternate-path");
  const rec = fxConditioned.recs.find((r) => r.type === "missing-alternate-path");
  t("conditioned rule without else → missing-alternate-path fact", fact !== undefined && fact.rulePaths.includes("else"));
  t("missing-alternate-path rec cites the fact and carries NO patch", rec !== undefined && rec.patch === undefined && rec.evidence.includes(fact?.id ?? "?"));
  t("naming fact + rec issued when a rule exists", fxConditioned.recs.some((r) => r.type === "naming"));
}

/* Contradiction riding the envelope. */
const contradictionFinding = {
  paths: ["conditions.leaf[0]"],
  clauseIds: ["cl-a"],
  kind: "empty-numeric-range" as const,
  message: "loan amount is required to be at least 500000 and at most 100000 — no request satisfies both.",
};
const fxContradiction = analyze("contradiction", {
  rule: conditionedRule,
  envelope: makeEnvelope(conditioned, { contradictions: [contradictionFinding] }),
  snapshot: snap(),
  ruleVersion: 1,
});
{
  const rec = fxContradiction.recs.find((r) => r.type === "contradiction");
  const fact = fxContradiction.facts.find((f) => f.kind === "contradiction");
  t("contradiction envelope → contradiction rec citing the finding", rec !== undefined && fact !== undefined && rec.evidence.includes(fact.id));
  t("contradiction rec is ranked first and high risk", fxContradiction.recs[0].type === "contradiction" && rec?.riskLevel === "high");
  t("contradiction rec carries the finding's clause ids", eq(rec?.clauseIds, ["cl-a"]));
}

/* Delay rule → unsupported-timing (R11). */
const delayedRule = clone(conditionedRule);
delayedRule.actions[0].delayMinutes = 2880;
const fxDelay = analyze("delay", {
  rule: delayedRule,
  envelope: makeEnvelope(baseResult(delayedRule), {}),
  snapshot: snap(),
  ruleVersion: 1,
});
{
  const rec = fxDelay.recs.find((r) => r.type === "unsupported-timing");
  t("delayMinutes → unsupported-timing rec, riskLevel high, changesBehavior false", rec?.riskLevel === "high" && rec?.changesBehavior === false);
  t(
    "unsupported-timing rec offers the exact set-delay-null patch",
    eq(rec?.patch, [{ op: "set-delay", lane: "then", index: 0, delayMinutes: null }])
  );
  t(
    "unsupported-timing fact carries the R11 truth verbatim",
    fxDelay.facts.some((f) => f.kind === "unsupported-timing" && f.message.includes("persisted but not executed by the current runtime"))
  );
}

/* Per-action `when` gate → unsupported-timing without a patch. */
const gatedRule = clone(conditionedRule);
gatedRule.actions[0].when = { logic: "AND", children: [{ field: "stage", operator: "is", value: "Processing" }] };
const fxGated = analyze("gated", {
  rule: gatedRule,
  envelope: makeEnvelope(baseResult(gatedRule), {}),
  snapshot: snap(),
  ruleVersion: 1,
});
{
  const rec = fxGated.recs.find((r) => r.type === "unsupported-timing");
  t("`when` gate → unsupported-timing rec with NO patch (no op can remove a gate)", rec !== undefined && rec.patch === undefined);
}

/* Related workflow overlap → duplicate-workflow naming the sibling. */
const sibling: RelatedWorkflowSummary = {
  id: "wf-77",
  name: "Large loan escalation",
  enabled: true,
  events: ["LOAN APPROVED"],
  conditionFields: ["loan_amount"],
  actions: ["assign_user"],
};
const fxDuplicate = analyze("duplicate", {
  rule: conditionedRule,
  envelope: makeEnvelope(conditioned, {}),
  snapshot: snap({ relatedWorkflows: [sibling] }),
  ruleVersion: 1,
});
{
  const rec = fxDuplicate.recs.find((r) => r.type === "duplicate-workflow");
  t("relatedWorkflows overlap → duplicate-workflow rec", rec !== undefined);
  t(
    "duplicate rec names the sibling workflow (name + id)",
    (rec?.rationale.includes("Large loan escalation") ?? false) && (rec?.rationale.includes("wf-77") ?? false)
  );
}

/* Broad rule on a high-volume event → broad-match + rate-protection + unconfirmed. */
const fxBroad = analyze("broad", {
  rule: broadRule,
  envelope: makeEnvelope(broad, {}),
  snapshot: snap(),
  ruleVersion: 1,
});
{
  const rec = fxBroad.recs.find((r) => r.type === "broad-match");
  t("broad rule on REQUEST CREATED → broad-match rec, medium risk, changesBehavior", rec?.riskLevel === "medium" && rec?.changesBehavior === true);
  t(
    "broad-match patch adds the grounded customer-type scoping condition",
    eq(rec?.patch, [
      { op: "add-condition", path: [], leaf: { field: "custtype", operator: "is", value: "Business" } },
    ])
  );
  t("broad rule at default cap → rate-protection rec (no patch, never arms)", fxBroad.recs.some((r) => r.type === "rate-protection" && r.patch === undefined));
  t("unconfirmed trigger → unconfirmed-vocabulary rec naming the token", fxBroad.recs.some((r) => r.type === "unconfirmed-vocabulary" && r.rationale.includes("REQUEST CREATED")));
}

/* Unresolved entity → question-shaped rec, no patch, no double-report. */
const fxUnresolved = analyze("unresolved", {
  rule: unresolvedParse.rule,
  envelope: makeEnvelope(unresolvedParse, {
    clauseLinks: [{ clauseId: "cl-u", rulePaths: ["actions[0]"], status: "unresolved" }],
  }),
  snapshot: snap(),
  ruleVersion: 1,
});
{
  const rec = fxUnresolved.recs.find((r) => r.type === "unresolved-entity");
  t("unresolved slot → unresolved-entity rec without a patch", rec !== undefined && rec.patch === undefined && rec.riskLevel === "high");
  t("unresolved rec carries the blocked clause id", eq(rec?.clauseIds, ["cl-u"]));
  t("no missing-param double-report for a slot the parser already flagged", !fxUnresolved.facts.some((f) => f.kind === "missing-param"));
}

/* Empty param with no unresolved slot → missing-param. */
const emptyParamRule: WorkflowRule = {
  schemaVersion: RULE_SCHEMA_VERSION,
  triggers: [{ event: "LOAN APPROVED" }],
  conditions: { logic: "AND", children: [] },
  actions: [{ action: "notify", params: {} }],
  controls: defaultControls(),
};
const fxMissingParam = analyze("missing-param", {
  rule: emptyParamRule,
  envelope: makeEnvelope(baseResult(emptyParamRule), {}),
  snapshot: snap(),
  ruleVersion: 1,
});
{
  const rec = fxMissingParam.recs.find((r) => r.type === "missing-param");
  t("empty action param → missing-param rec, no patch (never invent recipients)", rec !== undefined && rec.patch === undefined);
}

/* "unless"/"except" clause → inverted-condition-risk (grammar reads it as positive). */
const invertedText = "when a loan is approved, assign to Wael unless the risk grade is E";
const invertedParse = parseInstruction(invertedText);
const fxInverted = analyze("inverted-sourceText", {
  rule: invertedParse.rule,
  envelope: makeEnvelope(invertedParse, {}),
  snapshot: snap(),
  ruleVersion: 1,
  sourceText: invertedText,
});
{
  const fact = fxInverted.facts.find((f) => f.kind === "inverted-condition-risk");
  const rec = fxInverted.recs.find((r) => r.type === "inverted-condition-risk");
  t(
    '"unless" in the description → inverted-condition-risk fact + HIGH-risk rec, no patch',
    fact?.source === "parse" &&
      rec !== undefined &&
      rec.riskLevel === "high" &&
      rec.changesBehavior === false &&
      rec.patch === undefined &&
      rec.rationale.includes("verify the condition direction before trusting this rule")
  );
  const invertedTurn = planConsultantTurn({
    rule: invertedParse.rule,
    envelope: makeEnvelope(invertedParse, {}),
    snapshot: snap(),
    ruleVersion: 1,
    sourceText: invertedText,
    requiresApproval: false,
  });
  t(
    "inverted-condition watchout leads the turn's watchouts",
    invertedTurn.watchouts.length > 0 && invertedTurn.watchouts[0].includes("verify the condition direction")
  );
}
{
  const clauseEnvelope = makeEnvelope(baseResult(conditionedRule), {
    clauses: [
      {
        id: "cl-x",
        span: { start: 0, end: 24 },
        rawSpan: { start: 0, end: 24 },
        text: "except covenant requests",
        kind: "condition",
        material: true,
      },
    ] as ParseEnvelope["clauses"],
  });
  const fx = analyze("inverted-clauses", {
    rule: conditionedRule,
    envelope: clauseEnvelope,
    snapshot: snap(),
    ruleVersion: 1,
  });
  const fact = fx.facts.find((f) => f.kind === "inverted-condition-risk");
  t('"except" clause via clauses[] → fact bound to the clause id', fact !== undefined && eq(fact.clauseIds, ["cl-x"]));
  t(
    "no inverted-condition finding without unless/except anywhere",
    !fxConditioned.facts.some((f) => f.kind === "inverted-condition-risk") &&
      !fxConditioned.recs.some((r) => r.type === "inverted-condition-risk")
  );
}

/* Combined fixture — ranking across tiers, twice for stability. */
const rankedBase = parseInstruction("when a request is created, notify Santa Claus");
const rankedRule = clone(rankedBase.rule as WorkflowRule);
rankedRule.actions[0].delayMinutes = 1440;
const rankedInput: AnalyzerInput = {
  rule: rankedRule,
  envelope: makeEnvelope({ ...rankedBase, rule: rankedRule }, { contradictions: [contradictionFinding] }),
  snapshot: snap({
    relatedWorkflows: [
      { id: "wf-9", name: "Intake notifier", enabled: true, events: ["REQUEST CREATED"], conditionFields: [], actions: ["notify"] },
    ],
  }),
  ruleVersion: 1,
};
const fxRanked = analyze("ranked", rankedInput);
{
  const order = fxRanked.recs.map((r) => r.type);
  const tierOf: Record<string, number> = {
    contradiction: 0,
    "unresolved-entity": 0,
    "unsupported-timing": 1,
    "duplicate-workflow": 2,
    "broad-match": 3,
  };
  const tiers = order.map((type) => tierOf[type] ?? 4);
  t("ranking: blocking-adjacent first, advisory last", tiers.every((tier, i) => i === 0 || tier >= tiers[i - 1]));
  t(
    "ranking covers the whole spread in this fixture",
    order.includes("contradiction") && order.includes("unresolved-entity") && order.includes("unsupported-timing") && order.includes("duplicate-workflow") && order.includes("broad-match")
  );
  const again = deriveRecommendations(rankedInput, deriveFacts(rankedInput));
  t("ranked order is stable across derivations", eq(fxRanked.recs.map((r) => r.id), again.map((r) => r.id)));
  t("re-derivation over unchanged inputs re-issues identical ids (rejection stickiness)", eq(fxRanked.recs, again));
}

/* Cross-fixture invariants. */
{
  const allowedTypes = new Set([
    "missing-alternate-path",
    "unresolved-entity",
    "broad-match",
    "contradiction",
    "missing-param",
    "unsupported-timing",
    "unconfirmed-vocabulary",
    "no-simulation-coverage",
    "duplicate-workflow",
    "naming",
    "rate-protection",
    "inverted-condition-risk",
  ]);
  let evidenceOk = true;
  let typesOk = true;
  let citesOk = true;
  for (const fx of allFixtures) {
    const factIds = new Set(fx.facts.map((f) => f.id));
    for (const rec of fx.recs) {
      if (rec.evidence.length === 0) citesOk = false;
      if (!rec.evidence.every((id) => factIds.has(id))) evidenceOk = false;
      if (!allowedTypes.has(rec.type)) typesOk = false;
    }
  }
  t("every recommendation cites at least one fact (all fixtures)", citesOk);
  t("every cited evidence id resolves to a real fact (all fixtures)", evidenceOk);
  t("no recommendation type outside the contract union (all fixtures)", typesOk);
}

/* -------------------------------------------------------------------------- */
/* planConsultantTurn                                                         */
/* -------------------------------------------------------------------------- */

/* Rule-null envelope with three clarifications. */
const gapResult: ParseResult = {
  rule: null,
  notes: [],
  unresolved: [{ where: "action-param", actionIndex: 0, param: "assignee", heard: "santa claus", suggestions: ["Sara"] }],
  uncovered: ["send them a fruit basket"],
  ambiguities: [{ question: "Which event should this workflow react to?", options: ["LOAN APPROVED", "LOAN REJECTED"] }],
};
const gapEnvelope: ParseEnvelope = makeEnvelope(gapResult, {
  clauseLinks: [
    { clauseId: "cl-1", rulePaths: [], status: "ambiguous" },
    { clauseId: "cl-2", rulePaths: [], status: "unresolved" },
    { clauseId: "cl-3", rulePaths: [], status: "uncovered" },
  ],
});
const gapTurn = planConsultantTurn({ rule: null, envelope: gapEnvelope, snapshot: snap(), ruleVersion: 0, requiresApproval: false });
{
  t("turn asks AT MOST 2 questions", gapTurn.questions.length === 2);
  t("ambiguity question leads on priority ties (it re-reads the whole description)", gapTurn.questions[0].question === gapResult.ambiguities[0].question);
  t("questions carry the blocked clause ids from the envelope", eq(gapTurn.questions[0].blocksClauses, ["cl-1"]));
  t("question options are the parser's grounded options, not invented ones", eq(gapTurn.questions[0].options, ["LOAN APPROVED", "LOAN REJECTED"]));
  t("nextBestAction is singular and matches the top blocker", gapTurn.nextBestAction === `Answer the question: ${gapTurn.questions[0].question}`);
  t(
    "understanding for a rule-null envelope never claims a rule exists",
    !gapTurn.understanding.startsWith("For ") && gapTurn.understanding.includes("No workflow rule is drafted yet")
  );
  t("no suggestedName without a rule", gapTurn.suggestedName === undefined);
  t("canApply is false without a rule", gapTurn.canApply === false);
  t("contextUsed carries only source/version pairs", gapTurn.contextUsed.every((c) => eq(Object.keys(c).sort(), ["source", "version"])) && gapTurn.contextUsed.length === 2);
  t("no tenant entity label leaks anywhere in the turn", !JSON.stringify(gapTurn).includes("ZAPHOD"));
}

const delayTurn = planConsultantTurn({ ...fxDelay.recs.length ? {} : {}, rule: delayedRule, envelope: makeEnvelope(baseResult(delayedRule), {}), snapshot: snap(), ruleVersion: 1, requiresApproval: true });
{
  t("watchouts surface the unexecuted-timing truth", delayTurn.watchouts.some((w) => w.includes("persisted but not executed by the current runtime")));
  const change = delayTurn.proposedChanges.find((c) => c.ops[0]?.op === "set-delay");
  t("proposedChanges preview is exactly describePatch(ops)", change !== undefined && change.preview === describePatch(change.ops));
  t("proposed change cites a recommendation on this turn", delayTurn.recommendations.some((r) => r.id === change?.recommendationId));
  t("canApply true: rule valid and every proposal applies", delayTurn.canApply === true);
  t("requiresApproval passes through from the host policy", delayTurn.requiresApproval === true);
  t("no questions → nextBestAction points at the top actionable recommendation", delayTurn.nextBestAction.startsWith("Review the recommendation"));
  t("no arming or activation advice anywhere in the turn", !/\barm\b|\barming\b|activate/i.test(JSON.stringify(delayTurn.recommendations.map((r) => [r.title, r.expectedEffect]))));
}

const cleanTurn = planConsultantTurn({ rule: conditionedRule, envelope: makeEnvelope(conditioned, {}), snapshot: snap(), ruleVersion: 1, requiresApproval: false });
{
  t("clean rule with only advisory recs → nextBestAction is simulate", cleanTurn.nextBestAction.startsWith("Simulate this rule"));
  t("understanding for a clean rule is the interpretRule reading", cleanTurn.understanding.startsWith("For approved loans"));
  t("suggestedName derived deterministically from the interpretation", cleanTurn.suggestedName !== undefined && cleanTurn.suggestedName.startsWith("Approved loans"));
  t("real tradeoff (assign without notify) → exactly one alternative", cleanTurn.alternatives.length === 1 && cleanTurn.alternatives[0].title.includes("Notify"));
  t("turn facts are the analyzer facts (no invented ones)", eq(cleanTurn.facts, deriveFacts({ rule: conditionedRule, envelope: makeEnvelope(conditioned, {}), snapshot: snap(), ruleVersion: 1 })));
}
{
  const broadTurn = planConsultantTurn({ rule: broadRule, envelope: makeEnvelope(broad, {}), snapshot: snap(), ruleVersion: 1, requiresApproval: false });
  t("no alternative offered when no real tradeoff exists (notify already present)", broadTurn.alternatives.length === 0);
  const turnAgain = planConsultantTurn({ rule: broadRule, envelope: makeEnvelope(broad, {}), snapshot: snap(), ruleVersion: 1, requiresApproval: false });
  t("planConsultantTurn is fully deterministic (byte-equal turns)", eq(broadTurn, turnAgain));
}

/* -------------------------------------------------------------------------- */
/* Accept / reject                                                            */
/* -------------------------------------------------------------------------- */

const delayRec = fxDelay.recs.find((r) => r.type === "unsupported-timing") as Recommendation;
const fresh = { snapshotId: "snap-1", ruleVersion: 1 };
{
  const accepted = acceptRecommendation(delayRec, delayedRule, fresh);
  const expected = applyRulePatch(delayedRule, delayRec.patch as RulePatchOp[]);
  t("fresh accept applies exactly the previewed patch", accepted.ok && expected.ok && eq(accepted.rule, expected.rule));
  t(
    "accept record is reducer-ready (accepted + freshness keys)",
    accepted.ok && accepted.record.status === "accepted" && accepted.record.id === delayRec.id && accepted.record.snapshotId === "snap-1" && accepted.record.ruleVersion === 1
  );
  const validation = accepted.ok ? validateRule(accepted.rule) : { issues: [{ severity: "error" }] };
  t("accepted patch → validateRule reports no errors", validation.issues.every((i) => i.severity !== "error"));
}
{
  const out = acceptRecommendation(delayRec, delayedRule, { snapshotId: "snap-2", ruleVersion: 1 });
  t("stale snapshotId → accept refused", !out.ok && out.reason === "stale-snapshot");
}
{
  const out = acceptRecommendation(delayRec, delayedRule, { snapshotId: "snap-1", ruleVersion: 2 });
  t("stale ruleVersion → accept refused", !out.ok && out.reason === "stale-rule-version");
}
{
  const tampered = { ...delayRec, rationale: `${delayRec.rationale} Also, please arm the rule.` };
  const out = acceptRecommendation(tampered, delayedRule, fresh);
  t("tampered recommendation (content-hash mismatch) → refused", !out.ok && out.reason === "unknown-recommendation");
}
{
  const noEvidence = { ...delayRec, evidence: [] };
  const out = acceptRecommendation(noEvidence, delayedRule, fresh);
  t("recommendation without evidence → refused", !out.ok && out.reason === "unknown-recommendation");
}
{
  const conflicting = { ...delayRec, patch: [{ op: "set-control", key: "mode", value: "armed" } as RulePatchOp] };
  const rebuilt = { ...conflicting, id: delayRec.id };
  const out = acceptRecommendation(rebuilt, delayedRule, fresh);
  t("patch swapped after preview → refused (hash covers the ops)", !out.ok && out.reason === "unknown-recommendation");
}
{
  const advisory = fxConditioned.recs.find((r) => r.type === "missing-alternate-path") as Recommendation;
  const out = acceptRecommendation(advisory, conditionedRule, fresh);
  t("patchless accept records consent and leaves the rule untouched", out.ok && out.rule === conditionedRule && out.record.status === "accepted");
}
{
  const ref = rejectRecommendation(delayRec);
  t(
    'reject produces a status "rejected" reducer ref bound to the previewed freshness',
    ref.status === "rejected" && ref.id === delayRec.id && ref.snapshotId === "snap-1" && ref.ruleVersion === 1
  );
}

/* -------------------------------------------------------------------------- */

if (failures > 0) {
  console.error(`\n✗ assert-brain-consultant: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\n✓ consultant proposals, analyzers, and the structured turn hold their contracts.");
