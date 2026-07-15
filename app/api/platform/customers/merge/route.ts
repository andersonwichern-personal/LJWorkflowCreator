import { NextRequest, NextResponse } from "next/server";
import { mergeCustomers } from "@/lib/services/merge";

const DEFAULT_ORG_ID = "test-org-uuid-999";

function orgIdFrom(req: NextRequest): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("orgId") || searchParams.get("org_id") || DEFAULT_ORG_ID;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orgId = body.orgId || orgIdFrom(req);
    const result = await mergeCustomers(body.survivorId, body.duplicateId, orgId, {
      actorId: body.actorId || "ui",
      reason: body.reason || "manual merge",
      expectedVersion: typeof body.expectedVersion === "number" ? body.expectedVersion : undefined,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to merge customers";
    return NextResponse.json(
      { error: message },
      { status: /stale version|conflict/i.test(message) ? 409 : 400 }
    );
  }
}
