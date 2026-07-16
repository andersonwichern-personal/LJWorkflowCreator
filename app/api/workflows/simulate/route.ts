import { NextRequest, NextResponse } from "next/server";
import { normalizeRule } from "@/lib/vocabulary";
import { simulateRule } from "@/lib/ruleEvaluator";
import { getRequest } from "@/lib/platformData";
import { WorkflowService } from "@/lib/services/workflow";
import { RuleExecutionService } from "@/lib/services/execution";
import { routesToPeer } from "@/lib/abSplit";

export const dynamic = "force-dynamic";

/** Fixed demo tenant fallback, matching the platform routes. */
const DEFAULT_ORG_ID = "test-org-uuid-999";

/**
 * POST /api/workflows/simulate — dry-run a rule against a request.
 *
 * Body: { requestId, rule, workflowId?, orgId?, log? }
 * Evaluates with the traced simulator and returns the full trace. When the
 * run is attributable to a saved workflow (workflowId present) it is also
 * persisted to the RuleExecution audit log — pass log:false to skip. Logging
 * failures never fail the simulation; they surface as `logError`.
 */
export async function POST(req: NextRequest) {
  let body: {
    requestId?: string;
    rule?: unknown;
    workflowId?: string;
    orgId?: string;
    log?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.requestId) {
    return NextResponse.json({ error: "requestId is required" }, { status: 400 });
  }
  if (!body.rule) {
    return NextResponse.json({ error: "rule is required" }, { status: 400 });
  }

  // Live request lookup is pending the admin bridge (build manual §12 Q2) —
  // resolve from the representative dataset, exactly as the prompt's fallback.
  const request = getRequest(body.requestId);
  if (!request) {
    return NextResponse.json(
      { error: `Request ${body.requestId} not found` },
      { status: 404 }
    );
  }

  const rule = normalizeRule(body.rule);
  const orgId = body.orgId || DEFAULT_ORG_ID;
  const abSplit = rule.controls.abSplit;

  try {
    let routedRule = rule;
    let routed: "ab-split" | undefined;
    if (abSplit?.targetWorkflowId && routesToPeer(body.requestId, abSplit.weightPercent)) {
      const peer = await WorkflowService.getWorkflowById(abSplit.targetWorkflowId, orgId);
      if (peer) {
        routedRule = normalizeRule(peer.ruleJson);
        routed = "ab-split";
      }
    }

    const result = simulateRule(routedRule, request);

    let logged = false;
    let logError: string | undefined;
    if (body.workflowId && body.log !== false) {
      try {
        // A/B attribution (review finding): a routed run is the PEER's outcome —
        // logging it under the control workflow corrupts per-variant analytics.
        // Attribute to the rule that actually evaluated, and persist the split
        // marker in the trace so the audit log can reconstruct the experiment.
        await RuleExecutionService.logExecution({
          orgId,
          workflowId: routed && abSplit ? abSplit.targetWorkflowId : body.workflowId,
          requestId: request.id,
          requestName: request.name,
          eventName: result.trace.matchedTrigger ?? routedRule.triggers[0]?.event ?? "—",
          status: result.matched ? "FIRED" : "CONDITIONS_NOT_MET",
          trace: (routed
            ? { ...result.trace, routed: "ab-split", controlWorkflowId: body.workflowId }
            : result.trace) as never,
          actions: result.actions,
        });
        logged = true;
      } catch (e: unknown) {
        logError = e instanceof Error ? e.message : "audit logging failed";
      }
    }

    return NextResponse.json({
      ...result,
      request: { id: request.id, name: request.name },
      logged,
      ...(routed ? { routed } : {}),
      ...(logError ? { logError } : {}),
    });
  } catch (error: unknown) {
    // Evaluator crash → persist an ERROR audit row when attributable, then 500.
    console.error("Simulation failed:", error);
    if (body.workflowId && body.log !== false) {
      await RuleExecutionService.logExecution({
        orgId,
        workflowId: body.workflowId,
        requestId: request.id,
        requestName: request.name,
        eventName: rule.triggers[0]?.event ?? "—",
        status: "ERROR",
        trace: { error: error instanceof Error ? error.message : "unknown" },
        actions: [],
      }).catch(() => {});
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Simulation failed" },
      { status: 500 }
    );
  }
}
