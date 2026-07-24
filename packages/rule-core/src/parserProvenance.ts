/**
 * parserProvenance — the additive envelope contract for parser-engine results.
 *
 * A ParseEnvelope IS a ParseResult: every existing consumer (the DraftEngine
 * shape guard, parseGate, the composer) keeps working unchanged, and everything
 * the engine adds — clause links, contradictions, provenance — rides in
 * optional sidecar fields. Transient parser metadata stays OUT of persisted
 * WorkflowRule JSON; the envelope is where it lives instead.
 *
 * makeEnvelope is the only sanctioned constructor and it cannot weaken the
 * honesty contract: the base result's rule and sidecars (notes, unresolved,
 * uncovered, ambiguities, unbacked) always win over extras, suggestions are
 * clamped to three, and undefined extras stay absent so envelopes survive
 * JSON round-trips byte-identically.
 *
 * Deterministic on purpose: nothing here reads a clock or a random source.
 * `createdAt` is an epoch-ms timestamp INJECTED by the caller — host adapters
 * own time, the core stays replayable.
 */
import type { ParseResult } from "./nlParser";
import type { ParsedClause } from "./parserClauses";

/** Bumped whenever parse semantics change — cache keys and provenance both carry it. */
export const PARSER_ENGINE_VERSION = "2026.07.24-1";

/** Which engine produced the result. `deterministic-fallback` = AI path failed closed. */
export type EngineMode = "deterministic" | "ai" | "hybrid" | "deterministic-fallback";

export interface ParserProvenance {
  engine: EngineMode;
  /** {@link PARSER_ENGINE_VERSION} at parse time. */
  parserVersion: string;
  /** AI paths only. */
  promptVersion?: string;
  /** AI paths only, from transport meta. */
  provider?: string;
  model?: string;
  /** BrainContextSnapshot.vocabularyHash the parse was grounded against. */
  vocabularyHash?: string;
  contextSnapshotId?: string;
  requestId?: string;
  /** Description generation this result belongs to — stale results are discarded by generation. */
  generation: number;
  /** Epoch ms — INJECTED clock, never a direct clock read in the core. */
  createdAt: number;
  latency?: { totalMs: number; stages: Record<string, number> };
  /** engine === "deterministic-fallback" only. */
  fallbackReason?: string;
}

export interface ClauseRuleLink {
  clauseId: string;
  /**
   * Rule paths that represent the clause: "triggers[0]", "conditions.leaf[2]",
   * "actions[1]", "else[0]", "actions[1].when", "actions[1].delayMinutes",
   * "controls.mode"…
   */
  rulePaths: string[];
  status:
    | "represented"
    | "no-op"
    | "unresolved"
    | "ambiguous"
    | "uncovered"
    | "unsupported"
    | "contradictory";
}

/**
 * Lives HERE (contract layer) so both the envelope and parserContradictions.ts
 * (which implements the detection) share one shape without a cycle.
 */
export interface ContradictionFinding {
  paths: string[];
  clauseIds: string[];
  kind:
    | "mutually-exclusive-values"
    | "empty-numeric-range"
    | "negated-and-required"
    | "duplicate-action-conflict";
  message: string;
}

/** Additive — every ParseResult consumer keeps working on an envelope unchanged. */
export interface ParseEnvelope extends ParseResult {
  clauses?: ParsedClause[];
  clauseLinks?: ClauseRuleLink[];
  unsupported?: Array<{ clauseId: string; text: string; reason: string }>;
  contradictions?: ContradictionFinding[];
  /** Clauses the parser intentionally excluded via negation — surfaced, never silently dropped. */
  negatedNoOps?: Array<{ clauseId: string; text: string }>;
  /** Max 3 — enforced by {@link makeEnvelope}. */
  suggestions?: string[];
  provenance?: ParserProvenance;
}

/** UI suggestion budget — more than this reads as noise, not help. */
const MAX_SUGGESTIONS = 3;

/**
 * The only envelope keys extras may set. Base-result keys (rule + honesty
 * sidecars) are deliberately NOT listed: an extras object carrying them is
 * ignored on those keys, so no caller can shrink `unresolved` to look ready.
 */
const ENVELOPE_EXTRA_KEYS = [
  "clauses",
  "clauseLinks",
  "unsupported",
  "contradictions",
  "negatedNoOps",
  "suggestions",
  "provenance",
] as const;

/**
 * Wrap a ParseResult into a ParseEnvelope without ever weakening it.
 *
 * - Returns a NEW object; `base` is never mutated.
 * - Every base field survives verbatim (rule, notes, unresolved, uncovered,
 *   ambiguities, unbacked) — extras cannot override them.
 * - `suggestions` is clamped to {@link MAX_SUGGESTIONS}, order preserved.
 * - Undefined extras stay ABSENT (no `key: undefined` noise) so the envelope
 *   is byte-stable across JSON round-trips.
 */
export function makeEnvelope(base: ParseResult, extras: Partial<ParseEnvelope>): ParseEnvelope {
  const out: ParseEnvelope = { ...base };
  for (const key of ENVELOPE_EXTRA_KEYS) {
    const value = extras[key];
    if (value === undefined) continue;
    if (key === "suggestions") {
      out.suggestions = (value as string[]).slice(0, MAX_SUGGESTIONS);
    } else {
      (out as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/**
 * Superset of the DraftEngine `isParseResult` shape guard: every valid plain
 * ParseResult is an envelope (the envelope IS a ParseResult), unknown extra
 * properties are tolerated (additive-compat), but known optional envelope
 * fields fail closed when present with the wrong shape.
 */
export function isParseEnvelope(v: unknown): v is ParseEnvelope {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Partial<ParseEnvelope>;
  if (!(r.rule === null || (typeof r.rule === "object" && r.rule !== undefined))) return false;
  if (!Array.isArray(r.notes)) return false;
  if (!Array.isArray(r.unresolved)) return false;
  if (!Array.isArray(r.uncovered)) return false;
  if (!Array.isArray(r.ambiguities)) return false;
  if (r.unbacked !== undefined && !Array.isArray(r.unbacked)) return false;
  if (r.clauses !== undefined && !Array.isArray(r.clauses)) return false;
  if (r.clauseLinks !== undefined && !Array.isArray(r.clauseLinks)) return false;
  if (r.unsupported !== undefined && !Array.isArray(r.unsupported)) return false;
  if (r.contradictions !== undefined && !Array.isArray(r.contradictions)) return false;
  if (r.negatedNoOps !== undefined && !Array.isArray(r.negatedNoOps)) return false;
  if (r.suggestions !== undefined && !Array.isArray(r.suggestions)) return false;
  if (r.provenance !== undefined && (typeof r.provenance !== "object" || r.provenance === null)) {
    return false;
  }
  return true;
}
