import { NextRequest, NextResponse } from "next/server";
import { WorkflowProposalService } from "@/lib/services/workflowProposal";

function getOrgId(req: NextRequest, bodyOrg?: unknown): string | null {
  if (typeof bodyOrg === "string" && bodyOrg.trim()) return bodyOrg.trim();
  const { searchParams } = new URL(req.url);
  return searchParams.get("orgId") || searchParams.get("org_id");
}

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = /not found|access denied/i.test(message)
    ? 404
    : /cannot/i.test(message)
    ? 403
    : /required|already/i.test(message)
    ? 400
    : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const orgId = getOrgId(req, body.orgId);
    if (!orgId) return NextResponse.json({ error: "orgId query parameter is required" }, { status: 400 });
    const proposal = await WorkflowProposalService.applyProposal(id, orgId, body.approverId);
    return NextResponse.json(proposal);
  } catch (error: unknown) {
    console.error("Failed to approve workflow proposal:", error);
    return errorResponse(error, "Failed to approve workflow proposal");
  }
}
