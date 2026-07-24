/**
 * assert-parser-engine-hybrid — pins the hybrid orchestration strategy of the
 * Workflow Brain (aiPort.ts + orchestrator.ts).
 *
 * Everything is local: transports are spies, review is a scripted stub in the
 * shape the orchestrator documents for CandidateVerdict, the clock is injected
 * and fake. No network, no live models, no wall-clock assertions — the only
 * real timers are tiny injected attempt deadlines (10 ms vs a 50 ms transport)
 * so the timeout race is exercised without faking timers.
 *
 * Run: npx tsx core-tests/assert-parser-engine-hybrid.ts
 */
import {
  buildParseRequest,
  buildRepairRequest,
  classifyTransportError,
  REPAIR_HINT_MAX_CHARS,
  TransportTimeoutError,
} from "../packages/workflow-brain/src/aiPort";
import {
  DEFAULT_ATTEMPT_TIMEOUT_MS,
  DEFAULT_TOTAL_DEADLINE_MS,
  deterministicOnlyEnvelope,
  hybridParse,
  needsAi,
} from "../packages/workflow-brain/src/orchestrator";
import type { HybridDeps, HybridParseRequest } from "../packages/workflow-brain/src/orchestrator";
import { BrainAbortError } from "../packages/workflow-brain/src/ports";
import type {
  AiParseTransport,
  AiParseTransportRequest,
  AiParseTransportResponse,
} from "../packages/workflow-brain/src/ports";
import type { BrainContextSnapshot } from "../packages/workflow-brain/src/context";
import { snapshotToParseOptions } from "../packages/workflow-brain/src/contextCompiler";
import { isParseEnvelope, PARSER_ENGINE_VERSION } from "../packages/rule-core/src/parserProvenance";
import type { ParseOptions, ParseResult } from "../packages/rule-core/src/nlParser";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const TEXT = "when a loan is approved, assign to santa claus";

class FakeClock {
  t = 1000;
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

function makeSnapshot(): BrainContextSnapshot {
  return {
    snapshotId: "ctx-test-1",
    profile: "standalone-demo",
    identity: { tenantKey: "tenant-a" },
    vocabularyHash: "v-abc123",
    instanceOptions: { template: ["Origination", "Servicing"] },
    instanceRegistry: { assign_user: [{ id: "u-1", label: "Wael" }] },
    assignees: ["Wael", "Omar"],
    entities: [],
    relatedWorkflows: [],
    allowedActionKeys: ["assign_user"],
    sources: [],
    budget: { maxBytes: 4096, usedBytes: 0, truncated: [] },
    privacyCeiling: "public-vocabulary",
  };
}

function mkRule(marker: string): ParseResult["rule"] {
  return {
    schemaVersion: 3,
    triggers: [{ event: "LOAN APPROVED" }],
    conditions: { logic: "AND", children: [] },
    actions: [{ action: "assign_user", params: { assignee: marker } }],
    controls: {
      mode: "shadow",
      oncePerRequest: true,
      maxFiresPerHour: 25,
      missingData: "no_match",
      priority: 100,
    },
  } as unknown as ParseResult["rule"];
}

function cleanDet(): ParseResult {
  return { rule: mkRule("Wael"), notes: ["det"], unresolved: [], uncovered: [], ambiguities: [] };
}

function gappyDet(): ParseResult {
  return {
    rule: null,
    notes: ["det note"],
    unresolved: [{ where: "action-param", heard: "santa claus", suggestions: ["Wael"] }],
    uncovered: ["assign to santa claus"],
    ambiguities: [{ question: "Which event?", options: ["LOAN APPROVED", "LOAN REJECTED"] }],
  };
}

/* Verdicts in the landed candidateNormalization CandidateVerdict shape.
 * repairs.length > 0 ⇒ the orchestrator labels the outcome "hybrid". */
const accepted = (result: ParseResult, augmented = false) => ({
  accepted: true,
  result,
  repairs: augmented ? ["sanitized-strings"] : [],
});
const rejectedStructural = (defect: string) => ({
  accepted: false,
  structural: true,
  reason: defect,
});
const rejectedSemantic = (defect: string) => ({
  accepted: false,
  structural: false,
  reason: defect,
});

/* -------------------------------------------------------------------------- */
/* Rig                                                                        */
/* -------------------------------------------------------------------------- */

interface Rig {
  deps: HybridDeps;
  clock: FakeClock;
  detCalls: Array<{ text: string; options: ParseOptions }>;
  reviewCalls: Array<Record<string, unknown>>;
  events: Array<{ name: string; dimensions: Record<string, string | number | boolean> }>;
}

function rig(cfg: {
  det: () => ParseResult;
  detAdvance?: number;
  review?: (input: Record<string, unknown>, call: number) => unknown;
  reviewAdvance?: number;
  transport?: AiParseTransport;
  clock?: FakeClock;
}): Rig {
  const clock = cfg.clock ?? new FakeClock();
  const detCalls: Rig["detCalls"] = [];
  const reviewCalls: Rig["reviewCalls"] = [];
  const events: Rig["events"] = [];
  const deps: HybridDeps = {
    review: ((input: Record<string, unknown>) => {
      reviewCalls.push(input);
      if (cfg.reviewAdvance) clock.advance(cfg.reviewAdvance);
      return cfg.review ? cfg.review(input, reviewCalls.length) : rejectedSemantic("unused");
    }) as unknown as HybridDeps["review"],
    deterministicParse: (text, options) => {
      detCalls.push({ text, options });
      if (cfg.detAdvance) clock.advance(cfg.detAdvance);
      return cfg.det();
    },
    clock,
    transport: cfg.transport,
    telemetry: {
      event: (name, dimensions) => events.push({ name, dimensions: dimensions ?? {} }),
    },
  };
  return { deps, clock, detCalls, reviewCalls, events };
}

function spyTransport(
  behaviors: Array<(request: AiParseTransportRequest, signal?: AbortSignal) => Promise<unknown>>
): { calls: AiParseTransportRequest[]; transport: AiParseTransport } {
  const calls: AiParseTransportRequest[] = [];
  const transport: AiParseTransport = {
    parse(request, signal) {
      calls.push(JSON.parse(JSON.stringify(request)));
      const behavior = behaviors[Math.min(calls.length - 1, behaviors.length - 1)];
      return behavior(request, signal) as Promise<AiParseTransportResponse>;
    },
  };
  return { calls, transport };
}

function mkReq(
  snapshot: BrainContextSnapshot,
  over: Partial<HybridParseRequest> = {}
): HybridParseRequest {
  return {
    text: TEXT,
    snapshot,
    generation: 3,
    requestId: "req-42",
    attemptTimeoutMs: 1000,
    totalDeadlineMs: 5000,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                  */
/* -------------------------------------------------------------------------- */

async function main() {
  const snapshot = makeSnapshot();

  /* A — needsAi truth table */
  t("A1 needsAi false when whole/covered/unambiguous", needsAi(cleanDet()) === false);
  t("A2 needsAi true when rule is null", needsAi({ ...cleanDet(), rule: null }) === true);
  t(
    "A3 needsAi true on unresolved",
    needsAi({ ...cleanDet(), unresolved: gappyDet().unresolved }) === true
  );
  t("A4 needsAi true on uncovered", needsAi({ ...cleanDet(), uncovered: ["tail"] }) === true);
  t(
    "A5 needsAi true on ambiguities",
    needsAi({ ...cleanDet(), ambiguities: gappyDet().ambiguities }) === true
  );

  /* B — aiPort request assembly + error classification */
  const base: ParseOptions = { forceEvent: "LOAN APPROVED", allowUnbackedValues: true };
  const parseReq = buildParseRequest(TEXT, snapshot, "req-42", base);
  t(
    "B1 request carries text/requestId/contextSnapshotId",
    parseReq.text === TEXT && parseReq.requestId === "req-42" && parseReq.contextSnapshotId === "ctx-test-1"
  );
  t("B2 first request has no repairHint", !("repairHint" in parseReq));
  t(
    "B3 request options are the snapshot projection (base preserved)",
    JSON.stringify(parseReq.options) === JSON.stringify(snapshotToParseOptions(snapshot, base))
  );
  const noisyDefect = "line one\r\nline two\n" + "x".repeat(400);
  const repairReq = buildRepairRequest(parseReq, noisyDefect);
  t(
    "B4 repair keeps the payload verbatim",
    repairReq.text === TEXT &&
      repairReq.requestId === "req-42" &&
      repairReq.contextSnapshotId === "ctx-test-1" &&
      JSON.stringify(repairReq.options) === JSON.stringify(parseReq.options)
  );
  t(
    "B5 repairHint sanitized: no newlines, hard cap",
    typeof repairReq.repairHint === "string" &&
      repairReq.repairHint.length <= REPAIR_HINT_MAX_CHARS &&
      !/[\r\n]/.test(repairReq.repairHint) &&
      repairReq.repairHint.startsWith("line one line two"),
    JSON.stringify(repairReq.repairHint)
  );
  t(
    "B6 short clean defect passes verbatim",
    buildRepairRequest(parseReq, "candidate.rule missing actions[]").repairHint ===
      "candidate.rule missing actions[]"
  );
  t(
    "B7 classify: abort and timeout markers",
    classifyTransportError(new BrainAbortError("x")) === "aborted" &&
      classifyTransportError(new TransportTimeoutError("x")) === "timeout"
  );
  t(
    "B8 classify: anything else is transport",
    classifyTransportError(new Error("boom")) === "transport" &&
      classifyTransportError("boom") === "transport"
  );
  t(
    "B9 suggested defaults exported (callers still pass explicit budgets)",
    DEFAULT_ATTEMPT_TIMEOUT_MS === 8000 && DEFAULT_TOTAL_DEADLINE_MS === 15000
  );

  /* C — deterministic-sufficient short-circuit */
  {
    const { calls, transport } = spyTransport([async () => ({ candidate: {} })]);
    const r = rig({ det: cleanDet, detAdvance: 120, transport });
    const env = await hybridParse(mkReq(snapshot), r.deps);
    t("C1 engine deterministic", env.provenance?.engine === "deterministic");
    t("C2 transport NOT called", calls.length === 0);
    t("C3 review NOT called", r.reviewCalls.length === 0);
    t(
      "C4 envelope valid + provenance stamped",
      isParseEnvelope(env) &&
        env.provenance?.parserVersion === PARSER_ENGINE_VERSION &&
        env.provenance?.generation === 3 &&
        env.provenance?.requestId === "req-42" &&
        env.provenance?.contextSnapshotId === "ctx-test-1" &&
        env.provenance?.vocabularyHash === "v-abc123"
    );
    t(
      "C5 deterministic parse received snapshot-projected options",
      JSON.stringify(r.detCalls[0].options) === JSON.stringify(snapshotToParseOptions(snapshot))
    );
    t("C6 no fallbackReason on the pure path", env.provenance?.fallbackReason === undefined);
  }

  /* D — no transport configured (deterministic-only mode, nothing failed) */
  {
    const r = rig({ det: gappyDet });
    const env = await hybridParse(mkReq(snapshot), r.deps);
    t(
      "D1 no-transport mode is deterministic, never fallback",
      env.provenance?.engine === "deterministic" && env.provenance?.fallbackReason === undefined
    );
    t(
      "D2 gaps survive verbatim",
      env.unresolved.length === 1 &&
        env.uncovered[0] === "assign to santa claus" &&
        env.ambiguities.length === 1
    );
    t(
      "D3 one outcome event, engine deterministic",
      r.events.length === 1 &&
        r.events[0].name === "parse-outcome" &&
        r.events[0].dimensions.engine === "deterministic"
    );
  }

  /* E — AI candidate accepted */
  {
    const aiResult: ParseResult = {
      rule: mkRule("Omar"),
      notes: ["ai"],
      unresolved: [],
      uncovered: [],
      ambiguities: [],
    };
    const candidate = { rule: { marker: "raw-candidate" } };
    const { calls, transport } = spyTransport([
      async () => ({
        candidate,
        meta: { provider: "gateway", model: "gemini-test", promptVersion: "p7", latencyMs: 12 },
      }),
    ]);
    const r = rig({ det: gappyDet, review: () => accepted(aiResult), transport });
    const env = await hybridParse(
      mkReq(snapshot, { baseOptions: { allowUnbackedValues: true } }),
      r.deps
    );
    t("E1 engine ai", env.provenance?.engine === "ai");
    t("E2 transport called once, no repairHint", calls.length === 1 && !("repairHint" in calls[0]));
    t(
      "E3 transport meta copied onto provenance",
      env.provenance?.model === "gemini-test" &&
        env.provenance?.promptVersion === "p7" &&
        env.provenance?.provider === "gateway"
    );
    t("E4 accepted result is the envelope body", env.rule === aiResult.rule && env.notes[0] === "ai");
    const ri = r.reviewCalls[0];
    t(
      "E5 review input carries candidate/sourceText/deterministic",
      ri.candidate === candidate &&
        ri.sourceText === TEXT &&
        (ri.deterministic as ParseResult).uncovered[0] === "assign to santa claus"
    );
    t(
      "E6 review input options are the projection; snapshot passed through",
      JSON.stringify(ri.options) ===
        JSON.stringify(snapshotToParseOptions(snapshot, { allowUnbackedValues: true })) &&
        ri.snapshot === snapshot
    );
    t(
      "E7 wire options and review options agree",
      JSON.stringify(calls[0].options) === JSON.stringify(ri.options)
    );
  }

  /* F — accepted with deterministic augmentation → hybrid */
  {
    const aiResult = { ...gappyDet(), rule: mkRule("Sara") } as ParseResult;
    const { transport } = spyTransport([async () => ({ candidate: {} })]);
    const r = rig({ det: gappyDet, review: () => accepted(aiResult, true), transport });
    const env = await hybridParse(mkReq(snapshot), r.deps);
    t("F1 augmented acceptance labels engine hybrid", env.provenance?.engine === "hybrid");
  }

  /* G — structural reject → single repair → accept */
  {
    const aiResult: ParseResult = {
      rule: mkRule("Repaired"),
      notes: [],
      unresolved: [],
      uncovered: [],
      ambiguities: [],
    };
    const defect =
      "top-level candidate is a JSON array, expected object\nwith rule/notes keys " + "y".repeat(300);
    const { calls, transport } = spyTransport([
      async () => ({ candidate: { bad: true }, meta: { model: "m1" } }),
      async () => ({ candidate: { good: true }, meta: { model: "m2", promptVersion: "p8" } }),
    ]);
    const r = rig({
      det: gappyDet,
      review: (_input, call) => (call === 1 ? rejectedStructural(defect) : accepted(aiResult)),
      transport,
    });
    const env = await hybridParse(mkReq(snapshot), r.deps);
    t(
      "G1 engine ai after successful repair",
      env.provenance?.engine === "ai" && env.rule === aiResult.rule
    );
    t("G2 transport called exactly twice", calls.length === 2, String(calls.length));
    t(
      "G3 first request clean, second carries repairHint",
      !("repairHint" in calls[0]) && typeof calls[1].repairHint === "string"
    );
    const hint = calls[1].repairHint as string;
    t(
      "G4 wire repairHint sanitized (≤200 chars, no newlines)",
      hint.length <= REPAIR_HINT_MAX_CHARS && !/[\r\n]/.test(hint)
    );
    t(
      "G5 repair request keeps text/options/ids",
      calls[1].text === TEXT &&
        calls[1].requestId === "req-42" &&
        calls[1].contextSnapshotId === "ctx-test-1" &&
        JSON.stringify(calls[1].options) === JSON.stringify(calls[0].options)
    );
    t(
      "G6 provenance meta comes from the accepted (second) response",
      env.provenance?.model === "m2" && env.provenance?.promptVersion === "p8"
    );
    t(
      "G7 both candidates reviewed, in order",
      r.reviewCalls.length === 2 && r.reviewCalls[0].candidate !== r.reviewCalls[1].candidate
    );
  }

  /* H — structural reject → repair reject → fallback repair-failed */
  {
    const { calls, transport } = spyTransport([
      async () => ({ candidate: {} }),
      async () => ({ candidate: {} }),
    ]);
    const r = rig({
      det: gappyDet,
      review: (_i, call) => (call === 1 ? rejectedStructural("bad shape") : rejectedSemantic("still bad")),
      transport,
    });
    const env = await hybridParse(mkReq(snapshot), r.deps);
    t(
      "H1 fallback repair-failed",
      env.provenance?.engine === "deterministic-fallback" &&
        env.provenance?.fallbackReason === "repair-failed"
    );
    t("H2 transport called exactly twice (budget of one repair)", calls.length === 2);
    const ref = gappyDet();
    t(
      "H3 fallback carries det's sidecars unchanged",
      env.rule === null &&
        JSON.stringify(env.unresolved) === JSON.stringify(ref.unresolved) &&
        JSON.stringify(env.uncovered) === JSON.stringify(ref.uncovered) &&
        JSON.stringify(env.ambiguities) === JSON.stringify(ref.ambiguities)
    );
    t("H4 fallback envelope passes isParseEnvelope", isParseEnvelope(env));
  }

  /* I — semantic reject: no repair, ever */
  {
    const { calls, transport } = spyTransport([async () => ({ candidate: {} })]);
    const r = rig({
      det: gappyDet,
      review: () => rejectedSemantic("entity not in registry"),
      transport,
    });
    const env = await hybridParse(mkReq(snapshot), r.deps);
    t(
      "I1 semantic rejection → ungrounded-candidate fallback",
      env.provenance?.engine === "deterministic-fallback" &&
        env.provenance?.fallbackReason === "ungrounded-candidate"
    );
    t(
      "I2 transport called exactly ONCE — semantics never earn a repair",
      calls.length === 1 && r.reviewCalls.length === 1
    );
  }

  /* J — per-attempt timeout (10 ms budget vs 50 ms transport) */
  {
    const { calls, transport } = spyTransport([
      async () => {
        await delay(50);
        return { candidate: {} };
      },
    ]);
    const r = rig({ det: gappyDet, review: () => accepted(cleanDet()), transport });
    const env = await hybridParse(mkReq(snapshot, { attemptTimeoutMs: 10 }), r.deps);
    t(
      "J1 slow transport → fallback timeout",
      env.provenance?.engine === "deterministic-fallback" &&
        env.provenance?.fallbackReason === "timeout"
    );
    t("J2 transport called once, review never", calls.length === 1 && r.reviewCalls.length === 0);
    t(
      "J3 envelope body is the deterministic result",
      env.rule === null && env.uncovered[0] === "assign to santa claus"
    );
  }

  /* K — transport rejection */
  {
    const { transport } = spyTransport([
      async () => {
        throw new Error("boom");
      },
    ]);
    const r = rig({ det: gappyDet, transport });
    const env = await hybridParse(mkReq(snapshot), r.deps);
    t("K1 transport error → fallback transport", env.provenance?.fallbackReason === "transport");
  }

  /* L — transport resolved with a malformed response */
  {
    const { transport } = spyTransport([async () => ({})]);
    const r = rig({ det: gappyDet, transport });
    const env = await hybridParse(mkReq(snapshot), r.deps);
    t(
      "L1 response without candidate → invalid-structure",
      env.provenance?.fallbackReason === "invalid-structure"
    );
  }

  /* M — external abort mid-transport: throws, never a stale fallback */
  {
    const controller = new AbortController();
    const { transport } = spyTransport([() => new Promise(() => {})]);
    const r = rig({ det: gappyDet, transport });
    const pending = hybridParse(mkReq(snapshot), r.deps, controller.signal);
    setTimeout(() => controller.abort(), 5);
    let thrown: unknown = null;
    try {
      await pending;
    } catch (e) {
      thrown = e;
    }
    t("M1 abort mid-transport THROWS (no envelope)", thrown !== null);
    t(
      "M2 thrown error is BrainAbortError",
      thrown instanceof BrainAbortError && (thrown as Error).name === "BrainAbortError"
    );
    t("M3 no outcome telemetry for an aborted parse", r.events.length === 0);
  }

  /* N — total deadline exhausted before the repair */
  {
    const { calls, transport } = spyTransport([async () => ({ candidate: {} })]);
    const r = rig({
      det: gappyDet,
      review: () => rejectedStructural("broken"),
      reviewAdvance: 6000, // injected clock jumps past totalDeadlineMs during review
      transport,
    });
    const env = await hybridParse(mkReq(snapshot, { totalDeadlineMs: 5000 }), r.deps);
    t("N1 no second transport call once the deadline is spent", calls.length === 1);
    t(
      "N2 fallback reports the structural defect itself",
      env.provenance?.engine === "deterministic-fallback" &&
        env.provenance?.fallbackReason === "invalid-structure"
    );
  }

  /* O — telemetry hygiene across outcomes */
  {
    const runs: Rig[] = [];
    {
      const r = rig({ det: cleanDet });
      await hybridParse(mkReq(snapshot), r.deps);
      runs.push(r);
    }
    {
      const { transport } = spyTransport([async () => ({ candidate: {} })]);
      const r = rig({ det: gappyDet, review: () => accepted(cleanDet()), transport });
      await hybridParse(mkReq(snapshot), r.deps);
      runs.push(r);
    }
    {
      const { transport } = spyTransport([
        async () => {
          throw new Error("x");
        },
      ]);
      const r = rig({ det: gappyDet, transport });
      await hybridParse(mkReq(snapshot), r.deps);
      runs.push(r);
    }
    const events = runs.flatMap((run) => run.events);
    t(
      "O1 exactly one parse-outcome event per parse",
      runs.every((run) => run.events.length === 1) &&
        events.every((event) => event.name === "parse-outcome")
    );
    const dimValues = events.flatMap((event) => Object.values(event.dimensions).map(String));
    t(
      "O2 every dimension value is enum-like",
      dimValues.every((value) => /^[a-z0-9|_-]+$/i.test(value)),
      JSON.stringify(dimValues)
    );
    t(
      "O3 no raw author text leaks into dimensions",
      dimValues.every((value) => !value.includes("loan") && !value.includes("santa"))
    );
    t(
      "O4 buckets and reasons come from closed sets",
      events.every((event) =>
        ["lt500", "lt2000", "lt8000", "gte8000"].includes(String(event.dimensions.latencyBucket))
      ) &&
        runs[1].events[0].dimensions.engine === "ai" &&
        runs[2].events[0].dimensions.fallbackReason === "transport"
    );
  }

  /* P — injected clock drives every latency figure */
  {
    const clock = new FakeClock();
    const { transport } = spyTransport([
      async () => {
        clock.advance(300);
        return { candidate: {} };
      },
    ]);
    const r = rig({
      det: gappyDet,
      detAdvance: 120,
      review: () => accepted(cleanDet()),
      reviewAdvance: 40,
      transport,
      clock,
    });
    const env = await hybridParse(mkReq(snapshot), r.deps);
    t(
      "P1 latency.totalMs comes from the injected clock",
      env.provenance?.latency?.totalMs === 460,
      String(env.provenance?.latency?.totalMs)
    );
    t(
      "P2 per-stage latencies come from the injected clock",
      env.provenance?.latency?.stages.deterministic === 120 &&
        env.provenance?.latency?.stages.transport === 300 &&
        env.provenance?.latency?.stages.review === 40,
      JSON.stringify(env.provenance?.latency?.stages)
    );
    t("P3 createdAt is the clock reading at finish", env.provenance?.createdAt === clock.now());
    t("P4 latency bucket reflects the fake total", r.events[0].dimensions.latencyBucket === "lt500");
  }

  /* Q — deterministicOnlyEnvelope entry point */
  {
    const r = rig({ det: cleanDet, detAdvance: 50 });
    const env = deterministicOnlyEnvelope(TEXT, snapshot, r.deps, 9, "req-d");
    t(
      "Q1 deterministic-only engine + provenance stamped",
      env.provenance?.engine === "deterministic" &&
        env.provenance?.generation === 9 &&
        env.provenance?.requestId === "req-d" &&
        env.provenance?.parserVersion === PARSER_ENGINE_VERSION &&
        env.provenance?.contextSnapshotId === "ctx-test-1"
    );
    t("Q2 valid envelope with the deterministic rule", isParseEnvelope(env) && env.rule !== null);
    t(
      "Q3 one outcome event",
      r.events.length === 1 && r.events[0].dimensions.engine === "deterministic"
    );
  }

  if (failures > 0) {
    console.error(`\n✗ assert-parser-engine-hybrid: ${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\n✓ hybrid orchestration honors the mandate: deterministic first, one bounded repair, fail-closed fallback.");
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
