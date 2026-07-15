import { NextRequest, NextResponse } from "next/server";
import { ApprovalTaskService } from "@/lib/services/approvalTask";

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
    : /barred by maker-checker|not (an eligible seat|eligible)|not eligible at the current review step/i.test(message)
    ? 403
    : /already voted|voting is closed/i.test(message)
    ? 409
    : /required|must |cannot/i.test(message)
    ? 400
    : 500;
  return NextResponse.json({ error: message }, { status });
}

// POST /api/platform/authorities/tasks/[id]/decisions — record a verdict
// (approve/decline/abstain) and roll the task status forward.
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const result = await ApprovalTaskService.recordDecision(id, body.orgId || orgIdFrom(req), {
      approverId: body.approverId,
      approverLabel: body.approverLabel,
      verdict: body.verdict,
      note: body.note ?? null,
    });
    return NextResponse.json(
      { ...result.task, requirementStatus: result.status },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Failed to record approval decision:", error);
    return errorResponse(error, "Failed to record approval decision");
  }
}
