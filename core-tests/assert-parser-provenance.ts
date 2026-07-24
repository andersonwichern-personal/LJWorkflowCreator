/**
 * Envelope contract suite (parser AI engine, contract layer) — deterministic.
 *
 * Pins the frozen parserProvenance exports: makeEnvelope never weakens a
 * ParseResult (base fields byte-equal, sidecar-shrinking extras ignored,
 * suggestions clamped, no `key: undefined` noise), the result still passes the
 * DraftEngineService shape guard, provenance never leaks into rule JSON, and
 * isParseEnvelope is a strict superset of the client guard.
 *
 * Run: npx tsx core-tests/assert-parser-provenance.ts
 */
import {
  PARSER_ENGINE_VERSION,
  makeEnvelope,
  isParseEnvelope,
} from "../packages/rule-core/src/parserProvenance";
import type {
  EngineMode,
  ParserProvenance,
  ClauseRuleLink,
  ContradictionFinding,
  ParseEnvelope,
} from "../packages/rule-core/src/parserProvenance";
import { parseInstruction } from "../packages/rule-core/src/nlParser";
import type { ParseResult } from "../packages/rule-core/src/nlParser";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

/**
 * Inline replica of the DraftEngineService `isParseResult` guard (the client
 * trust boundary in src/app/features/workflows/data/draft-engine.service.ts).
 * Every envelope MUST keep satisfying it, or live responses fall back.
 */
function clientGuardAccepts(value: unknown): boolean {
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

const j = (v: unknown) => JSON.stringify(v);

/* ---- fixtures: real parser outputs ---------------------------------------- */
const FIXED_CLOCK = 1753305600000; // injected epoch ms — core code never reads a clock

const clean = parseInstruction(
  "If there is a system error and booking status is Error, assign to Wael"
);
const withUnresolved = parseInstruction(
  "When a loan is approved, assign to Santa Claus and request tax returns"
);
const withAmbiguity = parseInstruction("When a document is approved, notify sara");

t("fixture: clean parse has a rule and no gaps",
  clean.rule !== null && clean.unresolved.length === 0 && clean.uncovered.length === 0);
t("fixture: unresolved parse has unresolved + uncovered sidecars",
  withUnresolved.unresolved.length > 0 && withUnresolved.uncovered.length > 0,
  j({ unresolved: withUnresolved.unresolved, uncovered: withUnresolved.uncovered }));
t("fixture: ambiguity parse has an open question", withAmbiguity.ambiguities.length === 1);

const provenance: ParserProvenance = {
  engine: "deterministic",
  parserVersion: PARSER_ENGINE_VERSION,
  generation: 1,
  createdAt: FIXED_CLOCK,
};

/* ---- backward-compat: wrapping never changes the base ---------------------- */
const BASE_KEYS = ["rule", "notes", "unresolved", "uncovered", "ambiguities", "unbacked"] as const;
const CASES: Array<[string, ParseResult]> = [
  ["clean", clean],
  ["unresolved", withUnresolved],
  ["ambiguity", withAmbiguity],
];
for (const [label, base] of CASES) {
  const env = makeEnvelope(base, { provenance });
  t(`compat(${label}): makeEnvelope returns a new object`, env !== base);
  for (const key of BASE_KEYS) {
    t(`compat(${label}): base.${key} byte-equal after wrap`,
      j((env as Record<string, unknown>)[key]) === j((base as Record<string, unknown>)[key]),
      `got ${j((env as Record<string, unknown>)[key])}`);
  }
  t(`compat(${label}): envelope passes the DraftEngine client guard`, clientGuardAccepts(env));
  t(`compat(${label}): plain base already passes isParseEnvelope`, isParseEnvelope(base));
}

/* ---- sidecar-weakening attempts are ignored -------------------------------- */
const weakened = makeEnvelope(withUnresolved, {
  rule: null,
  notes: [],
  unresolved: [],
  uncovered: [],
  ambiguities: [],
  unbacked: [],
} as Partial<ParseEnvelope>);
t("weaken: extras.unresolved=[] cannot shrink base.unresolved",
  weakened.unresolved.length === withUnresolved.unresolved.length &&
    j(weakened.unresolved) === j(withUnresolved.unresolved));
t("weaken: extras.uncovered=[] cannot shrink base.uncovered",
  j(weakened.uncovered) === j(withUnresolved.uncovered) && weakened.uncovered.length > 0);
t("weaken: extras.notes=[] cannot shrink base.notes", j(weakened.notes) === j(withUnresolved.notes));
t("weaken: extras.rule=null cannot drop base.rule",
  j(weakened.rule) === j(withUnresolved.rule) && weakened.rule !== null);
t("weaken: extras.ambiguities/unbacked ignored too",
  j(weakened.ambiguities) === j(withUnresolved.ambiguities) &&
    j(weakened.unbacked) === j(withUnresolved.unbacked));

/* ---- suggestions clamp ------------------------------------------------------ */
const clamped = makeEnvelope(clean, { suggestions: ["s1", "s2", "s3", "s4", "s5"] });
t("clamp: 5 suggestions in → 3 out, order preserved",
  j(clamped.suggestions) === j(["s1", "s2", "s3"]), `got ${j(clamped.suggestions)}`);
t("clamp: 2 suggestions stay 2",
  j(makeEnvelope(clean, { suggestions: ["a", "b"] }).suggestions) === j(["a", "b"]));

/* ---- undefined extras stay absent ------------------------------------------- */
const noNoise = makeEnvelope(clean, {
  provenance: undefined,
  suggestions: undefined,
  clauseLinks: undefined,
});
t("absent: undefined extras add no keys",
  !("provenance" in noNoise) && !("suggestions" in noNoise) && !("clauseLinks" in noNoise));
t("absent: empty-extras envelope is byte-identical to its base", j(noNoise) === j(clean));

/* ---- provenance never lands inside rule JSON -------------------------------- */
const provEnv = makeEnvelope(clean, {
  provenance: {
    engine: "deterministic-fallback",
    parserVersion: PARSER_ENGINE_VERSION,
    promptVersion: "prompt-1",
    provider: "gateway",
    model: "demo-model",
    vocabularyHash: "vh-1",
    contextSnapshotId: "snap-1",
    requestId: "req-1",
    generation: 2,
    createdAt: FIXED_CLOCK,
    latency: { totalMs: 12, stages: { parse: 8, gate: 4 } },
    fallbackReason: "timeout",
  },
  clauseLinks: [{ clauseId: "c-1", rulePaths: ["triggers[0]"], status: "represented" }],
  unsupported: [{ clauseId: "c-9", text: "every business day", reason: "schedule/recurrence" }],
  contradictions: [],
  negatedNoOps: [{ clauseId: "c-4", text: "don't assign to wael" }],
  suggestions: ["Add a booking status condition"],
});
const ruleJson = j(provEnv.rule);
t("provenance: envelope.rule deep-equals base.rule", ruleJson === j(clean.rule));
t("provenance: rule JSON contains no provenance/parserVersion",
  !ruleJson.includes("provenance") && !ruleJson.includes("parserVersion"), ruleJson);

/* ---- isParseEnvelope -------------------------------------------------------- */
t("guard: plain ParseResult accepted", isParseEnvelope(clean));
t("guard: envelope with extras accepted", isParseEnvelope(provEnv));
t("guard: envelope survives a JSON round-trip", isParseEnvelope(JSON.parse(j(provEnv))));
t("guard: null rejected", !isParseEnvelope(null));
t("guard: 42 rejected", !isParseEnvelope(42));
t("guard: {} rejected", !isParseEnvelope({}));
t("guard: {rule:null} without arrays rejected", !isParseEnvelope({ rule: null }));
t("guard: string notes rejected",
  !isParseEnvelope({ rule: null, notes: "oops", unresolved: [], uncovered: [], ambiguities: [] }));
t("guard: unknown extra properties tolerated",
  isParseEnvelope({ ...clean, futureField: { anything: true } }));

/* ---- contract shapes compile + round-trip ----------------------------------- */
const modes: EngineMode[] = ["deterministic", "ai", "hybrid", "deterministic-fallback"];
t("shape: EngineMode enumerates all four modes", modes.length === 4);
t("shape: PARSER_ENGINE_VERSION is the frozen constant", PARSER_ENGINE_VERSION === "2026.07.24-1");

const link: ClauseRuleLink = {
  clauseId: "c-2",
  rulePaths: ["actions[1]", "actions[1].when", "actions[1].delayMinutes"],
  status: "represented",
};
t("shape: ClauseRuleLink JSON round-trips", j(JSON.parse(j(link))) === j(link));

const finding: ContradictionFinding = {
  paths: ["conditions.leaf[0]", "conditions.leaf[1]"],
  clauseIds: ["c-5", "c-6"],
  kind: "mutually-exclusive-values",
  message: "loan_amount cannot be both under 100k and over 500k",
};
t("shape: ContradictionFinding usable in an envelope",
  j(makeEnvelope(clean, { contradictions: [finding] }).contradictions) === j([finding]));

/* ---- exit ------------------------------------------------------------------- */
if (failures) {
  console.error(`\n${failures} envelope assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll envelope assertions passed.");
