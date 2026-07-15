import { NextRequest, NextResponse } from "next/server";
import { RuleExecutionService } from "@/lib/services/execution";
import { computeExecutionAnalytics } from "@/lib/executionAnalytics";

export const dynamic = "force-dynamic";

// GET /api/workflows/analytics — execution totals, simulated queue latency, and
// per-workflow hotspot counts for the Diagnostics & Analytics dashboard (Phase 7.1).
// Contract (work order §2.1):
//   { totals: { evaluations, fired, shadow, errors }, averageLatencyMinutes, hotspots }
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("orgId") || searchParams.get("org_id");

    if (!orgId) {
      return NextResponse.json(
        { error: "orgId query parameter is required" },
        { status: 400 }
      );
    }

    const rows = await RuleExecutionService.analyticsRows(orgId);
    return NextResponse.json(computeExecutionAnalytics(rows));
  } catch (error: unknown) {
    console.error("Failed to compute analytics:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to compute analytics" },
      { status: 500 }
    );
  }
}
