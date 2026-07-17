import { NextRequest, NextResponse } from "next/server";
import { getAction, ScopeValue } from "@sweet/rule-core";
import { AuthorityInput } from "@/lib/authorityEngine";
import { executeAction } from "@/lib/services/actionExecutor";

export const dynamic = "force-dynamic";

interface ExecuteBody {
  action: string;
  params?: Record<string, ScopeValue>;
  orgId?: string;
  /** Request context for authority decisioning (amount/grade/product). */
  context?: Partial<AuthorityInput> & { requestId?: string };
  /** Optional per-call failure policy override (defaults to the action's own). */
  onFailure?: "retry" | "skip" | "halt";
}

/**
 * POST /api/execute — thin wrapper over the action executor service.
 *
 * The real execution logic lives in lib/services/actionExecutor.ts so this
 * route and the workflow `fire` route share one path (Phase 4 §1).
 */
export async function POST(req: NextRequest) {
  let body: ExecuteBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = getAction(body.action ?? "");
  if (!action) {
    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }

  try {
    const result = await executeAction(
      action.key,
      body.params ?? {},
      { orgId: body.orgId, request: body.context },
      { onFailure: body.onFailure }
    );
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error(`Execute failed for ${action.key}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Execution failed" },
      { status: 500 }
    );
  }
}
