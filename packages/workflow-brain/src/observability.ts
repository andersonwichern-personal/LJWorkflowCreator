/**
 * observability — reliability plumbing for the Workflow Brain.
 *
 * Everything here is deterministic against the injected {@link BrainClock}:
 * correlation ids come from clock time + a caller-owned counter (no randomness),
 * stage timers and the circuit breaker read the injected clock only, and cache
 * keys are pure functions of their parts. The Brain never touches the wall
 * clock, the DOM, storage, or the network — the purity gate
 * (core-tests/assert-workflow-brain-purity.ts) pins that mechanically.
 *
 * Privacy stance (docs/workflow-brain-context-contract.md): telemetry may echo
 * nothing above `public-vocabulary`. The dimension allowlist below is the
 * enforcement point — enum-ish values only, so author text, tenant labels,
 * prompts, and provider payloads can never ride along, even by accident.
 *
 * Owner: reliability-observability-engineer (Wave 3).
 */

import { BrainClock, BrainTelemetrySink } from "./ports";

/* -------------------------------------------------------------------------- */
/* Correlation ids                                                            */
/* -------------------------------------------------------------------------- */

/**
 * "req-<base36 time>-<base36 n>". Unique per session as long as `counter` is
 * monotonic (same clock tick → different n). Carries clock time and a counter
 * value ONLY — no randomness, no customer data, replayable in tests.
 */
export function makeCorrelationId(clock: BrainClock, counter: () => number): string {
  const t = Math.max(0, Math.floor(clock.now())).toString(36);
  const n = Math.max(0, Math.floor(counter())).toString(36);
  return `req-${t}-${n}`;
}

/* -------------------------------------------------------------------------- */
/* Stage timers                                                               */
/* -------------------------------------------------------------------------- */

/** Feeds ParserProvenance.latency: totalMs since creation + per-stage durations. */
export interface StageTimer {
  start(stage: string): void;
  end(stage: string): void;
  snapshot(): { totalMs: number; stages: Record<string, number> };
}

/**
 * Tolerant by design — reliability plumbing must never take the pipeline down:
 * `end` without a matching `start` is ignored; overlapping stages are fine
 * (each stage name tracks its own start); re-running a stage ACCUMULATES into
 * the same bucket; a stage still open at `snapshot` is simply not reported
 * until it ends.
 */
export function makeStageTimer(clock: BrainClock): StageTimer {
  const createdAt = clock.now();
  const open = new Map<string, number>();
  const done: Record<string, number> = {};
  return {
    start(stage: string): void {
      open.set(stage, clock.now());
    },
    end(stage: string): void {
      const startedAt = open.get(stage);
      if (startedAt === undefined) return; // end without start — ignored
      open.delete(stage);
      done[stage] = (done[stage] ?? 0) + Math.max(0, clock.now() - startedAt);
    },
    snapshot(): { totalMs: number; stages: Record<string, number> } {
      return { totalMs: Math.max(0, clock.now() - createdAt), stages: { ...done } };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Telemetry allowlist                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The ONLY dimension keys telemetry may carry, each with a strict value
 * pattern. Values are enum-ish tokens — anything free-form (author text,
 * tenant vocabulary, error messages) fails the pattern and is dropped.
 * `engine` mirrors EngineMode (parserProvenance.ts); `latencyBucket` mirrors
 * {@link latencyBucket}. Keep the three in sync when either contract moves.
 */
export const TELEMETRY_DIMENSIONS: Record<string, RegExp> = {
  event: /^[a-z0-9._-]{1,32}$/,
  engine: /^(deterministic|ai|hybrid|deterministic-fallback)$/,
  fallbackReason: /^[a-z0-9_-]{1,32}$/,
  latencyBucket: /^(lt100|lt500|lt2000|lt8000|gte8000)$/,
  outcome: /^[a-z0-9_-]{1,32}$/,
  source: /^[a-z0-9_-]{1,32}$/,
};

/**
 * Wrap a host sink so nothing off-allowlist can reach it:
 * - `sink` undefined → a no-op sink (telemetry is optional, BrainPorts).
 * - unknown dimension KEYS are dropped entirely;
 * - values that fail their key's pattern are dropped (numbers/booleans are
 *   stringified first — so `true`, `404` pass where prose cannot);
 * - the event NAME must satisfy the `event` pattern or the whole call is
 *   dropped;
 * - the wrapper never throws, even when the host sink does.
 */
export function guardedTelemetry(sink: BrainTelemetrySink | undefined): BrainTelemetrySink {
  return {
    event(name: string, dimensions?: Record<string, string | number | boolean>): void {
      if (!sink) return;
      try {
        if (typeof name !== "string" || !TELEMETRY_DIMENSIONS.event.test(name)) return;
        let safe: Record<string, string | number | boolean> | undefined;
        if (dimensions) {
          safe = {};
          for (const key of Object.keys(dimensions)) {
            const pattern = TELEMETRY_DIMENSIONS[key];
            if (!pattern) continue; // unknown key — dropped entirely
            const value = dimensions[key];
            const primitive =
              typeof value === "string" || typeof value === "number" || typeof value === "boolean";
            if (primitive && pattern.test(String(value))) {
              safe[key] = value;
            }
          }
        }
        sink.event(name, safe);
      } catch {
        // Telemetry must never break the pipeline. Swallowed deliberately.
      }
    },
  };
}

/** Coarse latency dimension — buckets, never raw millisecond values, reach telemetry. */
export function latencyBucket(ms: number): "lt100" | "lt500" | "lt2000" | "lt8000" | "gte8000" {
  if (ms < 100) return "lt100";
  if (ms < 500) return "lt500";
  if (ms < 2000) return "lt2000";
  if (ms < 8000) return "lt8000";
  return "gte8000"; // includes non-finite input — fail toward "slow", never throw
}

/* -------------------------------------------------------------------------- */
/* Cache keys                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors the server-side cache-key mandate (docs/parser-ai-backend-contract.md):
 * `(tenant, parserVersion, promptVersion, hash(text), hash(options),
 * vocabularyHash)`. A key missing the tenant is a cross-tenant leak by
 * construction, so construction is where it is prevented.
 */
export interface CacheKeyParts {
  tenantKey: string;
  parserVersion: string;
  promptVersion: string;
  inputHash: string;
  optionsHash: string;
  vocabularyHash: string;
}

const CACHE_KEY_ORDER: ReadonlyArray<keyof CacheKeyParts> = [
  "tenantKey",
  "parserVersion",
  "promptVersion",
  "inputHash",
  "optionsHash",
  "vocabularyHash",
];

/**
 * Join the six parts with "|" in fixed order. EVERY part is required and
 * non-empty — an absent tenantKey (or any other part) throws instead of
 * producing a shareable key. Parts must not contain the separator, so keys
 * stay injective (no crafted part can collide across positions). Callers pass
 * HASHES for input/options ({@link hashText}) — raw author text never enters a
 * key.
 */
export function buildCacheKey(parts: CacheKeyParts): string {
  const pieces: string[] = [];
  for (const key of CACHE_KEY_ORDER) {
    const value = parts?.[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`buildCacheKey: missing or empty part "${key}"`);
    }
    if (value.includes("|")) {
      throw new Error(`buildCacheKey: part "${key}" contains the separator "|"`);
    }
    pieces.push(value);
  }
  return pieces.join("|");
}

/**
 * djb2 (xor variant) over UTF-16 code units → "h-<8hex>". Deterministic,
 * dependency-free, NOT cryptographic — good enough for cache partitioning and
 * for keeping raw text out of keys/diagnostics; never use it for secrets.
 */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h |= 0;
  }
  return `h-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Retry policy                                                               */
/* -------------------------------------------------------------------------- */

export interface RetryDecision {
  retry: boolean;
  reason: string;
}

/**
 * Client-side retry policy: NOTHING is retried from the client. The backend
 * owns retries (model chain, per-attempt budgets, rate limiting — see
 * docs/parser-ai-backend-contract.md); a client retry on top would multiply
 * load exactly when the service is least able to take it. The client's single
 * bounded "repair" re-prompt after a STRUCTURAL defect is orchestrator-owned
 * (orchestrator.ts) and is not a retry — it never re-asks for missing intent.
 * Every class degrades to the deterministic parser instead; the composer
 * never blocks.
 */
export function classifyForRetry(
  errorClass: "timeout" | "aborted" | "transport" | "shape" | "rate-limit"
): RetryDecision {
  switch (errorClass) {
    case "timeout":
      return { retry: false, reason: "timeout: budget spent; server owns retries — fall back" };
    case "aborted":
      return { retry: false, reason: "aborted: caller cancelled; retrying would defy the caller" };
    case "transport":
      return { retry: false, reason: "transport: server/gateway owns retries — fall back" };
    case "shape":
      return { retry: false, reason: "shape: same input, same defect; repair is not a retry" };
    case "rate-limit":
      return { retry: false, reason: "rate-limit: retrying amplifies pressure — fall back" };
  }
}

/* -------------------------------------------------------------------------- */
/* Circuit breaker                                                            */
/* -------------------------------------------------------------------------- */

export interface CircuitBreaker {
  state(): "closed" | "open" | "half-open";
  onSuccess(): void;
  onFailure(): void;
  allowRequest(): boolean;
}

/**
 * Deterministic breaker over the injected clock — no timers, no wall clock;
 * state transitions are computed lazily from `clock.now()`.
 *
 * Defaults: 3 failures inside a sliding 30_000 ms failure window → "open";
 * after a 60_000 ms cooldown → "half-open", which admits exactly ONE probe;
 * probe success → "closed" (failure count reset); probe failure → "open"
 * again with a fresh cooldown. Failures older than the sliding window never
 * accumulate. A success while "closed" clears the failure history.
 */
export function makeCircuitBreaker(
  clock: BrainClock,
  opts?: { failureThreshold?: number; windowMs?: number; cooldownMs?: number }
): CircuitBreaker {
  const failureThreshold = opts?.failureThreshold ?? 3;
  const windowMs = opts?.windowMs ?? 30_000;
  const cooldownMs = opts?.cooldownMs ?? 60_000;

  let mode: "closed" | "open" | "half-open" = "closed";
  let failures: number[] = [];
  let openedAt = 0;
  let probeInFlight = false;

  /** Lazily promote "open" → "half-open" once the cooldown has elapsed. */
  function sync(): void {
    if (mode === "open" && clock.now() - openedAt >= cooldownMs) {
      mode = "half-open";
      probeInFlight = false;
    }
  }

  function trip(): void {
    mode = "open";
    openedAt = clock.now();
    failures = [];
    probeInFlight = false;
  }

  return {
    state(): "closed" | "open" | "half-open" {
      sync();
      return mode;
    },
    allowRequest(): boolean {
      sync();
      if (mode === "closed") return true;
      if (mode === "open") return false;
      if (probeInFlight) return false; // half-open admits exactly one probe
      probeInFlight = true;
      return true;
    },
    onSuccess(): void {
      sync();
      if (mode === "half-open") {
        mode = "closed";
        failures = [];
        probeInFlight = false;
      } else if (mode === "closed") {
        failures = [];
      }
      // "open": success reports are ignored — no request should be in flight.
    },
    onFailure(): void {
      sync();
      if (mode === "half-open") {
        trip(); // the probe failed — fresh cooldown
        return;
      }
      if (mode === "open") return;
      const now = clock.now();
      failures = failures.filter((at) => now - at < windowMs);
      failures.push(now);
      if (failures.length >= failureThreshold) trip();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Diagnostics redaction                                                      */
/* -------------------------------------------------------------------------- */

const MAX_DIAGNOSTIC_LENGTH = 120;
const REDACTED = "«redacted»";

/** Credential-looking patterns (bearer tokens, provider keys, gateway headers). */
const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+\S+/gi, // authorization header values
  /\bsk-[A-Za-z0-9_-]+\S*/g, // provider secret keys (sk-…, sk-live-…)
  /\bx-goog[A-Za-z0-9_-]*\s*[:=]?\s*\S*/gi, // x-goog-api-key and friends, with any pasted value
  /\bcf-aig[A-Za-z0-9_-]*\s*[:=]?\s*\S*/gi, // Cloudflare AI Gateway auth header + value
];

/**
 * Make a string safe for logs/error surfaces: control characters and line
 * breaks collapse to single spaces, credential-looking substrings become
 * {@link REDACTED}, and the result is hard-truncated to 120 characters
 * (ellipsis-terminated when cut). Masking runs BEFORE truncation so a secret
 * can never survive by being cut in half. This is the ONLY sanctioned path
 * for free-form text into diagnostics — telemetry dimensions stay enum-only
 * via {@link guardedTelemetry} and never carry free-form text at all.
 */
export function redactForDiagnostics(s: string): string {
  let out = String(s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ");
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  if (out.length > MAX_DIAGNOSTIC_LENGTH) {
    out = `${out.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
  }
  return out;
}
