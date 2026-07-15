/**
 * Phase 7.1: execution analytics over the rule_executions audit log.
 *
 * Pure functions — no DB, no clock, no randomness — so `scripts/assert-analytics.ts`
 * can exercise the exact math the API route serves. The route feeds this from
 * RuleExecutionService rows; the dashboard renders the result.
 *
 * Honesty guardrail: queue latency has NO real source yet (no event stream /
 * decision timestamps on the platform). `mockLatencyMinutes` is a deterministic
 * per-request stand-in mapped into 15–90 minutes, and every consumer must label
 * it as simulated. Do not present it as measured.
 */

export interface AnalyticsRow {
  workflowId: string;
  requestId: string;
  status: string; // ExecutionStatus — FIRED | SHADOW | ERROR | CONDITIONS_NOT_MET | …
}

export interface ExecutionAnalytics {
  totals: {
    evaluations: number;
    fired: number;
    shadow: number;
    errors: number;
  };
  /** Simulated average manual-queue turnaround (see honesty note above). */
  averageLatencyMinutes: number;
  /** Execution frequency per workflow id — the hotspot map. */
  hotspots: Record<string, number>;
}

/**
 * Deterministic mock latency for a request: stable string hash mapped onto the
 * 15–90 minute spectrum (spec). Same request always yields the same latency, so
 * analytics don't jitter between renders and tests are reproducible.
 */
export function mockLatencyMinutes(requestId: string): number {
  let h = 0;
  for (let i = 0; i < requestId.length; i++) {
    h = (h * 31 + requestId.charCodeAt(i)) | 0;
  }
  const span = 90 - 15 + 1; // inclusive range
  return 15 + (Math.abs(h) % span);
}

/** Aggregate execution rows into the dashboard analytics payload. */
export function computeExecutionAnalytics(rows: AnalyticsRow[]): ExecutionAnalytics {
  const totals = { evaluations: rows.length, fired: 0, shadow: 0, errors: 0 };
  const hotspots: Record<string, number> = {};
  const requestIds = new Set<string>();

  for (const row of rows) {
    if (row.status === "FIRED") totals.fired++;
    else if (row.status === "SHADOW") totals.shadow++;
    else if (row.status === "ERROR") totals.errors++;
    hotspots[row.workflowId] = (hotspots[row.workflowId] ?? 0) + 1;
    if (row.requestId) requestIds.add(row.requestId);
  }

  // Average the per-request mock latencies (each distinct request waits once,
  // however many rules evaluated it).
  let latencySum = 0;
  for (const id of requestIds) latencySum += mockLatencyMinutes(id);
  const averageLatencyMinutes = requestIds.size
    ? Math.round(latencySum / requestIds.size)
    : 0;

  return { totals, averageLatencyMinutes, hotspots };
}

/** Fired-vs-evaluated match rate, 0–100. Total-safe (0 when nothing evaluated). */
export function matchRatePct(a: ExecutionAnalytics): number {
  return a.totals.evaluations
    ? Math.round((a.totals.fired / a.totals.evaluations) * 100)
    : 0;
}
