import { NextRequest, NextResponse } from "next/server";
import { RuleExecutionService } from "@/lib/services/execution";

export const dynamic = "force-dynamic";

// GET /api/workflows/executions — tenant-scoped audit log, newest first
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

    const executions = await RuleExecutionService.listExecutions(orgId);
    return NextResponse.json(executions);
  } catch (error: unknown) {
    console.error("Failed to list executions:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list executions" },
      { status: 500 }
    );
  }
}
