/**
 * Phase 8 (§11): per-sink circuit breaker — pure state machine.
 *
 * No clock reads, no I/O: `nowIso` is always passed in, so the breaker is
 * deterministic and unit-testable. Persistence (the SinkHealth table) and
 * dispatch wiring live in the services layer; this module only decides.
 *
 * closed --(threshold consecutive failures)--> open
 * open   --(cooldown elapsed)--> one half-open trial is allowed
 * half-open --success--> closed (reset)   |   --failure--> open (cooldown restarts)
 */

export interface BreakerState {
  status: "closed" | "open" | "half-open";
  consecutiveFailures: number;
  /** ISO timestamp of the failure that opened (or re-opened) the circuit. */
  openedAt: string | null;
}

export interface BreakerConfig {
  /** Consecutive failures that open the circuit. */
  threshold: number;
  /** How long the circuit stays open before one half-open trial. */
  cooldownMs: number;
}

export const DEFAULT_BREAKER_CONFIG: BreakerConfig = {
  threshold: 3,
  cooldownMs: 60_000,
};

export function closedBreaker(): BreakerState {
  return { status: "closed", consecutiveFailures: 0, openedAt: null };
}

/** Coerce persisted Json into a well-formed state (garbage → fresh closed). */
export function normalizeBreakerState(raw: unknown): BreakerState {
  const o = (raw ?? {}) as Partial<BreakerState>;
  const status =
    o.status === "open" || o.status === "half-open" || o.status === "closed"
      ? o.status
      : "closed";
  return {
    status,
    consecutiveFailures:
      typeof o.consecutiveFailures === "number" && o.consecutiveFailures >= 0
        ? Math.floor(o.consecutiveFailures)
        : 0,
    openedAt: typeof o.openedAt === "string" ? o.openedAt : null,
  };
}

/**
 * May a call be attempted right now? Open circuits fail fast until the
 * cooldown elapses, then exactly one half-open trial is allowed (the caller
 * records the trial's outcome through breakerNext, which re-opens or closes).
 */
export function breakerAllows(
  state: BreakerState,
  nowIso: string,
  cfg: BreakerConfig = DEFAULT_BREAKER_CONFIG
): boolean {
  if (state.status !== "open") return true; // closed and half-open both allow
  if (!state.openedAt) return true; // malformed open state — fail open, not shut
  return Date.parse(nowIso) - Date.parse(state.openedAt) >= cfg.cooldownMs;
}

/** Fold one call outcome into the state. */
export function breakerNext(
  state: BreakerState,
  event: "success" | "failure",
  nowIso: string,
  cfg: BreakerConfig = DEFAULT_BREAKER_CONFIG
): BreakerState {
  if (event === "success") {
    return closedBreaker();
  }
  const failures = state.consecutiveFailures + 1;
  if (failures >= cfg.threshold || state.status !== "closed") {
    // Threshold reached, or a half-open trial (an attempt after cooldown) failed:
    // (re)open and restart the cooldown from this failure.
    return { status: "open", consecutiveFailures: failures, openedAt: nowIso };
  }
  return { status: "closed", consecutiveFailures: failures, openedAt: null };
}
