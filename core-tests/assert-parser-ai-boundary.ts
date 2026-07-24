/**
 * assert-parser-ai-boundary — the hostile-candidate review pipeline
 * (packages/workflow-brain/src/candidateNormalization.ts).
 *
 * Doctrine under test: MODEL OUTPUT IS UNTRUSTED INPUT. Every numbered step of the
 * reviewCandidate pipeline gets direct coverage — structural gate, bounds/sanitation,
 * weaker-than-deterministic, normalize + disarm, vocabulary allowlists, entity
 * re-grounding, URL safety, injected clause coverage, validator/linter, side-car
 * merging — plus a self-review sweep over adversarial fixtures proving the pipeline
 * never mangles honest deterministic results (accepted with repairs []).
 *
 * Coverage semantics are exercised twice: through stubs injected via the frozen
 * CandidateReviewInput `coverage` fn (deterministic step coverage), and through the
 * REAL rule-core parserCoverage.clauseCoverage (which landed mid-wave) wired as that
 * same injected fn — omission surfaces, fabrication kills, honesty passes clean.
 *
 * Run: npx tsx core-tests/assert-parser-ai-boundary.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  reviewCandidate,
  vocabFromContext,
} from "../packages/workflow-brain/src/candidateNormalization";
import type {
  CandidateReviewInput,
  CandidateVerdict,
} from "../packages/workflow-brain/src/candidateNormalization";
import type { BrainContextSnapshot } from "../packages/workflow-brain/src/context";
import { parseInstruction } from "../packages/rule-core/src/nlParser";
import type { ParseOptions, ParseResult } from "../packages/rule-core/src/nlParser";
import { segmentInstruction } from "../packages/rule-core/src/parserClauses";
import { clauseCoverage } from "../packages/rule-core/src/parserCoverage";
import type { WorkflowRule } from "../packages/rule-core/src/vocabulary";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

/* -------------------------------------------------------------------------- */
/* Harness fixtures                                                           */
/* -------------------------------------------------------------------------- */

function makeSnapshot(overrides: Partial<BrainContextSnapshot> = {}): BrainContextSnapshot {
  return {
    snapshotId: "snap-test",
    profile: "standalone-demo",
    identity: { tenantKey: "tenant-test" },
    vocabularyHash: "hash-test",
    instanceOptions: {},
    instanceRegistry: {},
    assignees: [],
    entities: [],
    relatedWorkflows: [],
    allowedActionKeys: [],
    sources: [],
    budget: { maxBytes: 4096, usedBytes: 0, truncated: [] },
    privacyCeiling: "public-vocabulary",
    ...overrides,
  };
}

const REGISTRY = { assign_user: [{ id: "u-1", label: "Wael" }] };
const vocab = vocabFromContext(makeSnapshot({ instanceRegistry: REGISTRY }));
const baseOptions: ParseOptions = { instanceRegistry: REGISTRY };
const SOURCE = "When a loan is approved, assign to Wael";
const det = parseInstruction(SOURCE, baseOptions);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Canonical JSON (sorted keys) for order-insensitive structural equality. */
function canon(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((k) => record[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canon(record[k])}`)
    .join(",")}}`;
}

function review(candidate: unknown, extra: Partial<CandidateReviewInput> = {}): CandidateVerdict {
  return reviewCandidate({
    candidate,
    sourceText: SOURCE,
    vocab,
    baseOptions,
    deterministic: det,
    ...extra,
  });
}

/** Minimal honest envelope around a rule. */
function env(rule: unknown, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return { rule, notes: [], unresolved: [], uncovered: [], ambiguities: [], ...extras };
}

function mkRule(overrides: Partial<WorkflowRule> = {}): WorkflowRule {
  return {
    schemaVersion: 3,
    triggers: [{ event: "LOAN APPROVED" }],
    conditions: { logic: "AND", children: [] },
    actions: [{ action: "assign_user", params: {} }],
    controls: {
      mode: "shadow",
      oncePerRequest: true,
      maxFiresPerHour: 25,
      missingData: "no_match",
      priority: 100,
    },
    ...overrides,
  };
}

function accepted(v: CandidateVerdict): v is Extract<CandidateVerdict, { accepted: true }> {
  return v.accepted;
}
function rejected(v: CandidateVerdict): v is Extract<CandidateVerdict, { accepted: false }> {
  return !v.accepted;
}

t(
  "fixture: deterministic parse resolves Wael to the registry id",
  det.rule !== null &&
    canon(det.rule.actions[0].params.assignee) ===
      canon({ level: "instance", id: "u-1", label: "Wael" }),
);

/* ========================================================================== */
/* Step 1 — string input                                                      */
/* ========================================================================== */

let v = review(clone(det));
t("1: valid structured payload accepted", accepted(v));
t(
  "1: acceptance is byte-honest — repairs []",
  accepted(v) && v.repairs.length === 0,
  JSON.stringify(accepted(v) ? v.repairs : v),
);
t(
  "1: honest rule passes through structurally unchanged",
  accepted(v) && canon(v.result.rule) === canon(det.rule),
);

v = review("```json\n" + JSON.stringify(det) + "\n```");
t("1: fenced-JSON string accepted", accepted(v));
t(
  '1: fence strip recorded as "parsed-fenced-json"',
  accepted(v) && v.repairs.includes("parsed-fenced-json"),
);
t(
  "1: fenced payload rule matches the structured one",
  accepted(v) && canon(v.result.rule) === canon(det.rule),
);

v = review("```json\n{definitely not json");
t(
  "1: malformed JSON → structural reject",
  rejected(v) && v.structural && v.reason === "unparseable-json",
  JSON.stringify(v),
);

/* ========================================================================== */
/* Step 2 — shape gate + unknown keys                                         */
/* ========================================================================== */

t(
  "2: number candidate → structural not-an-object",
  rejected((v = review(42))) && v.structural && v.reason === "not-an-object",
);
t(
  "2: array candidate → structural not-an-object",
  rejected((v = review([env(null)]))) && v.structural && v.reason === "not-an-object",
);
t(
  "2: missing rule key → structural",
  rejected((v = review({ notes: [], unresolved: [], uncovered: [], ambiguities: [] }))) &&
    v.structural &&
    v.reason === "invalid-shape:rule",
);
t(
  "2: rule as array → structural",
  rejected((v = review(env([])))) && v.structural && v.reason === "invalid-shape:rule",
);
t(
  "2: missing ambiguities array → structural",
  rejected((v = review({ rule: null, notes: [], unresolved: [], uncovered: [] }))) &&
    v.structural &&
    v.reason === "invalid-shape:ambiguities",
);
t(
  '2: wrong-typed notes ("x") → structural',
  rejected((v = review({ ...env(null), notes: "x" }))) &&
    v.structural &&
    v.reason === "invalid-shape:notes",
);

v = review({ ...clone(det), evil_extra: "payload", tool_calls: [{ name: "arm" }] });
t(
  "2: unknown top-level keys → accepted with drop repair",
  accepted(v) && v.repairs.includes("dropped-unknown-keys"),
);
t(
  "2: dropped keys absent from the result",
  accepted(v) && !("evil_extra" in v.result) && !("tool_calls" in v.result),
);

v = review({ ...clone(det), provenance: { engine: "deterministic", parserVersion: "fake" } });
t(
  "2: candidate may not author engine sidecars (provenance dropped)",
  accepted(v) && v.repairs.includes("dropped-engine-sidecars") && !("provenance" in v.result),
);

/* ========================================================================== */
/* Step 3 — bounds + sanitation                                               */
/* ========================================================================== */

v = review(env(clone(det.rule), { notes: Array.from({ length: 25 }, (_, i) => `note ${i}`) }));
t("3: oversized notes clamped to 20", accepted(v) && v.result.notes.length === 20);
t("3: clamp recorded", accepted(v) && v.repairs.includes("clamped-bounds"));

v = review(env(clone(det.rule), { notes: ["x".repeat(1000)] }));
t("3: overlong note clamped to 400 chars", accepted(v) && v.result.notes[0].length === 400);

v = review(env(clone(det.rule), { notes: ["IN\u200bJECT\u0007"] }));
t(
  '3: ZWSP/control canary "IN\\u200bJECT\\u0007" cleaned to "INJECT"',
  accepted(v) && v.result.notes[0] === "INJECT",
  JSON.stringify(accepted(v) ? v.result.notes : v),
);
t("3: sanitation recorded", accepted(v) && v.repairs.includes("sanitized-strings"));

v = review(
  env(clone(det.rule), {
    unresolved: [42, { where: "nope" }, { where: "action-param", heard: "x", suggestions: [] }],
  }),
);
t(
  "3: malformed unresolved entries dropped, valid one kept",
  accepted(v) &&
    v.result.unresolved.length === 1 &&
    v.repairs.includes("dropped-malformed-entries"),
);

const twelveAmb = Array.from({ length: 12 }, (_, i) => ({
  question: `q${i}`,
  options: Array.from({ length: 12 }, (_, j) => `opt${j}`),
}));
v = review(env(clone(det.rule), { ambiguities: twelveAmb }));
t(
  "3: ambiguities clamped to 10 with options clamped to 10",
  accepted(v) &&
    v.result.ambiguities.length === 10 &&
    v.result.ambiguities[0].options.length === 10,
);

v = review(
  env(mkRule({ actions: [{ action: "add_tag", params: { value: "x".repeat(120_000) } }] })),
);
t(
  "3: rule JSON > 100k chars → structural rule-too-large",
  rejected(v) && v.structural && v.reason === "rule-too-large",
);

/* ========================================================================== */
/* Step 4 — weaker than deterministic / honest null                           */
/* ========================================================================== */

v = review(env(null));
t(
  "4: candidate null while deterministic has a rule → non-structural reject",
  rejected(v) && !v.structural && v.reason === "candidate-weaker-than-deterministic",
);

const detNull = parseInstruction("qqqq zzzz flibber");
t("4: fixture — gibberish deterministic parse is rule-null", detNull.rule === null);
v = review(env(null, { notes: ["I cannot help with that"] }), { deterministic: detNull });
t(
  "4: honest-null model refusal accepted when det is also null",
  accepted(v) && v.result.rule === null && v.result.notes[0] === "I cannot help with that",
);

/* ========================================================================== */
/* Step 5 — normalize + controls hardening                                    */
/* ========================================================================== */

v = review(
  env(
    mkRule({
      conditions: {
        // Model drift: lowercase logic. normalizeRule alone would flip "or" → AND.
        logic: "or" as never,
        children: [
          { field: "uwstatus", operator: "is", value: "Approved" },
          { field: "loan_amount", operator: "gte", value: "250000" },
        ],
      },
    }),
  ),
);
t(
  '5: lowercase logic "or" normalized to OR (not silently flipped to AND)',
  accepted(v) && v.result.rule?.conditions.logic === "OR",
  JSON.stringify(accepted(v) ? v.result.rule?.conditions : v),
);
t("5: normalization recorded", accepted(v) && v.repairs.includes("normalized-rule-shape"));

v = review(env(mkRule({ triggers: [{ key: "LOAN APPROVED" } as never] })));
t(
  "5: donor-era {key} trigger wrapper is NOT re-implemented — fails closed via validation",
  rejected(v) && !v.structural && v.reason === "invalid-rule:EMPTY_TRIGGERS",
  JSON.stringify(v),
);

const armedRule = clone(det.rule) as WorkflowRule;
armedRule.controls.mode = "armed";
v = review(env(armedRule));
t(
  "5/11: armed candidate is disarmed — mode forced back to shadow",
  accepted(v) && v.result.rule?.controls.mode === "shadow",
);
t(
  '5/11: disarm recorded as "disarmed-model-output"',
  accepted(v) && v.repairs.includes("disarmed-model-output"),
);

/* ========================================================================== */
/* Step 6 — allowlist (fail closed)                                           */
/* ========================================================================== */

v = review(env(mkRule({ triggers: [{ event: "MOON PHASE" }] })));
t(
  "6: unknown event → non-structural reject naming the key",
  rejected(v) && !v.structural && v.reason === "unknown-event:MOON PHASE",
  JSON.stringify(v),
);

v = review(
  env(
    mkRule({
      conditions: {
        logic: "AND",
        children: [{ field: "astro_sign", operator: "is", value: "Leo" }],
      },
    }),
  ),
);
t(
  "6: unknown condition field → reject naming the key",
  rejected(v) && !v.structural && v.reason === "unknown-field:astro_sign",
);

v = review(
  env(
    mkRule({
      conditions: {
        logic: "AND",
        children: [{ field: "loan_amount", operator: "contains", value: "250" }],
      },
    }),
  ),
);
t(
  "6: operator invalid for the field kind → reject naming the operator",
  rejected(v) && !v.structural && v.reason === "invalid-operator:contains",
);

v = review(env(mkRule({ actions: [{ action: "launch_missiles", params: {} }] })));
t(
  "6: unknown action → reject naming the key",
  rejected(v) && !v.structural && v.reason === "unknown-action:launch_missiles",
);

/* ========================================================================== */
/* Step 7 — entity re-grounding                                               */
/* ========================================================================== */

v = review(
  env(mkRule({ actions: [{ action: "assign_user", params: { assignee: "Frank Sinatra" } }] })),
);
t(
  "7: fabricated assignee converted to an unresolved slot",
  accepted(v) &&
    v.result.unresolved.some(
      (s) =>
        s.where === "action-param" && s.heard === "Frank Sinatra" && Array.isArray(s.suggestions),
    ),
);
t(
  "7: fabricated assignee param blanked (params {})",
  accepted(v) && Object.keys(v.result.rule?.actions[0].params ?? { x: 1 }).length === 0,
);
t(
  '7: conversion recorded as "unresolved-ungrounded-entity"',
  accepted(v) && v.repairs.includes("unresolved-ungrounded-entity"),
);
t(
  "7: nothing fabricated survives in the rule",
  accepted(v) && !JSON.stringify(v.result.rule).includes("Sinatra"),
);

v = review(env(mkRule({ actions: [{ action: "assign_user", params: { assignee: "Waell" } }] })));
t(
  '7: near-miss "Waell" gets fuzzy suggestions including Wael',
  accepted(v) && v.result.unresolved.some((s) => s.suggestions.includes("Wael")),
  JSON.stringify(accepted(v) ? v.result.unresolved : v),
);

v = review(
  env(
    mkRule({
      actions: [
        {
          action: "assign_user",
          params: { assignee: { level: "instance", id: "u-999", label: "Wael" } },
        },
      ],
    }),
  ),
);
t(
  "7: fabricated instance id with a real label re-grounds to the registry id u-1",
  accepted(v) &&
    canon(v.result.rule?.actions[0].params.assignee) ===
      canon({ level: "instance", id: "u-1", label: "Wael" }),
  JSON.stringify(accepted(v) ? v.result.rule?.actions[0] : v),
);
t(
  '7: id swap recorded as "regrounded-instance-id"',
  accepted(v) && v.repairs.includes("regrounded-instance-id"),
);

v = review(
  env(
    mkRule({
      actions: [
        {
          action: "assign_user",
          params: { assignee: { level: "instance", id: "u-999", label: "Nobody Real" } },
        },
      ],
    }),
  ),
);
t(
  "7: instance ref with unknown id AND label blanked to an unresolved slot",
  accepted(v) &&
    Object.keys(v.result.rule?.actions[0].params ?? { x: 1 }).length === 0 &&
    v.result.unresolved.some((s) => s.heard === "Nobody Real"),
);
t(
  '7: blanking recorded as "blanked-fabricated-instance-id"',
  accepted(v) && v.repairs.includes("blanked-fabricated-instance-id"),
);

const dupVocab = vocabFromContext(
  makeSnapshot({
    instanceRegistry: {
      assign_user: [
        { id: "u-1", label: "Wael" },
        { id: "u-7", label: "Wael" },
      ],
    },
  }),
);
v = review(env(mkRule({ actions: [{ action: "assign_user", params: { assignee: "Wael" } }] })), {
  vocab: dupVocab,
});
t(
  "7: duplicate registry label converted to an ambiguity question",
  accepted(v) && v.result.ambiguities.some((a) => a.question.includes("Wael")),
  JSON.stringify(accepted(v) ? v.result.ambiguities : v),
);
t(
  "7: duplicate-label param blanked, never silently picked",
  accepted(v) && Object.keys(v.result.rule?.actions[0].params ?? { x: 1 }).length === 0,
);
t(
  '7: conversion recorded as "ambiguated-duplicate-label"',
  accepted(v) && v.repairs.includes("ambiguated-duplicate-label"),
);

/* ========================================================================== */
/* Step 8 — URL safety                                                        */
/* ========================================================================== */

function webhookRule(url: string): WorkflowRule {
  return mkRule({ actions: [{ action: "send_webhook", params: { value: url } }] });
}

v = review(env(webhookRule("http://169.254.169.254/latest/meta-data")));
t(
  "8: http:// URL param converted to an unresolved slot",
  accepted(v) &&
    v.result.unresolved.some((s) => s.heard.includes("169.254.169.254")) &&
    Object.keys(v.result.rule?.actions[0].params ?? { x: 1 }).length === 0,
);
t(
  '8: conversion recorded as "unsafe-url-param"',
  accepted(v) && v.repairs.includes("unsafe-url-param"),
);

v = review(env(webhookRule("https://169.254.169.254/latest")));
t(
  "8: https to an IP literal (SSRF metadata endpoint) rejected as a param",
  accepted(v) &&
    v.repairs.includes("unsafe-url-param") &&
    !JSON.stringify(v.result.rule).includes("169.254.169.254"),
);

v = review(env(webhookRule("javascript:alert(1)")));
t(
  "8: javascript: URI converted to an unresolved slot",
  accepted(v) && v.repairs.includes("unsafe-url-param"),
);

v = review(env(webhookRule("https://localhost/hook")));
t("8: https://localhost blocked", accepted(v) && v.repairs.includes("unsafe-url-param"));

v = review(env(webhookRule("https://metadata.internal/x")));
t("8: *.internal hostname blocked", accepted(v) && v.repairs.includes("unsafe-url-param"));

v = review(env(webhookRule("//evil.example/x")));
t("8: protocol-relative URL blocked", accepted(v) && v.repairs.includes("unsafe-url-param"));

v = review(env(webhookRule("https://hooks.example.com/hook")));
t(
  "8: well-formed public https URL passes untouched",
  accepted(v) && v.result.rule?.actions[0].params.value === "https://hooks.example.com/hook",
);
t(
  "8: safe URL leaves no repairs",
  accepted(v) && v.repairs.length === 0,
  JSON.stringify(accepted(v) ? v.repairs : v),
);

/* ========================================================================== */
/* Step 9 — semantic coverage (injected fn)                                   */
/* ========================================================================== */

const clauses = segmentInstruction(SOURCE).clauses;
t("9: fixture — source segments into clauses", clauses.length > 0);

v = review(clone(det), {
  clauses,
  coverage: () => ({ materialUnaccounted: [], fabricated: ["actions[1]"] }),
});
t(
  "9: fabricated component → zero-tolerance non-structural reject",
  rejected(v) && !v.structural && v.reason === "fabricated-component",
  JSON.stringify(v),
);

v = review(clone(det), {
  clauses,
  coverage: () => ({ materialUnaccounted: [clauses[0].id], fabricated: [] }),
});
t(
  "9: dropped clause surfaced into uncovered",
  accepted(v) && v.result.uncovered.includes(clauses[0].text),
  JSON.stringify(accepted(v) ? v.result.uncovered : v),
);
t(
  '9: surfacing recorded as "surfaced-dropped-clause"',
  accepted(v) && v.repairs.includes("surfaced-dropped-clause"),
);

v = review(clone(det), {
  clauses,
  coverage: () => ({ materialUnaccounted: [], fabricated: [] }),
});
t(
  "9: clean coverage report leaves the honest result untouched",
  accepted(v) && v.repairs.length === 0,
);

/* The REAL rule-core clauseCoverage (landed mid-wave) wired as the injected fn. */
v = review(clone(det), { clauses, coverage: clauseCoverage });
t(
  "9: real clauseCoverage — honest full candidate accepted with repairs []",
  accepted(v) && v.repairs.length === 0,
  JSON.stringify(accepted(v) ? v.repairs : v),
);

const omission = clone(det);
(omission.rule as WorkflowRule).actions = [];
v = review(omission, { clauses, coverage: clauseCoverage });
t(
  "9: real clauseCoverage — model omission of the action surfaces the clause",
  accepted(v) &&
    v.result.uncovered.includes("assign to wael") &&
    v.repairs.includes("surfaced-dropped-clause"),
  JSON.stringify(accepted(v) ? v.result.uncovered : v),
);

const fabricated = clone(det);
(fabricated.rule as WorkflowRule).actions.push({ action: "close_request", params: {} });
v = review(fabricated, { clauses, coverage: clauseCoverage });
t(
  "9: real clauseCoverage — fabricated action rejected, zero tolerance",
  rejected(v) && !v.structural && v.reason === "fabricated-component",
  JSON.stringify(v),
);

/* ========================================================================== */
/* Step 10 — validator + linter                                               */
/* ========================================================================== */

v = review(
  env(
    mkRule({
      conditions: {
        logic: "AND",
        children: [{ field: "loan_amount", operator: "gte", value: "lots of money" }],
      },
    }),
  ),
);
t(
  "10: numeric field with text value → invalid-rule reject with the code",
  rejected(v) && !v.structural && v.reason === "invalid-rule:NON_NUMERIC_VALUE",
  JSON.stringify(v),
);

v = review(
  env(mkRule({ actions: [{ action: "set_underwriting_result", params: { value: "Rejected" } }] })),
);
t(
  "10: blocking lint issue → lint reject with the code",
  rejected(v) && !v.structural && v.reason === "lint:AUTO_REJECT_WITHOUT_NOTICE",
  JSON.stringify(v),
);

/* ========================================================================== */
/* Step 11 — side-cars, guards, determinism                                   */
/* ========================================================================== */

v = review({ ...clone(det), suggestions: ["a", "b", "c", "d", "e"] });
t(
  "11: candidate suggestions clamped to 3",
  accepted(v) && (v.result as { suggestions?: string[] }).suggestions?.length === 3,
);

v = review(
  env(clone(det.rule), {
    unresolved: [{ where: "action-param", heard: "Frank Sinatra", suggestions: [] }],
  }),
);
const mergedOnce = accepted(v)
  ? v.result.unresolved.filter((s) => s.heard.toLowerCase().includes("sinatra")).length
  : -1;
t(
  "11: candidate-declared slots preserved through the merge",
  mergedOnce === 1,
  `count=${mergedOnce}`,
);

/** Inline replica of the DraftEngine isParseResult shape guard. */
function isParseResultReplica(value: unknown): boolean {
  const r = value as ParseResult | null;
  return (
    !!r &&
    (r.rule === null || (typeof r.rule === "object" && r.rule !== undefined)) &&
    Array.isArray(r.notes) &&
    Array.isArray(r.unresolved) &&
    Array.isArray(r.uncovered) &&
    Array.isArray(r.ambiguities)
  );
}
const rich = review(
  env(mkRule({ actions: [{ action: "assign_user", params: { assignee: "Frank Sinatra" } }] }), {
    notes: ["draft"],
    uncovered: ["something else"],
  }),
);
t(
  "11: accepted result satisfies the DraftEngine isParseResult guard",
  accepted(rich) && isParseResultReplica(rich.result),
);

const hostile = env(
  mkRule({ actions: [{ action: "assign_user", params: { assignee: "Frank Sinatra" } }] }),
  {
    notes: ["IN\u200bJECT"],
    pwn: "extra",
  },
);
const run1 = reviewCandidate({
  candidate: hostile,
  sourceText: SOURCE,
  vocab,
  baseOptions,
  deterministic: det,
});
const run2 = reviewCandidate({
  candidate: hostile,
  sourceText: SOURCE,
  vocab,
  baseOptions,
  deterministic: det,
});
t(
  "12: determinism — same input, deep-equal verdict",
  JSON.stringify(run1) === JSON.stringify(run2),
);
const hostileBytes = JSON.stringify(hostile);
review(hostile);
t("12: reviewCandidate never mutates its input", JSON.stringify(hostile) === hostileBytes);

/* ========================================================================== */
/* Self-review sweep — the pipeline never mangles honest results              */
/* ========================================================================== */

interface AdversarialCase {
  id: string;
  instruction: string;
  options?: ParseOptions & {
    assignees?: string[];
    instanceOptions?: Record<string, string[]>;
    instanceRegistry?: Record<string, { id: string; label: string }[]>;
  };
}
const adversarial = JSON.parse(
  readFileSync(join(__dirname, "..", "docs", "data", "parser-evals", "adversarial.json"), "utf8"),
) as { cases: AdversarialCase[] };

/** The nine poisoned-options fixtures plus adv-020 (id-shaped name, no options) = 10. */
const sweepCases = [
  ...adversarial.cases.filter((c) => c.options !== undefined),
  adversarial.cases.find((c) => c.id === "adv-020")!,
];
t("sweep: 10 adversarial fixtures selected", sweepCases.length === 10, `got ${sweepCases.length}`);

for (const fixture of sweepCases) {
  const opts = fixture.options ?? {};
  const detFx = parseInstruction(fixture.instruction, opts);
  const vocabFx = vocabFromContext(
    makeSnapshot({
      instanceOptions: opts.instanceOptions ?? {},
      instanceRegistry: opts.instanceRegistry ?? {},
      assignees: opts.assignees ?? [],
    }),
  );
  const verdict = reviewCandidate({
    candidate: clone(detFx),
    sourceText: fixture.instruction,
    vocab: vocabFx,
    baseOptions: opts,
    deterministic: detFx,
  });
  t(
    `sweep ${fixture.id}: honest deterministic result self-reviews clean (repairs [])`,
    accepted(verdict) &&
      verdict.repairs.length === 0 &&
      canon(verdict.result.rule) === canon(detFx.rule),
    JSON.stringify(verdict).slice(0, 200),
  );
}

/* ========================================================================== */

if (failures > 0) {
  console.error(`\n✗ assert-parser-ai-boundary: ${failures} failure(s).`);
  process.exit(1);
}
console.log(
  "\n✓ candidateNormalization reviews hostile candidates fail-closed and honest ones untouched.",
);
