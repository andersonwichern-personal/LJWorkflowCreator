import { NextRequest, NextResponse } from "next/server";
import { ApprovalAuthorityService } from "@/lib/services/authority";

/** Fixed demo tenant fallback (real app derives org_id from the authed session). */
const DEFAULT_ORG_ID = "test-org-uuid-999";

function orgIdFrom(req: NextRequest): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("orgId") || searchParams.get("org_id") || DEFAULT_ORG_ID;
}

// GET /api/platform/authorities — list authority levels for a tenant
export async function GET(req: NextRequest) {
  try {
    const authorities = await ApprovalAuthorityService.listAuthorities(orgIdFrom(req));
    return NextResponse.json(authorities);
  } catch (error: unknown) {
    console.error("Failed to list authorities:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list authorities" },
      { status: 500 }
    );
  }
}

// POST /api/platform/authorities — create an authority level
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const created = await ApprovalAuthorityService.createAuthority({
      orgId: body.orgId || orgIdFrom(req),
      name: body.name,
      limit: Number(body.limit),
      riskGrade: body.riskGrade,
      product: body.product,
      userIds: Array.isArray(body.userIds) ? body.userIds : [],
      requirement: body.requirement ?? null,
      escalationId: body.escalationId ?? null,
      autoApprove: Boolean(body.autoApprove),
      overageTolerancePercent:
        body.overageTolerancePercent == null ? null : Number(body.overageTolerancePercent),
      overageToleranceAmount:
        body.overageToleranceAmount == null ? null : Number(body.overageToleranceAmount),
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error: unknown) {
    console.error("Failed to create authority:", error);
    const message = error instanceof Error ? error.message : "Failed to create authority";
    const status = /required|must be|cannot/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
