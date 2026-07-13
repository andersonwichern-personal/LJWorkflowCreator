import { NextRequest, NextResponse } from "next/server";
import { WorkflowService } from "@/lib/services/workflow";

/**
 * Helper to retrieve orgId from the request query params
 */
function getOrgId(req: NextRequest): string | null {
  const { searchParams } = new URL(req.url);
  return searchParams.get("orgId") || searchParams.get("org_id");
}

// GET /api/workflows/[id] — Fetch a specific workflow by ID
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const orgId = getOrgId(req);

    if (!orgId) {
      return NextResponse.json(
        { error: "orgId query parameter is required" },
        { status: 400 }
      );
    }

    const workflow = await WorkflowService.getWorkflowById(id, orgId);

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found or access denied" },
        { status: 404 }
      );
    }

    return NextResponse.json(workflow);
  } catch (error: any) {
    console.error(`Failed to fetch workflow ${req.url}:`, error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch workflow" },
      { status: 500 }
    );
  }
}

// PATCH /api/workflows/[id] — Update an existing workflow
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const orgId = getOrgId(req);

    if (!orgId) {
      return NextResponse.json(
        { error: "orgId query parameter is required" },
        { status: 400 }
      );
    }

    const body = await req.json();

    const workflow = await WorkflowService.updateWorkflow(id, orgId, body);
    return NextResponse.json(workflow);
  } catch (error: any) {
    console.error(`Failed to update workflow ${req.url}:`, error);
    return NextResponse.json(
      { error: error.message || "Failed to update workflow" },
      { status: 500 }
    );
  }
}

// DELETE /api/workflows/[id] — Delete a workflow
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const orgId = getOrgId(req);

    if (!orgId) {
      return NextResponse.json(
        { error: "orgId query parameter is required" },
        { status: 400 }
      );
    }

    const workflow = await WorkflowService.deleteWorkflow(id, orgId);
    
    return NextResponse.json({ 
      success: true, 
      message: "Workflow deleted successfully",
      deleted: workflow 
    });
  } catch (error: any) {
    console.error(`Failed to delete workflow ${req.url}:`, error);
    return NextResponse.json(
      { error: error.message || "Failed to delete workflow" },
      { status: 500 }
    );
  }
}
