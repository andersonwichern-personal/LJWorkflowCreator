import { NextRequest, NextResponse } from "next/server";
import { ScheduledActionService } from "@/lib/services/scheduledAction";

export const dynamic = "force-dynamic";

/** Fixed demo tenant fallback (real app derives org_id from the authed session). */
const DEFAULT_ORG_ID = "test-org-uuid-999";

function orgIdFrom(req: NextRequest): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("orgId") || searchParams.get("org_id") || DEFAULT_ORG_ID;
}

// GET /api/platform/scheduled-actions?requestId= — list a request's rows
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestId = searchParams.get("requestId");
    if (!requestId) {
      return NextResponse.json({ error: "requestId is required" }, { status: 400 });
    }
    const actions = await ScheduledActionService.listForRequest(orgIdFrom(req), requestId);
    return NextResponse.json({ actions });
  } catch (error: unknown) {
    console.error("Failed to list scheduled actions:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list scheduled actions" },
      { status: 500 }
    );
  }
}

// POST /api/platform/scheduled-actions — reconcile after an anchor date change.
//
// This route is the seam a future REQUEST_FIELD_CHANGED event will call when
// that event exists; until then it is invoked manually / by tests. NO polling
// scheduler exists — actually firing the rows stays deferred (no worker/cron
// in the serverless prototype).
export async function POST(req: NextRequest) {
  try {
    const orgId = orgIdFrom(req);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const requestId = typeof body?.requestId === "string" ? body.requestId : "";
    const anchorField = typeof body?.anchorField === "string" ? body.anchorField : "";
    const newAnchorIso = typeof body?.newAnchorIso === "string" ? body.newAnchorIso : "";
    if (!requestId || !anchorField || !newAnchorIso) {
      return NextResponse.json(
        { error: "requestId, anchorField and newAnchorIso are required" },
        { status: 400 }
      );
    }
    // Clock read is allowed at the route edge — the lib math stays pure.
    const result = await ScheduledActionService.reconcile(
      orgId,
      requestId,
      anchorField,
      newAnchorIso,
      new Date().toISOString()
    );
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Failed to reconcile scheduled actions:", error);
    const message =
      error instanceof Error ? error.message : "Failed to reconcile scheduled actions";
    const status = /required|invalid/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
