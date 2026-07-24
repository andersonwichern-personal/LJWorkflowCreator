/**
 * Grounding suite (parser AI engine) — deterministic.
 *
 * Pins the frozen parserGrounding exports: stableVocabularyHash is a pure
 * content hash (key order irrelevant, any option/label change flips it), the
 * static snapshot mirrors the vocabulary exports, groundValue walks the
 * exact → duplicate → suggestions → unknown ladder with fuzzy NEVER grounding,
 * and groundRule re-checks every key/entity in a rule — including fabricated
 * instance ids, the else lane, and per-action gates.
 *
 * Run: npx tsx core-tests/assert-parser-grounding.ts
 */
import {
  GroundingVerdict,
  VocabularySnapshot,
  groundRule,
  groundValue,
  stableVocabularyHash,
  staticVocabularySnapshot,
} from "../packages/rule-core/src/parserGrounding";
import { parseInstruction } from "../packages/rule-core/src/nlParser";
import {
  RULE_SCHEMA_VERSION,
  WorkflowRule,
  defaultControls,
} from "../packages/rule-core/src/vocabulary";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

/* ---- Hash determinism ------------------------------------------------------ */

const bodyA: Omit<VocabularySnapshot, "hash"> = {
  events: ["LOAN APPROVED"],
  fields: ["stage", "risk_grade"],
  actions: ["assign_user"],
  operatorsByKind: { enum: ["is", "is_not"], numeric: ["gte"] },
  instanceOptions: { stage: ["Initiated", "Closed"] },
  instanceRegistry: { retailer: [{ id: "r-1", label: "Growmark" }] },
  assignees: ["Wael"],
  source: "test",
  version: "1",
};
// Same content, different key insertion order everywhere it can differ.
const bodyB: Omit<VocabularySnapshot, "hash"> = {
  version: "1",
  source: "test",
  assignees: ["Wael"],
  instanceRegistry: { retailer: [{ label: "Growmark", id: "r-1" }] },
  instanceOptions: { stage: ["Initiated", "Closed"] },
  operatorsByKind: { numeric: ["gte"], enum: ["is", "is_not"] },
  actions: ["assign_user"],
  fields: ["stage", "risk_grade"],
  events: ["LOAN APPROVED"],
};
t("hash: format v-<8 hex>", /^v-[0-9a-f]{8}$/.test(stableVocabularyHash(bodyA)));
t("hash: same content → same hash", stableVocabularyHash(bodyA) === stableVocabularyHash(bodyA));
t("hash: key order irrelevant", stableVocabularyHash(bodyA) === stableVocabularyHash(bodyB));
t(
  "hash: option added → hash changes",
  stableVocabularyHash({
    ...bodyA,
    instanceOptions: { stage: ["Initiated", "Closed", "Reopened"] },
  }) !== stableVocabularyHash(bodyA)
);
t(
  "hash: registry label change → hash changes",
  stableVocabularyHash({
    ...bodyA,
    instanceRegistry: { retailer: [{ id: "r-1", label: "Growmarc" }] },
  }) !== stableVocabularyHash(bodyA)
);
t(
  "hash: registry id change → hash changes",
  stableVocabularyHash({
    ...bodyA,
    instanceRegistry: { retailer: [{ id: "r-2", label: "Growmark" }] },
  }) !== stableVocabularyHash(bodyA)
);

/* ---- Static snapshot ------------------------------------------------------- */

const stat = staticVocabularySnapshot();
t("static: events include LOAN APPROVED", stat.events.includes("LOAN APPROVED"));
t("static: fields include risk_grade", stat.fields.includes("risk_grade"));
t("static: actions include assign_user", stat.actions.includes("assign_user"));
t(
  "static: field options land in instanceOptions",
  JSON.stringify(stat.instanceOptions.risk_grade) === '["A","B","C","D","E"]'
);
t(
  "static: action paramOptions land in instanceOptions",
  stat.instanceOptions.change_stage?.includes("Closed") === true
);
t("static: assignees include Wael", stat.assignees.includes("Wael"));
t("static: numeric operators include gte", stat.operatorsByKind.numeric?.includes("gte") === true);
t("static: no registries (no platform ids to invent)", Object.keys(stat.instanceRegistry).length === 0);
t("static: source/version stamped", stat.source === "static-vocabulary" && stat.version === "static");
const { hash: _statHash, ...statBody } = stat;
t("static: hash self-consistent", stat.hash === stableVocabularyHash(statBody));
t("static: deterministic across calls", staticVocabularySnapshot().hash === stat.hash);

/* ---- groundValue ----------------------------------------------------------- */

t("groundValue: exact option match grounds", (() => {
  const v = groundValue("risk_grade", "B", stat);
  return v.kind === "grounded" && v.canonical === "B" && v.instanceId === undefined;
})());
t("groundValue: case/whitespace-insensitive exact", (() => {
  const v = groundValue("stage", "  closed ", stat);
  return v.kind === "grounded" && v.canonical === "Closed";
})());
t("groundValue: assignee roster backs assign_user", (() => {
  const v = groundValue("assign_user", "wael", stat);
  return v.kind === "grounded" && v.canonical === "Wael";
})());

const withRegistry: VocabularySnapshot = {
  ...stat,
  instanceOptions: { ...stat.instanceOptions, retailer: ["Growmark", "FCS Financial"] },
  instanceRegistry: {
    retailer: [{ id: "r-growmark", label: "Growmark" }],
    assign_user: [
      { id: "u-alex-1", label: "Alex Chen" },
      { id: "u-alex-2", label: "Alex Chen" },
    ],
  },
};
t("groundValue: registry match carries the instance id", (() => {
  const v = groundValue("retailer", "growmark", withRegistry);
  return v.kind === "grounded" && v.canonical === "Growmark" && v.instanceId === "r-growmark";
})());
t("groundValue: duplicate registry labels → duplicate, plain-label candidates", (() => {
  const v = groundValue("assign_user", "Alex Chen", withRegistry);
  return v.kind === "duplicate" && JSON.stringify(v.candidates) === '["Alex Chen","Alex Chen"]';
})());
t("groundValue: near-miss → suggestions (fuzzy NEVER grounds)", (() => {
  const v = groundValue("stage", "Close", stat);
  return v.kind === "suggestions" && v.candidates.includes("Closed");
})());
t("groundValue: registry labels feed suggestions too", (() => {
  const v = groundValue("retailer", "Growmarc", withRegistry);
  return v.kind === "suggestions" && v.candidates.includes("Growmark");
})());
t("groundValue: garbage → unknown", groundValue("stage", "Frobnicated", stat).kind === "unknown");
t("groundValue: empty text → unknown", groundValue("stage", "   ", stat).kind === "unknown");
t(
  "groundValue: pool-less key → unknown, nothing invented",
  groundValue("add_tag", "booking-failed", stat).kind === "unknown"
);

/* ---- groundRule ------------------------------------------------------------ */

function rule(partial: Partial<WorkflowRule>): WorkflowRule {
  return {
    schemaVersion: RULE_SCHEMA_VERSION,
    triggers: [{ event: "LOAN APPROVED" }],
    conditions: { logic: "AND", children: [] },
    actions: [],
    controls: defaultControls(),
    ...partial,
  };
}
const verdictAt = (findings: { path: string; verdict: GroundingVerdict }[], path: string) =>
  findings.find((f) => f.path === path)?.verdict;

// Clean parsed rule: instance registry option resolves to a ScopeRef, and the
// whole result re-grounds with zero findings.
const parseOpts = {
  instanceOptions: { retailer: ["Growmark", "FCS Financial"] },
  instanceRegistry: { retailer: [{ id: "r-growmark", label: "Growmark" }] },
};
const parsed = parseInstruction(
  "When a loan is approved and retailer is Growmark, assign to Wael",
  parseOpts
);
t("groundRule fixture: instruction parsed to a rule", parsed.rule !== null);
t(
  "groundRule fixture: registry upgraded the condition to an instance ScopeRef",
  JSON.stringify(parsed.rule?.conditions.children[0]) ===
    '{"field":"retailer","operator":"is","value":{"level":"instance","id":"r-growmark","label":"Growmark"}}'
);
const cleanSnapshot: VocabularySnapshot = {
  ...stat,
  instanceOptions: { ...stat.instanceOptions, retailer: parseOpts.instanceOptions.retailer },
  instanceRegistry: parseOpts.instanceRegistry,
};
t(
  "groundRule: clean parsed rule grounds with zero findings",
  parsed.rule !== null && groundRule(parsed.rule, cleanSnapshot).findings.length === 0,
  JSON.stringify(parsed.rule && groundRule(parsed.rule, cleanSnapshot).findings)
);

// Unknown trigger event.
t("groundRule: unknown event → finding at triggers[0]", (() => {
  const { findings } = groundRule(rule({ triggers: [{ event: "MARTIAN INVASION" }] }), stat);
  return findings.length === 1 && findings[0].path === "triggers[0]" &&
    findings[0].heard === "MARTIAN INVASION" && findings[0].verdict.kind === "unknown";
})());

// Fabricated instance id in a condition (label real, id never issued).
t("groundRule: fabricated condition ScopeRef id → unknown finding", (() => {
  const { findings } = groundRule(
    rule({
      conditions: {
        logic: "AND",
        children: [
          { field: "retailer", operator: "is", value: { level: "instance", id: "r-999", label: "Growmark" } },
        ],
      },
    }),
    withRegistry
  );
  return findings.length === 1 && findings[0].path === "conditions.leaf[0]" &&
    findings[0].heard === "Growmark" && findings[0].verdict.kind === "unknown";
})());

// Fabricated trigger template scope id.
t("groundRule: fabricated trigger scope id → finding at triggers[0]", (() => {
  const { findings } = groundRule(
    rule({ triggers: [{ event: "LOAN APPROVED", scope: { level: "instance", id: "tpl-999", label: "Ghost Template" } }] }),
    stat
  );
  return findings.length === 1 && findings[0].path === "triggers[0]" && findings[0].verdict.kind === "unknown";
})());

// Unknown assignee in a hand-built rule.
t("groundRule: unknown assignee → unknown finding at actions[0]", (() => {
  const { findings } = groundRule(
    rule({ actions: [{ action: "assign_user", params: { assignee: "Santa Claus" } }] }),
    stat
  );
  const v = verdictAt(findings, "actions[0]");
  return findings.length === 1 && v?.kind === "unknown" && findings[0].heard === "Santa Claus";
})());

// Near-miss condition value → suggestions finding, correct leaf path.
t("groundRule: near-miss enum value → suggestions at conditions.leaf[1]", (() => {
  const { findings } = groundRule(
    rule({
      conditions: {
        logic: "AND",
        children: [
          { field: "uwstatus", operator: "is", value: "Approved" },
          { field: "stage", operator: "is", value: "Close" },
        ],
      },
    }),
    stat
  );
  const v = verdictAt(findings, "conditions.leaf[1]");
  return findings.length === 1 && v?.kind === "suggestions" && v.candidates.includes("Closed");
})());

// Duplicate registry labels surface through groundRule as well.
t("groundRule: duplicate assignee label → duplicate finding", (() => {
  const { findings } = groundRule(
    rule({ actions: [{ action: "assign_user", params: { assignee: "Alex Chen" } }] }),
    withRegistry
  );
  return findings.length === 1 && findings[0].verdict.kind === "duplicate";
})());

// Else lane is walked with its own paths.
t("groundRule: else-lane unknown recipient → finding at else[0]", (() => {
  const { findings } = groundRule(
    rule({
      actions: [{ action: "notify", params: { value: "Sara" } }],
      else: [{ action: "notify", params: { value: "Nobody Real" } }],
    }),
    stat
  );
  return findings.length === 1 && findings[0].path === "else[0]" && findings[0].verdict.kind === "unknown";
})());

// Unknown action key.
t("groundRule: unknown action key → unknown finding", (() => {
  const { findings } = groundRule(rule({ actions: [{ action: "summon_dragon", params: {} }] }), stat);
  return findings.length === 1 && findings[0].path === "actions[0]" &&
    findings[0].heard === "summon_dragon" && findings[0].verdict.kind === "unknown";
})());

// Skips: numeric values, valueless operators, category/any refs, free text.
t("groundRule: numeric + valueless + category + free-text all skipped", (() => {
  const { findings } = groundRule(
    rule({
      conditions: {
        logic: "AND",
        children: [
          { field: "loan_amount", operator: "gte", value: "250000" },
          { field: "tags", operator: "is_empty", value: "" },
          { field: "template", operator: "is", value: { level: "category", category: "Covenant" } },
          { field: "loan_purpose", operator: "contains", value: "equipment" },
        ],
      },
      actions: [{ action: "add_tag", params: { value: "priority" } }],
    }),
    stat
  );
  return findings.length === 0;
})());

// Unknown attribute field key is itself a finding.
t("groundRule: unknown condition field key → unknown finding", (() => {
  const { findings } = groundRule(
    rule({ conditions: { logic: "AND", children: [{ field: "shoe_size", operator: "is", value: "42" }] } }),
    stat
  );
  return findings.length === 1 && findings[0].heard === "shoe_size" && findings[0].verdict.kind === "unknown";
})());

// Per-action gates are grounded on the action's path.
t("groundRule: per-action gate near-miss → finding at actions[0].when", (() => {
  const { findings } = groundRule(
    rule({
      actions: [
        {
          action: "notify",
          params: { value: "Sara" },
          when: { logic: "AND", children: [{ field: "stage", operator: "is", value: "Finnished" }] },
        },
      ],
    }),
    stat
  );
  return findings.length === 1 && findings[0].path === "actions[0].when";
})());

/* --------------------------------------------------------------------------- */

if (failures > 0) {
  console.error(`\n✗ assert-parser-grounding: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\n✓ parser grounding contract holds — exact grounds, fuzzy only suggests, fabricated ids die.");
