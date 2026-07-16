import { NextRequest, NextResponse } from "next/server";
import { ApprovalAuthorityService } from "@/lib/services/authority";
import { conflictPayload, isVersionConflict } from "@/lib/optimisticWrite";

/** Fixed demo tenant fallback (real app derives org_id from the authed session). */
const DEFAULT_ORG_ID = "test-org-uuid-999";

function orgIdFrom(req: NextRequest): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("orgId") || searchParams.get("org_id") || DEFAULT_ORG_ID;
}

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = /not found|access denied/i.test(message)
    ? 404
    : /required|must be|cannot/i.test(message)
    ? 400
    : 500;
  return NextResponse.json({ error: message }, { status });
}

// PATCH /api/platform/authorities/[id] — update an authority level
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();

    const updates: Parameters<typeof ApprovalAuthorityService.updateAuthority>[2] = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.limit !== undefined) updates.limit = Number(body.limit);
    if (body.riskGrade !== undefined) updates.riskGrade = body.riskGrade;
    if (body.product !== undefined) updates.product = body.product;
    if (body.userIds !== undefined) {
      updates.userIds = Array.isArray(body.userIds) ? body.userIds : [];
    }
    if (body.requirement !== undefined) updates.requirement = body.requirement;
    if (body.escalationId !== undefined) updates.escalationId = body.escalationId;
    if (body.autoApprove !== undefined) updates.autoApprove = Boolean(body.autoApprove);

    const updated = await ApprovalAuthorityService.updateAuthority(
      id,
      orgIdFrom(req),
      updates,
      typeof body.expectedVersion === "number" ? body.expectedVersion : undefined
    );
    return NextResponse.json(updated);
  } catch (error: unknown) {
    if (isVersionConflict(error)) {
      return NextResponse.json(conflictPayload(error), { status: 409 });
    }
    console.error("Failed to update authority:", error);
    return errorResponse(error, "Failed to update authority");
  }
}

// DELETE /api/platform/authorities/[id] — delete an authority level
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await ApprovalAuthorityService.deleteAuthority(id, orgIdFrom(req));
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Failed to delete authority:", error);
    return errorResponse(error, "Failed to delete authority");
  }
}
