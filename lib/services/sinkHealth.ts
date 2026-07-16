import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  BreakerState,
  breakerNext,
  closedBreaker,
  normalizeBreakerState,
} from "@/lib/circuitBreaker";

/**
 * Phase 8 (§11): table-backed persistence for the per-sink circuit breaker.
 *
 * The state machine itself is pure (lib/circuitBreaker.ts — the clock is always
 * passed in); this service only loads/stores the SinkHealth row. Table-backed
 * because serverless cold starts reset in-memory state.
 */
export class SinkHealthService {
  /** Current breaker state for one sink (no row yet → a fresh closed breaker). */
  static async getState(orgId: string, sink: string): Promise<BreakerState> {
    if (!orgId) throw new Error("Organization ID is required to read sink health");
    const row = await prisma.sinkHealth.findUnique({
      where: { orgId_sink: { orgId, sink } },
    });
    if (!row) return closedBreaker();
    return normalizeBreakerState(row.statusJson);
  }

  /**
   * Fold one call outcome into the sink's breaker state and persist it.
   * Returns the new state so callers can decide (e.g. surface
   * INTEGRATION_UNAVAILABLE) without a second read.
   */
  static async record(
    orgId: string,
    sink: string,
    event: "success" | "failure",
    nowIso: string
  ): Promise<BreakerState> {
    if (!orgId) throw new Error("Organization ID is required to record sink health");
    const current = await SinkHealthService.getState(orgId, sink);
    const next = breakerNext(current, event, nowIso);
    await prisma.sinkHealth.upsert({
      where: { orgId_sink: { orgId, sink } },
      create: { orgId, sink, statusJson: next as unknown as Prisma.InputJsonValue },
      update: { statusJson: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  }

  /** All known sinks for the tenant with their normalized breaker states. */
  static async listStates(orgId: string): Promise<{ sink: string; state: BreakerState }[]> {
    if (!orgId) throw new Error("Organization ID is required to list sink health");
    const rows = await prisma.sinkHealth.findMany({
      where: { orgId },
      orderBy: { sink: "asc" },
    });
    return rows.map((row) => ({
      sink: row.sink,
      state: normalizeBreakerState(row.statusJson),
    }));
  }
}
