import { NextRequest, NextResponse } from "next/server";
import { normalizeRule } from "@/lib/vocabulary";
import { simulateRule } from "@/lib/ruleEvaluator";
import { REQUESTS } from "@/lib/platformData";

export const dynamic = "force-dynamic";

/**
 * POST /api/workflows/backtest — dry-run a rule against every request record
 * (Phase 4 §2). Body: { rule }. No side effects, nothing logged.
 *
 * Returns { total, matches: [{ requestId, name, matchedTrigger, actions }], alerts }.
 * `alerts` aggregates the fail-closed missingData:"alert" notices across the
 * matched requests so the author sees data-coverage gaps in one place.
 */
export async function POST(req: NextRequest) {
  let body: { rule?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.rule) {
    return NextResponse.json({ error: "rule is required" }, { status: 400 });
  }

  try {
    const rule = normalizeRule(body.rule);
    const matches: { requestId: string; name: string; matchedTrigger: string | null; actions: string[] }[] = [];
    const alerts = new Set<string>();

    for (const request of REQUESTS) {
      const sim = simulateRule(rule, request);
      sim.alerts.forEach((a) => alerts.add(a));
      if (sim.matched) {
        matches.push({
          requestId: request.id,
          name: request.name,
          matchedTrigger: sim.trace.matchedTrigger,
          actions: sim.actions,
        });
      }
    }

    return NextResponse.json({
      total: REQUESTS.length,
      matchCount: matches.length,
      matches,
      alerts: [...alerts],
    });
  } catch (error: unknown) {
    console.error("Backtest failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backtest failed" },
      { status: 500 }
    );
  }
}
