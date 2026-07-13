import { NextRequest, NextResponse } from "next/server";
import { WorkflowService } from "@/lib/services/workflow";

// GET /api/workflows — List workflows for a tenant
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("orgId") || searchParams.get("org_id");

    if (!orgId) {
      return NextResponse.json(
        { error: "orgId query parameter is required" },
        { status: 400 }
      );
    }

    const workflows = await WorkflowService.listWorkflows(orgId);
    return NextResponse.json(workflows);
  } catch (error: any) {
    console.error("Failed to list workflows:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list workflows" },
      { status: 500 }
    );
  }
}

// POST /api/workflows — Create a new workflow
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orgId, name, description, ruleJson, enabled } = body;

    if (!orgId) {
      return NextResponse.json(
        { error: "orgId is required" },
        { status: 400 }
      );
    }

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    if (!ruleJson) {
      return NextResponse.json(
        { error: "ruleJson is required" },
        { status: 400 }
      );
    }

    const workflow = await WorkflowService.createWorkflow({
      orgId,
      name,
      description,
      ruleJson,
      enabled,
    });

    return NextResponse.json(workflow, { status: 201 });
  } catch (error: any) {
    console.error("Failed to create workflow:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create workflow" },
      { status: 500 }
    );
  }
}
