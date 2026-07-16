import { NextRequest, NextResponse } from "next/server";
import { normalizeRule } from "@/lib/vocabulary";
import { simulateRule } from "@/lib/ruleEvaluator";
import { getRequest } from "@/lib/platformData";
import { WorkflowService } from "@/lib/services/workflow";
import { RuleExecutionService } from "@/lib/services/execution";
import { OrgControlsService } from "@/lib/services/orgControls";
import { executeActions } from "@/lib/services/actionExecutor";

export const dynamic = "force-dynamic";

/** Fixed demo tenant fallback, matching the platform routes. */
const DEFAULT_ORG_ID = "test-org-uuid-999";
const HOUR_MS = 60 * 60 * 1000;

function orgIdFrom(req: NextRequest, bodyOrg?: string): string {
  const { searchParams } = new URL(req.url);
  return bodyOrg || searchParams.get("orgId") || searchParams.get("org_id") || DEFAULT_ORG_ID;
}

/**
 * POST /api/workflows/[id]/fire — the real fire path with all trust guardrails
 * (Phase 4 §2). Body: { requestId }.
 *
 * Order of gates, each terminal:
 *   1. org automations paused        → PAUSED_ORG
 *   2. oncePerRequest duplicate lock  → SKIPPED_DUPLICATE
 *   3. maxFiresPerHour rate cap       → PAUSED_RATE_LIMIT (auto-disables workflow + notifies)
 *   4. evaluate → not matched         → CONDITIONS_NOT_MET
 *              → matched + shadow      → SHADOW (actions skipped)
 *              → matched + armed       → FIRED (actions executed sequentially)
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let body: { requestId?: string; orgId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = orgIdFrom(req, body.orgId);
  if (!body.requestId) {
    return NextResponse.json({ error: "requestId is required" }, { status: 400 });
  }

  const workflow = await WorkflowService.getWorkflowById(id, orgId);
  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found or access denied" }, { status: 404 });
  }

  const request = getRequest(body.requestId);
  if (!request) {
    return NextResponse.json({ error: `Request ${body.requestId} not found` }, { status: 404 });
  }

  const rule = normalizeRule(workflow.ruleJson);
  const mode = rule.controls.mode;
  const requestName = request.name;
  const firstEvent = rule.triggers[0]?.event ?? "—";

  const log = (status: string, eventName: string, trace: unknown, actions: string[]) =>
    RuleExecutionService.logExecution({
      orgId,
      workflowId: id,
      requestId: request.id,
      requestName,
      eventName,
      status,
      mode,
      trace: trace as never,
      actions,
    });

  try {
    // 1. Global kill switch.
    if (await OrgControlsService.isPaused(orgId)) {
      await log("PAUSED_ORG", firstEvent, { paused: true }, []);
      return NextResponse.json({ outcome: "PAUSED_ORG", fired: false, reason: "Automations are paused for this org." });
    }

    // 2. Idempotency: one real fire per request (only when controls demand it).
    if (rule.controls.oncePerRequest && (await RuleExecutionService.hasFired(orgId, id, request.id))) {
      await log("SKIPPED_DUPLICATE", firstEvent, { duplicate: true }, []);
      return NextResponse.json({ outcome: "SKIPPED_DUPLICATE", fired: false, reason: "Already fired for this request." });
    }

    // 3. Circuit breaker: hourly FIRED cap. Auto-disable + notify on trip.
    const firedLastHour = await RuleExecutionService.countFiredSince(orgId, id, new Date(Date.now() - HOUR_MS));
    if (firedLastHour >= rule.controls.maxFiresPerHour) {
      await WorkflowService.toggleWorkflow(id, orgId, false);
      const notice = await executeActions(
        [{ action: "notify", params: { value: "Operations Team" }, onFailure: "skip" }],
        { orgId, request: { requestId: request.id } }
      );
      await log(
        "PAUSED_RATE_LIMIT",
        firstEvent,
        { firedLastHour, cap: rule.controls.maxFiresPerHour, autoDisabled: true, notice },
        []
      );
      return NextResponse.json({
        outcome: "PAUSED_RATE_LIMIT",
        fired: false,
        reason: `Rate cap of ${rule.controls.maxFiresPerHour}/hour hit — workflow auto-disabled.`,
        firedLastHour,
      });
    }

    // 4. Evaluate the rule against the request.
    const sim = simulateRule(rule, request);
    const eventName = sim.trace.matchedTrigger ?? firstEvent;

    if (!sim.matched) {
      await log("CONDITIONS_NOT_MET", eventName, sim.trace, sim.elseActions);
      return NextResponse.json({ outcome: "CONDITIONS_NOT_MET", fired: false, matched: false, trace: sim.trace, elseActions: sim.elseActions });
    }

    // Matched. Shadow observes; armed executes.
    if (mode === "shadow") {
      await log("SHADOW", eventName, sim.trace, sim.actions);
      return NextResponse.json({ outcome: "SHADOW", fired: false, matched: true, mode, wouldRun: sim.actions, trace: sim.trace });
    }

    const results = await executeActions(rule.actions, {
      orgId,
      request: {
        amount: request.loanAmount,
        product: request.loanProduct,
        requestId: request.id,
      },
    });
    // Phase 8 §11: a dispatch that hit an open circuit is logged distinctly —
    // it's an outage, not a rule defect (ERROR) and not a clean FIRED.
    const sinkDown = results.some((r) => r.status === "integration-unavailable");
    await log(sinkDown ? "INTEGRATION_UNAVAILABLE" : "FIRED", eventName, sim.trace, sim.actions);
    return NextResponse.json({
      outcome: sinkDown ? "INTEGRATION_UNAVAILABLE" : "FIRED",
      fired: true,
      matched: true,
      mode,
      actions: sim.actions,
      results,
      trace: sim.trace,
    });
  } catch (error: unknown) {
    console.error(`Fire failed for workflow ${id}:`, error);
    await log("ERROR", firstEvent, { error: error instanceof Error ? error.message : "unknown" }, []).catch(() => {});
    return NextResponse.json({ error: error instanceof Error ? error.message : "Fire failed" }, { status: 500 });
  }
}
