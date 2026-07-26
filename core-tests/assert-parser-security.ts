/**
 * assert-parser-security — the adversarial corpus executed as a permanent
 * npm-test gate (S1–S5 of the fuzz mandate).
 *
 * S1 runs ALL cases of docs/data/parser-evals/adversarial.json through
 * parseInstruction and enforces every `expect` field with the same semantics
 * scripts/eval-parser.ts scores them with. The scorer is reimplemented locally
 * on purpose: eval-parser.ts executes main() at import time, so it is not
 * structured for import. Any expect key this scorer does not enforce fails
 * LOUDLY (a silently ignored expectation is a test that stopped testing).
 *
 * S2 feeds a malformed-payload zoo through reviewCandidate; S3 exercises
 * concurrency/cancellation on hybridParse with the mock-transport rig pattern
 * from assert-parser-engine-hybrid; S4 pins the oversized/unicode input floor;
 * S5 pins log/telemetry hygiene. No network, no live models; Date.now() is
 * used only to MEASURE wall time in S4, never to decide semantics.
 *
 * Run: npx tsx core-tests/assert-parser-security.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseInstruction, ParseOptions, ParseResult } from "../packages/rule-core/src/nlParser";
import { validateRule } from "../packages/rule-core/src/ruleValidation";
import { parseGateReport } from "../packages/rule-core/src/parseGate";
import { segmentInstruction } from "../packages/rule-core/src/parserClauses";
import { staticVocabularySnapshot } from "../packages/rule-core/src/parserGrounding";
import { reviewCandidate } from "../packages/workflow-brain/src/candidateNormalization";
import type { CandidateReviewInput } from "../packages/workflow-brain/src/candidateNormalization";
import { hybridParse } from "../packages/workflow-brain/src/orchestrator";
import type { HybridDeps, HybridParseRequest } from "../packages/workflow-brain/src/orchestrator";
import { BrainAbortError } from "../packages/workflow-brain/src/ports";
import type {
  AiParseTransport,
  AiParseTransportRequest,
  BrainTelemetrySink,
} from "../packages/workflow-brain/src/ports";
import type { BrainContextSnapshot } from "../packages/workflow-brain/src/context";
import {
  guardedTelemetry,
  redactForDiagnostics,
} from "../packages/workflow-brain/src/observability";
import { emitGhostTelemetry } from "../packages/workflow-brain/src/ghostSuggestions";
import type { GhostSource } from "../packages/workflow-brain/src/ghostSuggestions";

let failures = 0;
let assertions = 0;
function t(name: string, cond: boolean, detail?: string) {
  assertions++;
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ========================================================================== */
/* S1 — the adversarial corpus as a gate                                      */
/* ========================================================================== */

interface AdvExpect {
  event?: string | null;
  ruleNull?: boolean;
  ambiguity?: boolean;
  unresolvedMin?: number;
  uncoveredContains?: string[];
  mustNotArm?: boolean;
  mustNotContainActions?: string[];
  mustNotResolveEntities?: string[];
  maxRuleActions?: number;
}
interface AdvCase {
  id: string;
  category: string;
  threat: string;
  instruction: string;
  options?: ParseOptions;
  expect: AdvExpect & Record<string, unknown>;
}

/** Every expect key this local scorer enforces (eval-parser semantics). */
const ENFORCED_KEYS = new Set([
  "event",
  "ruleNull",
  "ambiguity",
  "unresolvedMin",
  "uncoveredContains",
  "mustNotArm",
  "mustNotContainActions",
  "mustNotResolveEntities",
  "maxRuleActions",
]);

/** Local reimplementation of the eval-parser checks these fixtures use. */
function scoreAdversarialCase(advCase: AdvCase, result: ParseResult): string[] {
  const caseFailures: string[] = [];
  const expect = advCase.expect;
  const rule = result.rule;
  const thenLane = rule?.actions ?? [];
  const elseLane = rule?.else ?? [];

  const unknownKeys = Object.keys(expect).filter((key) => !ENFORCED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    caseFailures.push(`unenforced expect key(s) [${unknownKeys.join(", ")}] — scorer must grow`);
  }

  if (expect.event !== undefined) {
    if (expect.event === null) {
      if (rule !== null) {
        caseFailures.push(`expected no rule, got triggers [${rule.triggers.map((x) => x.event).join(", ")}]`);
      }
    } else if (!rule) {
      caseFailures.push(`expected trigger ${expect.event}, got no rule`);
    } else if (rule.triggers[0]?.event !== expect.event) {
      caseFailures.push(`expected first trigger ${expect.event}, got ${rule.triggers[0]?.event ?? "none"}`);
    }
  }
  if (expect.ruleNull && rule !== null) caseFailures.push("expected rule=null, got a rule");
  if (expect.ambiguity !== undefined) {
    const ok = expect.ambiguity ? result.ambiguities.length > 0 : result.ambiguities.length === 0;
    if (!ok) caseFailures.push(`expected ambiguity=${expect.ambiguity}, got ${result.ambiguities.length}`);
  }
  if (expect.unresolvedMin !== undefined && result.unresolved.length < expect.unresolvedMin) {
    caseFailures.push(`expected ≥${expect.unresolvedMin} unresolved, got ${result.unresolved.length}`);
  }
  for (const sub of expect.uncoveredContains ?? []) {
    if (!result.uncovered.some((u) => u.includes(sub))) {
      caseFailures.push(`uncovered missing "${sub}" (have [${result.uncovered.join(" | ")}])`);
    }
  }
  for (const banned of expect.mustNotContainActions ?? []) {
    if ([...thenLane, ...elseLane].some((o) => o.action === banned)) {
      caseFailures.push(`FABRICATION: banned action ${banned} present`);
    }
  }
  const serialized = rule ? JSON.stringify(rule).toLowerCase() : "";
  for (const entity of expect.mustNotResolveEntities ?? []) {
    if (serialized.includes(entity.toLowerCase())) {
      caseFailures.push(`FABRICATION: entity "${entity}" landed in the rule`);
    }
  }
  if (expect.mustNotArm && rule && rule.controls.mode !== "shadow") {
    caseFailures.push(`FABRICATION: rule armed (controls.mode = ${rule.controls.mode})`);
  }
  if (expect.maxRuleActions !== undefined && thenLane.length + elseLane.length > expect.maxRuleActions) {
    caseFailures.push(`expected ≤${expect.maxRuleActions} action(s), got ${thenLane.length + elseLane.length}`);
  }
  return caseFailures;
}

{
  const fixturePath = join(__dirname, "..", "docs", "data", "parser-evals", "adversarial.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    version: number;
    group: string;
    cases: AdvCase[];
  };
  t("S1 adversarial corpus loaded: 59 cases, group adversarial",
    fixture.group === "adversarial" && fixture.cases.length === 59,
    `group=${fixture.group} cases=${fixture.cases.length}`);

  const byCategory = new Map<string, string[]>();
  for (const advCase of fixture.cases) {
    const result = parseInstruction(advCase.instruction, advCase.options);
    const caseFailures = scoreAdversarialCase(advCase, result);
    const bucket = byCategory.get(advCase.category) ?? [];
    for (const failure of caseFailures) bucket.push(`${advCase.id}: ${failure}`);
    if (!byCategory.has(advCase.category)) byCategory.set(advCase.category, bucket);
  }
  for (const [category, categoryFailures] of byCategory) {
    const total = fixture.cases.filter((c) => c.category === category).length;
    t(`S1 ${category} (${total} case(s)) holds the red-team floor`,
      categoryFailures.length === 0, categoryFailures.join(" || "));
  }
}

/* ========================================================================== */
/* S2 — malformed-payload zoo through reviewCandidate                         */
/* ========================================================================== */

const S2_TEXT = "when a loan is approved, assign to wael";
const s2Det = parseInstruction(S2_TEXT);
function review(candidate: unknown) {
  const input: CandidateReviewInput = {
    candidate,
    sourceText: S2_TEXT,
    vocab: staticVocabularySnapshot(),
    baseOptions: {},
    deterministic: s2Det,
  };
  return reviewCandidate(input);
}
/** Run one zoo payload: must not throw; verdict must be fail-closed per check. */
function zoo(name: string, candidate: unknown, check: (v: ReturnType<typeof review>) => boolean) {
  let verdict: ReturnType<typeof review> | null = null;
  let threw: unknown = null;
  try {
    verdict = review(candidate);
  } catch (e) {
    threw = e;
  }
  t(`S2 ${name}: no throw + fail-closed verdict`,
    threw === null && verdict !== null && check(verdict),
    threw ? `threw ${String(threw)}` : JSON.stringify(verdict));
}

zoo("null candidate", null, (v) => !v.accepted && v.reason === "not-an-object");
zoo("number candidate (42)", 42, (v) => !v.accepted && v.reason === "not-an-object");
zoo('empty string ""', "", (v) => !v.accepted && v.reason === "unparseable-json");
zoo("fenced garbage '```json{garbage```'", "```json{garbage```",
  (v) => !v.accepted && v.reason === "unparseable-json");
zoo("top-level array", [], (v) => !v.accepted && v.reason === "not-an-object");
zoo("rule is an array", { rule: [], notes: [], unresolved: [], uncovered: [], ambiguities: [] },
  (v) => !v.accepted && v.reason === "invalid-shape:rule");

{
  // 1000-level nesting, constructed ITERATIVELY (the recursion-safety probe).
  let deep: Record<string, unknown> = { leaf: true };
  for (let i = 0; i < 1000; i++) deep = { a: deep };
  zoo("1000-level-deep object", deep, (v) => !v.accepted && v.reason === "invalid-shape:rule");
}
{
  const hugeRule = {
    schemaVersion: 3,
    triggers: [{ event: "LOAN APPROVED" }],
    conditions: { logic: "AND", children: [] },
    actions: [],
    controls: {},
    padding: "x".repeat(100_001),
  };
  zoo("100k-char rule", { rule: hugeRule, notes: [], unresolved: [], uncovered: [], ambiguities: [] },
    (v) => !v.accepted && v.reason === "rule-too-large");
}
{
  // Prototype-pollution keys must neither pollute nor pass through.
  const polluted =
    '{"rule": null, "notes": [], "unresolved": [], "uncovered": [], "ambiguities": [],' +
    ' "__proto__": {"zooPolluted": true}, "constructor": {"prototype": {"zooPolluted2": true}}}';
  zoo("__proto__/constructor pollution keys", polluted, (v) => !v.accepted || v.repairs.length > 0);
  const probe = {} as Record<string, unknown>;
  t("S2 Object.prototype untouched after pollution review",
    probe.zooPolluted === undefined &&
      probe.zooPolluted2 === undefined &&
      !("zooPolluted" in Object.prototype) &&
      !("zooPolluted2" in Object.prototype));
}
{
  const nanRule = {
    schemaVersion: 3,
    triggers: [{ event: "LOAN APPROVED" }],
    conditions: { logic: "AND", children: [] },
    actions: [
      { action: "assign_user", params: { assignee: "Wael" }, delayMinutes: NaN },
      { action: "notify", params: { value: "Sara" }, delayMinutes: Infinity },
    ],
    controls: { mode: "shadow" },
  };
  zoo("NaN/Infinity delayMinutes", { rule: nanRule, notes: [], unresolved: [], uncovered: [], ambiguities: [] },
    (v) => {
      if (!v.accepted) return true; // rejecting is fail-closed too
      const outputs = [...(v.result.rule?.actions ?? []), ...(v.result.rule?.else ?? [])];
      return outputs.every(
        (o) => o.delayMinutes === undefined || Number.isFinite(o.delayMinutes)
      );
    });
}
{
  const negRule = {
    schemaVersion: 3,
    triggers: [{ event: "LOAN APPROVED" }],
    conditions: { logic: "AND", children: [] },
    actions: [{ action: "assign_user", params: { assignee: "Wael" } }],
    controls: { mode: "shadow", maxFiresPerHour: -5 },
  };
  zoo("negative maxFiresPerHour", { rule: negRule, notes: [], unresolved: [], uncovered: [], ambiguities: [] },
    (v) => !v.accepted || (v.result.rule !== null && v.result.rule.controls.maxFiresPerHour >= 0));
}
{
  // Sneaky valueOf/toString/getters: serialization traps must die in step 1.
  const trapGetter = {
    notes: [],
    unresolved: [],
    uncovered: [],
    ambiguities: [],
    get rule(): unknown {
      throw new Error("gotcha");
    },
  };
  zoo("throwing getter on rule", trapGetter, (v) => !v.accepted && v.reason === "unserializable-candidate");
  const trapToJson = {
    rule: null,
    notes: [],
    unresolved: [],
    uncovered: [],
    ambiguities: [],
    toJSON() {
      throw new Error("gotcha");
    },
  };
  zoo("throwing toJSON", trapToJson, (v) => !v.accepted && v.reason === "unserializable-candidate");
  const sneakyStrings = {
    rule: null,
    notes: [{ valueOf: () => "note", toString: () => "note" }],
    unresolved: [],
    uncovered: [],
    ambiguities: [],
  };
  zoo("valueOf/toString objects posing as strings", sneakyStrings,
    // det has a rule, so an honest-null candidate is weaker — either way the
    // objects must not survive as strings anywhere.
    (v) => !v.accepted || !JSON.stringify(v.result).includes("valueOf"));
}

/* ========================================================================== */
/* S3 — concurrency / cancellation (mock-transport rig pattern)               */
/* ========================================================================== */

function makeSnapshot(id: string): BrainContextSnapshot {
  return {
    snapshotId: id,
    profile: "standalone-demo",
    identity: { tenantKey: "tenant-sec" },
    vocabularyHash: "v-sec00001",
    instanceOptions: {},
    instanceRegistry: {},
    assignees: ["Wael"],
    entities: [],
    relatedWorkflows: [],
    allowedActionKeys: ["assign_user"],
    sources: [],
    budget: { maxBytes: 4096, usedBytes: 0, truncated: [] },
    privacyCeiling: "public-vocabulary",
  };
}
const secSnapshot = makeSnapshot("ctx-sec-1");

function gappyDet(): ParseResult {
  return {
    rule: null,
    notes: [],
    unresolved: [{ where: "action-param", heard: "santa claus", suggestions: [] }],
    uncovered: ["assign to santa claus"],
    ambiguities: [],
  };
}
function cleanResult(marker: string): ParseResult {
  return {
    rule: {
      schemaVersion: 3,
      triggers: [{ event: "LOAN APPROVED" }],
      conditions: { logic: "AND", children: [] },
      actions: [{ action: "assign_user", params: { assignee: marker } }],
      controls: { mode: "shadow", oncePerRequest: true, maxFiresPerHour: 25, missingData: "no_match", priority: 100 },
    } as unknown as ParseResult["rule"],
    notes: [marker],
    unresolved: [],
    uncovered: [],
    ambiguities: [],
  };
}

interface SecRig {
  deps: HybridDeps;
  reviewCalls: unknown[];
  events: Array<{ name: string }>;
}
function secRig(transport: AiParseTransport | undefined, accepts: string): SecRig {
  const reviewCalls: unknown[] = [];
  const events: Array<{ name: string }> = [];
  const telemetry: BrainTelemetrySink = { event: (name) => events.push({ name }) };
  const deps: HybridDeps = {
    review: ((input: Record<string, unknown>) => {
      reviewCalls.push(input);
      return { accepted: true, result: cleanResult(accepts), repairs: [] };
    }) as unknown as HybridDeps["review"],
    deterministicParse: () => gappyDet(),
    clock: { now: () => 1000 },
    transport,
    telemetry,
  };
  return { deps, reviewCalls, events };
}
function secReq(over: Partial<HybridParseRequest>): HybridParseRequest {
  return {
    text: "when a loan is approved, assign to santa claus",
    snapshot: secSnapshot,
    generation: 1,
    requestId: "req-sec",
    attemptTimeoutMs: 1000,
    totalDeadlineMs: 5000,
    ...over,
  };
}

async function s3() {
  /* Abort mid-transport → BrainAbortError, never an envelope. */
  {
    const transport: AiParseTransport = { parse: () => new Promise(() => {}) };
    const rig = secRig(transport, "never");
    const controller = new AbortController();
    const pending = hybridParse(secReq({}), rig.deps, controller.signal);
    setTimeout(() => controller.abort(), 5);
    let thrown: unknown = null;
    try {
      await pending;
    } catch (e) {
      thrown = e;
    }
    t("S3 abort mid-transport throws BrainAbortError (no envelope)",
      thrown instanceof BrainAbortError, String(thrown));
  }

  /* Two overlapping parses, separate generations + controllers: no cross-talk. */
  {
    const mkTransport = (settleMs: number, marker: string): AiParseTransport => ({
      parse: async (request: AiParseTransportRequest) => {
        void request;
        await delay(settleMs);
        return { candidate: { marker }, meta: { model: `model-${marker}` } };
      },
    });
    const rigSlow = secRig(mkTransport(30, "slow"), "Slow");
    const rigFast = secRig(mkTransport(5, "fast"), "Fast");
    const slowController = new AbortController();
    const fastController = new AbortController();
    const [envSlow, envFast] = await Promise.all([
      hybridParse(secReq({ generation: 3, requestId: "req-slow" }), rigSlow.deps, slowController.signal),
      hybridParse(secReq({ generation: 7, requestId: "req-fast" }), rigFast.deps, fastController.signal),
    ]);
    t("S3 overlapping parses: each envelope carries ITS generation/requestId",
      envSlow.provenance?.generation === 3 &&
        envSlow.provenance?.requestId === "req-slow" &&
        envFast.provenance?.generation === 7 &&
        envFast.provenance?.requestId === "req-fast",
      JSON.stringify({ slow: envSlow.provenance, fast: envFast.provenance }));
    t("S3 overlapping parses: bodies come from their own transport (no cross-talk)",
      envSlow.notes[0] === "Slow" &&
        envFast.notes[0] === "Fast" &&
        envSlow.provenance?.model === "model-slow" &&
        envFast.provenance?.model === "model-fast",
      JSON.stringify({ slowNotes: envSlow.notes, fastNotes: envFast.notes }));
  }

  /* Transport resolves AFTER its caller aborted → result discarded. */
  {
    let transportSettled = false;
    const transport: AiParseTransport = {
      parse: async () => {
        await delay(30);
        transportSettled = true;
        return { candidate: { late: true } };
      },
    };
    const rig = secRig(transport, "Late");
    const controller = new AbortController();
    const pending = hybridParse(secReq({}), rig.deps, controller.signal);
    setTimeout(() => controller.abort(), 5);
    let thrown: unknown = null;
    try {
      await pending;
    } catch (e) {
      thrown = e;
    }
    await delay(50); // let the orphaned transport settle
    t("S3 abort wins even though the transport later resolved",
      thrown instanceof BrainAbortError && transportSettled === true, String(thrown));
    t("S3 late result fully discarded: review never ran, no outcome telemetry",
      rig.reviewCalls.length === 0 && rig.events.length === 0,
      JSON.stringify({ reviews: rig.reviewCalls.length, events: rig.events }));
  }
}

/* ========================================================================== */
/* S4 — oversized / unicode input floor                                       */
/* ========================================================================== */

/** Wall-clock guard: measurement only (never a semantic assertion). */
function parseWithinBound(name: string, input: string, boundMs: number): ParseResult | null {
  let result: ParseResult | null = null;
  let threw: unknown = null;
  const startedAt = Date.now();
  try {
    result = parseInstruction(input);
  } catch (e) {
    threw = e;
  }
  const elapsed = Date.now() - startedAt;
  t(`S4 ${name}: returns without throwing within ${boundMs}ms`,
    threw === null && result !== null && elapsed < boundMs,
    threw ? String(threw) : `elapsed ${elapsed}ms`);
  return result;
}

/** The gate-honesty floor: whatever comes back validates or is gated. */
function gateHonest(name: string, result: ParseResult | null) {
  if (!result) return;
  const gate = parseGateReport(result);
  const valid =
    result.rule !== null &&
    !validateRule(result.rule).issues.some((issue) => issue.severity === "error");
  t(`S4 ${name}: output validates or is explicitly gated`,
    valid || gate.readyToActivate === false,
    JSON.stringify({ valid, gate: { gaps: gate.gaps, readyToActivate: gate.readyToActivate } }));
}

{
  const fiftyK = `when a loan is approved, assign to Wael and ${"review the covenant terms carefully ".repeat(1500)}`;
  t("S4 precondition: oversized instruction is ≥50k chars", fiftyK.length >= 50_000, String(fiftyK.length));
  gateHonest("50k-char instruction", parseWithinBound("50k-char instruction", fiftyK, 2000));

  const runOn =
    "when a loan is approved, " +
    Array.from({ length: 300 }, (_, i) => `add tag zoo-tag-${i}`).join(", ");
  const runOnResult = parseWithinBound("300-clause run-on", runOn, 2000);
  gateHonest("300-clause run-on", runOnResult);

  // Segmentation tiling invariant on the 300-clause input: spans ordered,
  // non-overlapping, in bounds, and each clause text is its exact slice.
  {
    const { source, clauses } = segmentInstruction(runOn);
    let ordered = true;
    let sliced = true;
    let previousEnd = -1;
    for (const clause of clauses) {
      if (clause.span.start < previousEnd || clause.span.end > source.text.length ||
          clause.span.start >= clause.span.end) ordered = false;
      if (source.text.slice(clause.span.start, clause.span.end) !== clause.text) sliced = false;
      previousEnd = clause.span.end;
    }
    t("S4 300-clause segmentation tiling invariant holds (ordered, disjoint, exact slices)",
      clauses.length >= 300 && ordered && sliced,
      JSON.stringify({ clauses: clauses.length, ordered, sliced }));
  }

  const hostileUnicode =
    "when a loan is approved, assign to W\u200bael" + // ZWSP inside the name
    "\u200b".repeat(4000) + // zero-width flood
    "\u202eKCATTA\u202c" + // RTL override + pop
    " and notify Wаel"; // Cyrillic "а" homoglyph
  const hostileResult = parseWithinBound("ZWSP/RTL/homoglyph flood", hostileUnicode, 2000);
  gateHonest("ZWSP/RTL/homoglyph flood", hostileResult);
}

/* ========================================================================== */
/* S5 — log / telemetry hygiene                                               */
/* ========================================================================== */

{
  const received: Array<{ name: string; dims?: Record<string, string | number | boolean> }> = [];
  const sink: BrainTelemetrySink = { event: (name, dims) => received.push({ name, dims }) };
  const guarded = guardedTelemetry(sink);

  guarded.event("parse-outcome", {
    engine: "deterministic",
    latencyBucket: "lt500",
    outcome: "ok",
    source: "deterministic",
    fallbackReason: "Bearer sk-live-x", // hostile value on an allowlisted key
    authorText: "when a loan is approved, assign to Wael", // unknown key
    label: "Wael`; ${arm_all_rules}`", // unknown key
  } as unknown as Record<string, string | number | boolean>);
  guarded.event("Bearer sk-live-x still counts as an event name?", { engine: "ai" });

  const flat = JSON.stringify(received);
  t("S5 guardedTelemetry: only allowlisted enum-shaped dimensions reach the sink",
    received.length === 1 &&
      received[0].name === "parse-outcome" &&
      JSON.stringify(Object.keys(received[0].dims ?? {}).sort()) ===
        JSON.stringify(["engine", "latencyBucket", "outcome", "source"]),
    flat);
  t("S5 guardedTelemetry: hostile event name drops the whole call; no secret/author text survives",
    !flat.includes("Bearer") && !flat.includes("sk-live") && !flat.includes("loan is approved") &&
      !flat.includes("arm_all_rules"),
    flat);

  const throwingSink: BrainTelemetrySink = {
    event: () => {
      throw new Error("sink exploded");
    },
  };
  let guardedThrew = false;
  try {
    guardedTelemetry(throwingSink).event("parse-outcome", { engine: "ai" });
  } catch {
    guardedThrew = true;
  }
  t("S5 guardedTelemetry never throws, even when the host sink does", guardedThrew === false);

  const ghostReceived: Array<{ name: string; dims?: Record<string, string | number | boolean> }> = [];
  const ghostSink: BrainTelemetrySink = { event: (name, dims) => ghostReceived.push({ name, dims }) };
  emitGhostTelemetry(ghostSink, "offered", {
    source: "Bearer sk-live-x" as GhostSource, // hostile — must be filtered
    latencyBucket: "when a loan is approved", // hostile — must be filtered
  });
  emitGhostTelemetry(ghostSink, "accepted", { source: "deterministic", latencyBucket: "lt100" });
  const ghostFlat = JSON.stringify(ghostReceived);
  t("S5 emitGhostTelemetry: hostile dimension values dropped, clean enums pass",
    ghostReceived.length === 2 &&
      ghostReceived[0].name === "ghost.offered" &&
      Object.keys(ghostReceived[0].dims ?? {}).length === 0 &&
      ghostReceived[1].dims?.source === "deterministic" &&
      ghostReceived[1].dims?.latencyBucket === "lt100" &&
      !ghostFlat.includes("Bearer") && !ghostFlat.includes("loan is approved"),
    ghostFlat);

  const canary =
    "line1\nAuthorization: Bearer sk-live-SECRET123 then x-goog-api-key: AIzaCANARY7 " +
    "and cf-aig-authorization: CFCANARY9 tail\u0000tail";
  const redacted = redactForDiagnostics(canary);
  t("S5 redactForDiagnostics masks every credential canary",
    !redacted.includes("SECRET123") && !redacted.includes("AIzaCANARY7") &&
      !redacted.includes("CFCANARY9") && redacted.includes("«redacted»"),
    redacted);
  t("S5 redactForDiagnostics collapses control chars and hard-truncates to 120",
    !/[\u0000-\u001f\u007f]/.test(redacted) && redacted.length <= 120,
    `len=${redacted.length}`);
  const longSecret = `${"a".repeat(110)} Bearer sk-live-TAILSECRET`;
  const redactedLong = redactForDiagnostics(longSecret);
  t("S5 masking runs before truncation — a secret cannot survive by being cut in half",
    !redactedLong.includes("TAILSECRET") && !redactedLong.includes("sk-live"),
    redactedLong);
}

/* ========================================================================== */
/* Exit                                                                       */
/* ========================================================================== */

s3()
  .then(() => {
    if (failures) {
      console.error(`\n${failures} of ${assertions} parser-security assertion(s) FAILED`);
      process.exit(1);
    }
    console.log(`\nAll ${assertions} parser-security assertions passed.`);
  })
  .catch((error) => {
    console.error("FATAL", error);
    process.exit(1);
  });
