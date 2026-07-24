/**
 * ports — every dependency the Workflow Brain has on its host, as interfaces.
 *
 * Dependency direction (architecture mandate):
 *
 *   @sweet/rule-core  ←  @sweet/workflow-brain  ←  host adapters
 *
 * The Brain imports rule-core and NOTHING else concrete: no Angular, no DOM,
 * no storage, no HttpClient, no provider SDK, no demo data, no clock, no
 * randomness. Hosts hand implementations of these ports to the Brain at its
 * composition root. `core-tests/assert-workflow-brain-purity.ts` pins this.
 *
 * Interface freeze authored by honeycomb-lead (2026-07-24).
 */

import { ParseOptions, ParseResult } from "../../rule-core/src/nlParser";
import {
  BrainContextSnapshot,
  ContextInvalidationEvent,
  ContextRequest,
  ContextSearchRequest,
  ContextSearchResult,
  ContextProfileId,
  EntityResolutionRequest,
  EntityResolutionResult,
} from "./context";

export type Unsubscribe = () => void;

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The replaceable context window. Standalone/demo and Landjourney-live
 * adapters implement the SAME contract (shared suite:
 * core-tests/assert-brain-context-contract.ts) and are selected by the host
 * composition root — never by `if (demo)` branches inside the Brain.
 */
export interface WorkflowBrainContextProvider {
  /** Which profile this provider serves. Switching profiles = switching providers or re-configuring one. */
  readonly profile: ContextProfileId;
  getSnapshot(request: ContextRequest, signal?: AbortSignal): Promise<BrainContextSnapshot>;
  search(request: ContextSearchRequest, signal?: AbortSignal): Promise<ContextSearchResult>;
  resolveEntity(request: EntityResolutionRequest, signal?: AbortSignal): Promise<EntityResolutionResult>;
  subscribe?(listener: (event: ContextInvalidationEvent) => void): Unsubscribe;
}

/* -------------------------------------------------------------------------- */
/* AI transports (wire contracts live with their owners)                      */
/* -------------------------------------------------------------------------- */

/**
 * Provider-neutral parse transport. The host adapter is the only place that
 * knows the transport is `POST workflows/parse-ai` through ApiService; the
 * Brain sees this interface and a `ParseResult`-shaped candidate that it
 * treats as UNTRUSTED INPUT (candidateNormalization.ts).
 *
 * Absent transport (undefined port) = deterministic-only mode; the Brain must
 * behave fully with zero provider configuration.
 */
export interface AiParseTransport {
  parse(request: AiParseTransportRequest, signal?: AbortSignal): Promise<AiParseTransportResponse>;
}

export interface AiParseTransportRequest {
  text: string;
  /** Same options the deterministic parser takes — the wire contract the backend already consumes. */
  options: ParseOptions;
  /** Correlation id (host-generated, no customer data). */
  requestId: string;
  /** Snapshot the options were derived from — echoed back for staleness checks. */
  contextSnapshotId: string;
  /**
   * Present ONLY on the single bounded repair attempt after a STRUCTURAL
   * defect (invalid JSON/schema). Never used to ask the model for missing
   * business intent — that is a clarification, not a repair.
   */
  repairHint?: string;
}

export interface AiParseTransportResponse {
  /** UNTRUSTED candidate in ParseResult shape. Never used without normalization + re-grounding. */
  candidate: unknown;
  /** Transport metadata when the backend provides it (never secrets). */
  meta?: {
    provider?: string;
    model?: string;
    promptVersion?: string;
    latencyMs?: number;
  };
}

/* -------------------------------------------------------------------------- */
/* Capabilities (fail-closed)                                                 */
/* -------------------------------------------------------------------------- */

export type BrainCapability =
  | "parse-ai"
  | "ghost-suggestions-ai"
  | "consultant-ai"
  | "live-vocabulary"
  | "simulation-data";

/**
 * Host-provided authorization surface. Missing capability = the feature is
 * OFF (fail closed) — the Brain must degrade to deterministic behavior, never
 * assume, and never escalate. Profiles must not grant capabilities.
 */
export interface HostCapabilityPort {
  has(capability: BrainCapability): boolean;
}

/* -------------------------------------------------------------------------- */
/* Determinism ports                                                          */
/* -------------------------------------------------------------------------- */

/** Injected clock — the Brain never calls Date.now() directly. */
export interface BrainClock {
  /** Epoch milliseconds. */
  now(): number;
}

/**
 * Privacy-safe telemetry. Dimension values are enum-like strings/numbers ONLY —
 * never author text, tenant vocabulary, customer data, prompts, or provider
 * payloads. observability.ts enforces a dimension allowlist on top of this.
 */
export interface BrainTelemetrySink {
  event(name: string, dimensions?: Record<string, string | number | boolean>): void;
}

/* -------------------------------------------------------------------------- */
/* Composition root input                                                     */
/* -------------------------------------------------------------------------- */

/** Everything a host supplies to create a Brain session. */
export interface BrainPorts {
  context: WorkflowBrainContextProvider;
  capabilities: HostCapabilityPort;
  clock: BrainClock;
  /** Optional — absent means deterministic-only parsing. */
  aiParse?: AiParseTransport;
  /** Optional — absent means telemetry is dropped. */
  telemetry?: BrainTelemetrySink;
}

/** Re-used across modules: a deterministic result of racing a signal. */
export function throwIfAborted(signal: AbortSignal | undefined, where: string): void {
  if (signal?.aborted) {
    throw new BrainAbortError(where);
  }
}

/** Abort surfaced as a typed error so orchestration can distinguish it from failures. */
export class BrainAbortError extends Error {
  readonly aborted = true;
  constructor(where: string) {
    super(`aborted: ${where}`);
    this.name = "BrainAbortError";
  }
}
