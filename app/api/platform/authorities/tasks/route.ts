import { NextRequest, NextResponse } from "next/server";
import { ApprovalTaskService, taskRequirementStatus } from "@/lib/services/approvalTask";
import { dynamicExclusionsForRequest } from "@/lib/services/customer";

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
    : /barred by maker-checker/i.test(message)
    ? 403
    : /already .* voting is closed/i.test(message)
    ? 409
    : /required|must |cannot/i.test(message)
    ? 400
    : 500;
  return NextResponse.json({ error: message }, { status });
}

// GET /api/platform/authorities/tasks?requestId=... — list review tasks
// (requestId scopes to one request; omitted → all tasks for the tenant).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestId = searchParams.get("requestId") ?? undefined;
    const tasks = await ApprovalTaskService.listTasks(orgIdFrom(req), requestId);
    return NextResponse.json(
      tasks.map((t) => ({ ...t, requirementStatus: taskRequirementStatus(t) }))
    );
  } catch (error: unknown) {
    console.error("Failed to list approval tasks:", error);
    return errorResponse(error, "Failed to list approval tasks");
  }
}

// POST /api/platform/authorities/tasks — initialize a review request
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orgId = body.orgId || orgIdFrom(req);
    const exclusions = await dynamicExclusionsForRequest(
      orgId,
      String(body.requestId || ""),
      Array.isArray(body.exclusions) ? body.exclusions.map(String) : []
    );
    const task = await ApprovalTaskService.createTask({
      orgId,
      authorityId: body.authorityId,
      requestId: body.requestId,
      requirement: body.requirement,
      exclusions,
      delegations: Array.isArray(body.delegations) ? body.delegations : [],
    });
    return NextResponse.json(
      { ...task, requirementStatus: taskRequirementStatus(task) },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Failed to create approval task:", error);
    return errorResponse(error, "Failed to create approval task");
  }
}
