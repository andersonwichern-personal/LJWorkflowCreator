import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeRule } from "@/lib/vocabulary";
import { executeActions } from "@/lib/services/actionExecutor";
import { RuleExecutionService } from "@/lib/services/execution";
import { getRequest } from "@/lib/platformData";

export const dynamic = "force-dynamic";

const DEFAULT_ORG_ID = "test-org-uuid-999";

function orgIdFrom(req: NextRequest): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("orgId") || searchParams.get("org_id") || DEFAULT_ORG_ID;
}

/**
 * POST /api/workflows/executions/[id]/retry — Phase 8 §11 "retry now".
 *
 * Re-dispatches a stuck execution's actions through the SAME executor path
 * (breaker + failure policies included). No re-evaluation: the rule matched
 * when the row was written; this replays the side effects only. The audit row
 * for the replay records `retryOf` so the chain is auditable, and the original
 * row is never mutated (append-only log).
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const orgId = orgIdFrom(req);

    const row = await prisma.ruleExecution.findFirst({ where: { id, orgId } });
    if (!row) {
      return NextResponse.json({ error: "Execution not found or access denied" }, { status: 404 });
    }
    const workflow = await prisma.workflow.findFirst({ where: { id: row.workflowId, orgId } });
    if (!workflow) {
      return NextResponse.json({ error: "Workflow no longer exists" }, { status: 404 });
    }

    const rule = normalizeRule(workflow.ruleJson);
    if (!rule.actions.length) {
      return NextResponse.json({ error: "Rule has no actions to retry" }, { status: 400 });
    }

    const request = getRequest(row.requestId);
    const results = await executeActions(rule.actions, {
      orgId,
      request: request
        ? { amount: request.loanAmount, product: request.loanProduct, requestId: request.id }
        : { requestId: row.requestId },
    });

    const sinkDown = results.some((r) => r.status === "integration-unavailable");
    const anyFailed = results.some((r) => r.status === "failed" || r.status === "invalid");
    const status = sinkDown ? "INTEGRATION_UNAVAILABLE" : anyFailed ? "ERROR" : "FIRED";
    await RuleExecutionService.logExecution({
      orgId,
      workflowId: row.workflowId,
      requestId: row.requestId,
      requestName: row.requestName,
      eventName: row.eventName,
      status,
      mode: row.mode as "shadow" | "armed",
      trace: { retryOf: row.id, results } as never,
      actions: results.map((r) => `${r.action}: ${r.status}`),
    });

    return NextResponse.json({ retried: true, retryOf: row.id, status, results });
  } catch (error: unknown) {
    console.error("Retry failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Retry failed" },
      { status: 500 }
    );
  }
}
