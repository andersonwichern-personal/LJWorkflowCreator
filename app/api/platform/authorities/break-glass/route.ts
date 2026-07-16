import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildBreakGlassAudit, normalizeBreakGlassInput } from "@/lib/breakGlass";
import { ApprovalTaskService } from "@/lib/services/approvalTask";
import { RuleExecutionService } from "@/lib/services/execution";

/** Fixed demo tenant fallback (real app derives org_id from the authed session). */
const DEFAULT_ORG_ID = "test-org-uuid-999";

function orgIdFrom(req: NextRequest, bodyOrg?: unknown): string {
  if (typeof bodyOrg === "string" && bodyOrg.trim()) return bodyOrg.trim();
  const { searchParams } = new URL(req.url);
  return searchParams.get("orgId") || searchParams.get("org_id") || DEFAULT_ORG_ID;
}

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = /not found|access denied/i.test(message)
    ? 404
    : /required|must|reason/i.test(message)
    ? 400
    : 500;
  return NextResponse.json({ error: message }, { status });
}

async function auditWorkflowId(orgId: string, explicit: unknown): Promise<string> {
  if (typeof explicit === "string" && explicit.trim()) {
    const workflow = await prisma.workflow.findFirst({
      where: { orgId, id: explicit.trim() },
      select: { id: true },
    });
    if (!workflow) throw new Error("Workflow not found or access denied");
    return workflow.id;
  }

  const workflow = await prisma.workflow.findFirst({
    where: { orgId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!workflow) {
    throw new Error("At least one workflow is required to anchor a break-glass audit row");
  }
  return workflow.id;
}

// POST /api/platform/authorities/break-glass — emergency approval bypass.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orgId = orgIdFrom(req, body.orgId);
    const input = normalizeBreakGlassInput(body);

    const workflowId = await auditWorkflowId(orgId, body.workflowId);
    const override = await ApprovalTaskService.overrideRequest({
      orgId,
      requestId: input.requestId,
      reason: input.reason,
    });
    const auditPayload = buildBreakGlassAudit(input, override.count);
    const audit = await RuleExecutionService.logExecution({
      orgId,
      workflowId,
      requestId: auditPayload.requestId,
      requestName: auditPayload.requestName,
      eventName: auditPayload.eventName,
      status: auditPayload.status,
      mode: auditPayload.mode,
      trace: auditPayload.trace,
      actions: auditPayload.actions,
    });

    return NextResponse.json({ overridden: override.count, audit }, { status: 201 });
  } catch (error: unknown) {
    console.error("Failed to apply break-glass override:", error);
    return errorResponse(error, "Failed to apply break-glass override");
  }
}
