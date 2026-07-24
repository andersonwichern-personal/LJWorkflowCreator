/**
 * aiPort — deterministic request assembly for the AI parse transport.
 *
 * Thin on purpose. Everything here is a pure function of its inputs: the
 * orchestrator owns timing, the single bounded repair, and fallback policy;
 * the host adapter owns the wire. This module only shapes
 * AiParseTransportRequest payloads and classifies transport failures into the
 * closed set the orchestrator acts on.
 *
 * Repair hints are SAFE structural descriptions authored by our own reviewer
 * (candidateNormalization) — never model output copied verbatim.
 * buildRepairRequest enforces that mechanically: newlines and control
 * whitespace collapsed to single spaces, hard cap of
 * {@link REPAIR_HINT_MAX_CHARS} characters.
 */
import type { ParseOptions } from "../../rule-core/src/nlParser";
import type { BrainContextSnapshot } from "./context";
import type { AiParseTransportRequest } from "./ports";
import { BrainAbortError } from "./ports";
import { snapshotToParseOptions } from "./contextCompiler";

/** Correlation record for one in-flight AI parse attempt. */
export interface AiParseCall {
  text: string;
  options: ParseOptions;
  requestId: string;
  contextSnapshotId: string;
}

/** Hard cap on repair-hint length — hints are short descriptions, never payloads. */
export const REPAIR_HINT_MAX_CHARS = 200;

/**
 * Assemble the first-attempt transport request. Options are projected from the
 * context snapshot (the same projection the deterministic parse uses), so the
 * backend grounds against exactly the vocabulary this session was shown.
 */
export function buildParseRequest(
  text: string,
  snapshot: BrainContextSnapshot,
  requestId: string,
  base?: ParseOptions
): AiParseTransportRequest {
  return {
    text,
    options: snapshotToParseOptions(snapshot, base),
    requestId,
    contextSnapshotId: snapshot.snapshotId,
  };
}

/**
 * Same payload as the prior request plus a sanitized `repairHint`. The defect
 * MUST already be a safe structural description (reviewer-authored); this
 * function still strips newlines, collapses whitespace, and truncates to
 * {@link REPAIR_HINT_MAX_CHARS} so no caller mistake can widen the channel.
 */
export function buildRepairRequest(
  prior: AiParseTransportRequest,
  defect: string
): AiParseTransportRequest {
  return { ...prior, repairHint: sanitizeRepairHint(defect) };
}

function sanitizeRepairHint(defect: string): string {
  return defect.replace(/\s+/g, " ").trim().slice(0, REPAIR_HINT_MAX_CHARS);
}

/** Failure classes the orchestrator maps to fallback reasons. */
export type TransportErrorClass = "timeout" | "aborted" | "transport" | "shape";

/**
 * Deadline marker the orchestrator races against the transport. Carries a
 * boolean flag (not just a name) so classification survives duplicated module
 * instances (package path vs vendored copy).
 */
export class TransportTimeoutError extends Error {
  readonly timedOut = true;
  constructor(where: string) {
    super(`timeout: ${where}`);
    this.name = "TransportTimeoutError";
  }
}

/**
 * BrainAbortError → "aborted"; TransportTimeoutError → "timeout"; anything
 * else a transport threw → "transport". "shape" is never produced here: the
 * orchestrator assigns it when a RESOLVED response fails its shape gate, which
 * is not a thrown error. The duck checks keep classification correct when the
 * error crossed a realm or a duplicated module boundary.
 */
export function classifyTransportError(e: unknown): TransportErrorClass {
  if (e instanceof BrainAbortError) return "aborted";
  if (e instanceof TransportTimeoutError) return "timeout";
  if (typeof e === "object" && e !== null) {
    const marked = e as { aborted?: unknown; timedOut?: unknown; name?: unknown };
    if (marked.aborted === true || marked.name === "BrainAbortError") return "aborted";
    if (marked.timedOut === true || marked.name === "TransportTimeoutError") return "timeout";
  }
  return "transport";
}
