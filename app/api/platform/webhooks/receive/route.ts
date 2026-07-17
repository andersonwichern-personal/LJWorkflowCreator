import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizeRule } from "@sweet/rule-core";
import { simulateRule } from "@sweet/rule-core";
import { evaluationContextFor } from "@/lib/services/exposure";
import { executeActions } from "@/lib/services/actionExecutor";
import { RuleExecutionService } from "@/lib/services/execution";
import { OrgControlsService } from "@/lib/services/orgControls";
import { PlatformRequest, CustomerType, LoanProduct, Stage, UwStatus, UwQueue, BookStatus, Core } from "@sweet/rule-core";

export const dynamic = "force-dynamic";

function buildPlatformRequest(requestId: string, payload: any): PlatformRequest {
  return {
    id: requestId,
    name: payload.name || payload.main_borrower || payload.customer_name || "Webhook Request",
    mainBorrower: payload.main_borrower || payload.customer_name || "",
    customerType: payload.customer_type || payload.custtype || "Business",
    retailer: payload.retailer || "",
    program: payload.program || "",
    loanAmount: Number(payload.loan_amount ?? payload.loanAmount ?? 0),
    loanProduct: payload.loan_product || payload.loanProduct || "Term Loan",
    stage: payload.stage || "Initiated",
    uwStatus: payload.uw_status || payload.uwstatus || "Pending",
    uwQueue: payload.uw_queue || payload.queue || "Unassigned",
    offerQueue: payload.offer_queue ?? null,
    bookStatus: payload.book_status || payload.bookstatus || "Not Sent",
    core: payload.core || "FISERV LOAN",
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    teamMember: payload.team_member || payload.teamMember || null,
    dateSubmitted: payload.date_submitted || new Date().toISOString().split("T")[0],
  };
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-sweet-signature") || req.headers.get("X-Sweet-Signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature header" }, { status: 401 });
  }

  const bodyText = await req.text();
  const secret = process.env.WEBHOOK_SECRET || "";
  const computed = crypto.createHmac("sha256", secret).update(bodyText).digest("hex");

  if (computed !== signature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: { event?: string; requestId?: string; orgId?: string; payload?: any };
  try {
    body = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { event, requestId, orgId, payload } = body;
  if (!event || !requestId || !orgId || !payload) {
    return NextResponse.json(
      { error: "event, requestId, orgId, and payload are required" },
      { status: 400 }
    );
  }

  try {
    // 1. Global kill switch check.
    if (await OrgControlsService.isPaused(orgId)) {
      return NextResponse.json({ outcome: "PAUSED_ORG", fired: false, reason: "Automations are paused for this org." });
    }

    const workflows = await prisma.workflow.findMany({
      where: { orgId, enabled: true },
    });

    const request = buildPlatformRequest(requestId, payload);
    const executionResults: Array<{
      workflowId: string;
      outcome: string;
      fired: boolean;
      results?: any;
    }> = [];

    for (const w of workflows) {
      const rule = normalizeRule(w.ruleJson);
      const matchedTriggerRef = rule.triggers.find((t) => t.event === event);

      if (!matchedTriggerRef) continue;

      const mode = rule.controls.mode;

      const log = (status: string, eventName: string, trace: unknown, actions: string[]) =>
        RuleExecutionService.logExecution({
          orgId,
          workflowId: w.id,
          requestId: request.id,
          requestName: request.name,
          eventName,
          status,
          mode,
          trace: trace as never,
          actions,
        });

      // Idempotency: one real fire per request (if controls oncePerRequest is true)
      if (rule.controls.oncePerRequest && (await RuleExecutionService.hasFired(orgId, w.id, request.id))) {
        await log("SKIPPED_DUPLICATE", event, { duplicate: true }, []);
        executionResults.push({ workflowId: w.id, outcome: "SKIPPED_DUPLICATE", fired: false });
        continue;
      }

      // Evaluate the rule conditions
      const context = await evaluationContextFor(rule, orgId, request.id);
      const sim = simulateRule(rule, request, context);

      if (!sim.matched) {
        await log("CONDITIONS_NOT_MET", event, sim.trace, sim.elseActions);
        executionResults.push({ workflowId: w.id, outcome: "CONDITIONS_NOT_MET", fired: false });
        continue;
      }

      // Shadow mode only logs
      if (mode === "shadow") {
        await log("SHADOW", event, sim.trace, sim.actions);
        executionResults.push({ workflowId: w.id, outcome: "SHADOW", fired: false });
        continue;
      }

      // Armed mode executes actions
      const results = await executeActions(rule.actions, {
        orgId,
        request: {
          amount: request.loanAmount,
          product: request.loanProduct,
          requestId: request.id,
        },
      });

      const sinkDown = results.some((r) => r.status === "integration-unavailable");
      await log(sinkDown ? "INTEGRATION_UNAVAILABLE" : "FIRED", event, sim.trace, sim.actions);
      executionResults.push({ workflowId: w.id, outcome: sinkDown ? "INTEGRATION_UNAVAILABLE" : "FIRED", fired: true, results });
    }

    return NextResponse.json({ results: executionResults });
  } catch (error: unknown) {
    console.error("Webhook processing failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal processing error" },
      { status: 500 }
    );
  }
}
