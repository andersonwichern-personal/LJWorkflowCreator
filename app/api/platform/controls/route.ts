import { NextRequest, NextResponse } from "next/server";
import { OrgControlsService } from "@/lib/services/orgControls";

export const dynamic = "force-dynamic";

/** Fixed demo tenant fallback, matching the platform routes. */
const DEFAULT_ORG_ID = "test-org-uuid-999";

function orgIdFrom(req: NextRequest, bodyOrg?: string): string {
  const { searchParams } = new URL(req.url);
  return bodyOrg || searchParams.get("orgId") || searchParams.get("org_id") || DEFAULT_ORG_ID;
}

// GET /api/platform/controls — read the tenant's automation controls
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await OrgControlsService.get(orgIdFrom(req)));
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read controls" },
      { status: 500 }
    );
  }
}

// PATCH /api/platform/controls — set the global pause flag
export async function PATCH(req: NextRequest) {
  let body: { automationsPaused?: boolean; orgId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.automationsPaused !== "boolean") {
    return NextResponse.json({ error: "automationsPaused (boolean) is required" }, { status: 400 });
  }
  try {
    const row = await OrgControlsService.setPaused(orgIdFrom(req, body.orgId), body.automationsPaused);
    return NextResponse.json({
      orgId: row.orgId,
      automationsPaused: row.automationsPaused,
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update controls" },
      { status: 500 }
    );
  }
}
