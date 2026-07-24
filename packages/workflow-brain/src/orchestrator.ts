/**
 * orchestrator — the hybrid parse strategy of the Workflow Brain.
 *
 * Deterministic first, always: the injected rule-core parser runs before any
 * transport is touched, and its result is the floor every other path stands
 * on. The AI candidate is UNTRUSTED (ports.ts): it goes through the injected
 * reviewer (candidateNormalization) and is either accepted or the whole AI
 * path fails closed onto the deterministic result — which is always a valid
 * ParseEnvelope with honest sidecars.
 *
 * Behavior mandate implemented here (each number is pinned by
 * core-tests/assert-parser-engine-hybrid.ts):
 *  1. deterministic parse first, options projected from the context snapshot;
 *  2. no gaps → engine "deterministic", the transport is never called;
 *  3. no transport configured → engine "deterministic" (nothing failed, so
 *     never "deterministic-fallback");
 *  4. per-attempt timeout raced via setTimeout; an external abort propagates
 *     as BrainAbortError and is NEVER swallowed into a fallback envelope — a
 *     newer submission must not receive a stale fallback;
 *  5-6. candidate → injected review; accepted → engine "ai" or "hybrid";
 *  7. exactly ONE repair attempt, only for STRUCTURAL rejections, and only
 *     while the total deadline still has room; never a repair for semantic or
 *     grounding rejections — those are clarifications, not defects;
 *  8. every failure path returns the deterministic result with engine
 *     "deterministic-fallback" and a fallbackReason;
 *  9. one privacy-safe telemetry event per outcome (none on abort — an
 *     aborted parse is a caller decision, not an outcome);
 * 10. full provenance stamped from the injected clock.
 *
 * Engine "ai" vs "hybrid" (documented rule): the reviewer is the only
 * component holding the coverage machinery needed to judge whether
 * deterministic sidecar entries still apply to the AI rule, so any merge of
 * deterministic sidecars happens inside review; an accepted verdict carrying
 * `augmentedFromDeterministic: true` is labeled "hybrid", otherwise "ai".
 *
 * fallbackReason (documented rule): first-attempt failures keep their class —
 * "timeout" | "transport" | "invalid-structure" | "ungrounded-candidate"
 * (structural rejection with no repair budget left also reports the defect
 * itself, "invalid-structure"). Once the single repair attempt starts, every
 * non-abort failure of that attempt — transport error, timeout, malformed
 * response, either rejection class — reports "repair-failed": the reason
 * answers "why did the AI path ultimately fail", and on that path the answer
 * is that the one bounded repair did not produce an accepted candidate.
 * Latency stages retain the finer detail.
 */
import type { ParseOptions, ParseResult } from "../../rule-core/src/nlParser";
import { isParseEnvelope, makeEnvelope, PARSER_ENGINE_VERSION } from "../../rule-core/src/parserProvenance";
import type { EngineMode, ParseEnvelope, ParserProvenance } from "../../rule-core/src/parserProvenance";
import type { BrainContextSnapshot } from "./context";
import { BrainAbortError, throwIfAborted } from "./ports";
import type {
  AiParseTransport,
  AiParseTransportRequest,
  AiParseTransportResponse,
  BrainClock,
  BrainTelemetrySink,
} from "./ports";
import { buildParseRequest, buildRepairRequest, classifyTransportError, TransportTimeoutError } from "./aiPort";
import { snapshotToParseOptions } from "./contextCompiler";
import { vocabFromContext } from "./candidateNormalization";
import type { CandidateReviewInput, CandidateVerdict } from "./candidateNormalization";
import { segmentInstruction } from "../../rule-core/src/parserClauses";
import { clauseCoverage } from "../../rule-core/src/parserCoverage";

/** Suggested per-attempt budget for hosts. Callers still pass a value explicitly. */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 8000;
/** Suggested total budget for hosts. Callers still pass a value explicitly. */
export const DEFAULT_TOTAL_DEADLINE_MS = 15000;

/** Closed set of reasons a hybrid parse fell back to the deterministic result. */
export type HybridFallbackReason =
  | "timeout"
  | "transport"
  | "invalid-structure"
  | "ungrounded-candidate"
  | "repair-failed";

export interface HybridDeps {
  /** Injected reviewer (candidateNormalization at composition; stubs in tests). */
  review: (input: CandidateReviewInput) => CandidateVerdict;
  /** Normally rule-core parseInstruction; injected for testability. */
  deterministicParse: (text: string, options: ParseOptions) => ParseResult;
  clock: BrainClock;
  /** Absent = deterministic-only mode. */
  transport?: AiParseTransport;
  telemetry?: BrainTelemetrySink;
}

export interface HybridParseRequest {
  text: string;
  snapshot: BrainContextSnapshot;
  generation: number;
  requestId: string;
  baseOptions?: ParseOptions;
  /** Per-attempt transport budget — caller-supplied, no hidden default. */
  attemptTimeoutMs: number;
  /** Whole-parse budget; the repair attempt only starts while time remains. */
  totalDeadlineMs: number;
}

/** True iff the deterministic result left gaps an AI candidate could close. */
export function needsAi(det: ParseResult): boolean {
  return (
    det.rule === null ||
    det.unresolved.length > 0 ||
    det.uncovered.length > 0 ||
    det.ambiguities.length > 0
  );
}

/* -------------------------------------------------------------------------- */
/* Outcome assembly                                                           */
/* -------------------------------------------------------------------------- */

function latencyBucket(totalMs: number): string {
  if (totalMs < 500) return "lt500";
  if (totalMs < 2000) return "lt2000";
  if (totalMs < 8000) return "lt8000";
  return "gte8000";
}

interface OutcomeArgs {
  engine: EngineMode;
  result: ParseResult;
  fallbackReason?: HybridFallbackReason;
  meta?: AiParseTransportResponse["meta"];
  startedAt: number;
  stages: Record<string, number>;
  generation: number;
  requestId: string;
  snapshot: BrainContextSnapshot;
  deps: HybridDeps;
}

/**
 * Stamp provenance, wrap the result (makeEnvelope keeps the honesty sidecars
 * verbatim), and emit exactly one privacy-safe telemetry event. Transport meta
 * is copied onto provenance only for AI-produced results — provenance
 * documents provider/model as AI-path fields.
 */
function finishOutcome(a: OutcomeArgs): ParseEnvelope {
  const finishedAt = a.deps.clock.now();
  const totalMs = finishedAt - a.startedAt;
  const provenance: ParserProvenance = {
    engine: a.engine,
    parserVersion: PARSER_ENGINE_VERSION,
    generation: a.generation,
    requestId: a.requestId,
    contextSnapshotId: a.snapshot.snapshotId,
    vocabularyHash: a.snapshot.vocabularyHash,
    createdAt: finishedAt,
    latency: { totalMs, stages: a.stages },
  };
  if (a.fallbackReason !== undefined) provenance.fallbackReason = a.fallbackReason;
  if (a.engine === "ai" || a.engine === "hybrid") {
    if (a.meta?.provider !== undefined) provenance.provider = a.meta.provider;
    if (a.meta?.model !== undefined) provenance.model = a.meta.model;
    if (a.meta?.promptVersion !== undefined) provenance.promptVersion = a.meta.promptVersion;
  }
  const envelope = makeEnvelope(a.result, { provenance });
  const dimensions: Record<string, string | number | boolean> = {
    engine: a.engine,
    latencyBucket: latencyBucket(totalMs),
  };
  if (a.fallbackReason !== undefined) dimensions.fallbackReason = a.fallbackReason;
  a.deps.telemetry?.event("parse-outcome", dimensions);
  return envelope;
}

/**
 * Deterministic-only entry point: parse with snapshot-projected options and
 * stamp an engine "deterministic" envelope. Used by hosts running with no
 * transport at all; hybridParse embeds the same behavior for its short-circuit
 * paths without re-parsing.
 */
export function deterministicOnlyEnvelope(
  text: string,
  snapshot: BrainContextSnapshot,
  deps: HybridDeps,
  generation: number,
  requestId: string
): ParseEnvelope {
  const startedAt = deps.clock.now();
  const stages: Record<string, number> = {};
  const detStart = deps.clock.now();
  const det = deps.deterministicParse(text, snapshotToParseOptions(snapshot));
  stages.deterministic = deps.clock.now() - detStart;
  return finishOutcome({
    engine: "deterministic",
    result: det,
    startedAt,
    stages,
    generation,
    requestId,
    snapshot,
    deps,
  });
}

/* -------------------------------------------------------------------------- */
/* Verdict reading                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Reads the landed candidateNormalization CandidateVerdict:
 *   | { accepted: true; result: ParseResult; repairs: string[] }
 *   | { accepted: false; structural: boolean; reason: string }
 * A repaired-but-accepted candidate (repairs.length > 0) is labeled "hybrid" —
 * the reviewer altered the model's output using deterministic machinery.
 * Reading fails closed: anything unreadable — including an accepted verdict
 * whose result is not ParseResult-shaped — becomes a NON-structural rejection,
 * so the repair budget is never spent on a defect we cannot describe.
 */
type VerdictReading =
  | { kind: "accepted"; result: ParseResult; augmented: boolean }
  | { kind: "rejected"; structural: boolean; defect: string };

function readVerdict(verdict: CandidateVerdict): VerdictReading {
  const raw = verdict as unknown as Record<string, unknown> | null;
  if (typeof raw === "object" && raw !== null) {
    if (raw.accepted === true && isParseEnvelope(raw.result)) {
      return {
        kind: "accepted",
        result: raw.result as ParseResult,
        augmented: Array.isArray(raw.repairs) && raw.repairs.length > 0,
      };
    }
    if (raw.accepted === false) {
      return {
        kind: "rejected",
        structural: raw.structural === true,
        defect:
          typeof raw.reason === "string" && raw.reason.length > 0
            ? raw.reason
            : "structural defect (unspecified)",
      };
    }
  }
  return { kind: "rejected", structural: false, defect: "unreadable-verdict" };
}

/* -------------------------------------------------------------------------- */
/* Timeout racing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Race one transport attempt against its deadline. setTimeout is the one
 * scheduling primitive the Brain may use, and the deadline itself is
 * caller-supplied (attemptTimeoutMs) so tests inject tiny real delays instead
 * of faking timers. The external signal wins over everything and surfaces as
 * BrainAbortError; the timer is always cleared on settle.
 */
function callWithTimeout(
  transport: AiParseTransport,
  request: AiParseTransportRequest,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  where: string
): Promise<AiParseTransportResponse> {
  throwIfAborted(signal, where);
  return new Promise<AiParseTransportResponse>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => settle(() => reject(new BrainAbortError(where)));
    const timer = setTimeout(() => settle(() => reject(new TransportTimeoutError(where))), timeoutMs);
    signal?.addEventListener("abort", onAbort);
    Promise.resolve()
      .then(() => transport.parse(request, signal))
      .then(
        (response) => settle(() => resolve(response)),
        (error) => settle(() => reject(error))
      );
  });
}

/** Abort is a caller decision, never a failure: propagate it, do not fall back. */
function rethrowIfAbort(error: unknown, signal: AbortSignal | undefined, where: string): void {
  throwIfAborted(signal, where);
  if (classifyTransportError(error) === "aborted") {
    throw error instanceof BrainAbortError ? error : new BrainAbortError(where);
  }
}

/** The transport resolved, but with something that is not a response envelope. */
function hasCandidate(response: unknown): response is AiParseTransportResponse {
  return typeof response === "object" && response !== null && "candidate" in response;
}

/* -------------------------------------------------------------------------- */
/* The hybrid strategy                                                        */
/* -------------------------------------------------------------------------- */

export async function hybridParse(
  req: HybridParseRequest,
  deps: HybridDeps,
  signal?: AbortSignal
): Promise<ParseEnvelope> {
  const startedAt = deps.clock.now();
  const stages: Record<string, number> = {};
  throwIfAborted(signal, "hybrid-parse");

  /* 1 — deterministic first, options projected from the snapshot. */
  const options = snapshotToParseOptions(req.snapshot, req.baseOptions);
  const detStart = deps.clock.now();
  const det = deps.deterministicParse(req.text, options);
  stages.deterministic = deps.clock.now() - detStart;

  const finish = (
    engine: EngineMode,
    result: ParseResult,
    fallbackReason?: HybridFallbackReason,
    meta?: AiParseTransportResponse["meta"]
  ): ParseEnvelope =>
    finishOutcome({
      engine,
      result,
      fallbackReason,
      meta,
      startedAt,
      stages,
      generation: req.generation,
      requestId: req.requestId,
      snapshot: req.snapshot,
      deps,
    });

  /* 2 — whole, unambiguous, covered: the AI adds nothing. */
  if (!needsAi(det)) return finish("deterministic", det);
  /* 3 — no transport configured: deterministic-only mode, nothing failed. */
  const transport = deps.transport;
  if (!transport) return finish("deterministic", det);

  // Landed CandidateReviewInput keys, plus pass-through extras (snapshot,
  // options, requestId, attempt) that reviewers ignore and telemetry/tests use.
  const clauses = segmentInstruction(req.text).clauses;
  const reviewInput = (candidate: unknown, attempt: number): CandidateReviewInput =>
    ({
      candidate,
      sourceText: req.text,
      clauses,
      vocab: vocabFromContext(req.snapshot),
      baseOptions: req.baseOptions,
      deterministic: det,
      coverage: clauseCoverage,
      snapshot: req.snapshot,
      options,
      requestId: req.requestId,
      attempt,
    }) as unknown as CandidateReviewInput;

  /* 4 — attempt 1, raced against the per-attempt deadline. */
  const firstRequest = buildParseRequest(req.text, req.snapshot, req.requestId, req.baseOptions);
  let first: AiParseTransportResponse;
  const transportStart = deps.clock.now();
  try {
    first = await callWithTimeout(transport, firstRequest, req.attemptTimeoutMs, signal, "ai-parse");
  } catch (error) {
    stages.transport = deps.clock.now() - transportStart;
    rethrowIfAbort(error, signal, "ai-parse");
    return finish(
      "deterministic-fallback",
      det,
      classifyTransportError(error) === "timeout" ? "timeout" : "transport"
    );
  }
  stages.transport = deps.clock.now() - transportStart;
  if (!hasCandidate(first)) return finish("deterministic-fallback", det, "invalid-structure");

  /* 5-6 — review the untrusted candidate. */
  const reviewStart = deps.clock.now();
  const verdict = readVerdict(deps.review(reviewInput(first.candidate, 0)));
  stages.review = deps.clock.now() - reviewStart;
  if (verdict.kind === "accepted") {
    return finish(verdict.augmented ? "hybrid" : "ai", verdict.result, undefined, first.meta);
  }
  if (!verdict.structural) return finish("deterministic-fallback", det, "ungrounded-candidate");
  if (deps.clock.now() - startedAt >= req.totalDeadlineMs) {
    return finish("deterministic-fallback", det, "invalid-structure");
  }

  /* 7 — the single bounded structural repair. */
  const repairRequest = buildRepairRequest(firstRequest, verdict.defect);
  let second: AiParseTransportResponse;
  const repairStart = deps.clock.now();
  try {
    second = await callWithTimeout(
      transport,
      repairRequest,
      req.attemptTimeoutMs,
      signal,
      "ai-parse-repair"
    );
  } catch (error) {
    stages["repair-transport"] = deps.clock.now() - repairStart;
    rethrowIfAbort(error, signal, "ai-parse-repair");
    return finish("deterministic-fallback", det, "repair-failed");
  }
  stages["repair-transport"] = deps.clock.now() - repairStart;
  if (!hasCandidate(second)) return finish("deterministic-fallback", det, "repair-failed");

  const repairReviewStart = deps.clock.now();
  const repairVerdict = readVerdict(deps.review(reviewInput(second.candidate, 1)));
  stages["repair-review"] = deps.clock.now() - repairReviewStart;
  if (repairVerdict.kind === "accepted") {
    return finish(
      repairVerdict.augmented ? "hybrid" : "ai",
      repairVerdict.result,
      undefined,
      second.meta
    );
  }
  /* 8 — the repair did not produce an accepted candidate. */
  return finish("deterministic-fallback", det, "repair-failed");
}
