import { NextRequest, NextResponse } from "next/server";
import { SinkHealthService } from "@/lib/services/sinkHealth";

export const dynamic = "force-dynamic";

/** Fixed demo tenant fallback (real app derives org_id from the authed session). */
const DEFAULT_ORG_ID = "test-org-uuid-999";

function orgIdFrom(req: NextRequest): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("orgId") || searchParams.get("org_id") || DEFAULT_ORG_ID;
}

// GET /api/platform/sink-health — per-sink circuit-breaker states for the tenant
export async function GET(req: NextRequest) {
  try {
    const sinks = await SinkHealthService.listStates(orgIdFrom(req));
    return NextResponse.json({ sinks });
  } catch (error: unknown) {
    console.error("Failed to read sink health:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read sink health" },
      { status: 500 }
    );
  }
}
