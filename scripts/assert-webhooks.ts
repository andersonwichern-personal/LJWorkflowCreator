/**
 * Webhook-receiver route contract suite — signature verification, trigger matching,
 * in-process condition evaluation, action dispatch, and audit logging.
 * Run: npx tsx scripts/assert-webhooks.ts
 */

import { NextRequest } from "next/server";
import crypto from "crypto";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

async function main() {
  process.env.WEBHOOK_SECRET = "test-webhook-secret";

  const { POST } = await import("../app/api/platform/webhooks/receive/route");
  const { prisma } = await import("../lib/prisma");
  const { RuleExecutionService } = await import("../lib/services/execution");
  const { OrgControlsService } = await import("../lib/services/orgControls");
  const { executeActions } = await import("../lib/services/actionExecutor");

  // Keep original services so we can restore them
  const saved = {
    workflowFindMany: prisma.workflow.findMany,
    isPaused: OrgControlsService.isPaused,
    logExecution: RuleExecutionService.logExecution,
    hasFired: RuleExecutionService.hasFired,
  };

  // Setup logging checks
  const logCalls: any[] = [];
  RuleExecutionService.logExecution = async (data: any) => {
    logCalls.push(data);
    return { id: `exec-${logCalls.length}`, ...data, createdAt: new Date().toISOString() } as any;
  };

  OrgControlsService.isPaused = async () => false;
  RuleExecutionService.hasFired = async () => false;

  const sampleWorkflow = {
    id: "wf-1",
    orgId: "org-1",
    name: "Webhook Test Rule",
    enabled: true,
    ruleJson: {
      schemaVersion: 3,
      triggers: [{ event: "LOAN APPROVED" }],
      conditions: {
        logic: "AND",
        children: [
          { field: "loan_amount", operator: "gte", value: "250000" }
        ]
      },
      actions: [{ action: "notify", params: { value: "Wael" } }],
      controls: {
        mode: "armed",
        oncePerRequest: true,
        maxFiresPerHour: 25,
        missingData: "no_match",
        priority: 100
      }
    }
  };

  // Stub prisma workflow query
  prisma.workflow.findMany = (async (args: any) => {
    if (args?.where?.orgId === "org-1" && args?.where?.enabled === true) {
      return [sampleWorkflow];
    }
    return [];
  }) as any;

  function makeRequest(body: any, secret = "test-webhook-secret", addHeader = true) {
    const bodyText = JSON.stringify(body);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (addHeader) {
      const signature = crypto.createHmac("sha256", secret).update(bodyText).digest("hex");
      headers["X-Sweet-Signature"] = signature;
    }
    return new NextRequest("http://localhost/api/platform/webhooks/receive", {
      method: "POST",
      headers,
      body: bodyText,
    });
  }

  // --- Test 1: Valid signed webhook executes successfully when conditions match ---
  {
    logCalls.length = 0;
    const body = {
      event: "LOAN APPROVED",
      requestId: "req-123",
      orgId: "org-1",
      payload: { loan_amount: 300000, stage: "Approved", uw_status: "Approved" }
    };
    const req = makeRequest(body);
    const res = await POST(req);
    t("valid webhook status is 200", res.status === 200);
    const data = await res.json();
    t("valid webhook outputs FIRED outcome", data.results?.[0]?.outcome === "FIRED");
    t("valid webhook execution gets logged", logCalls.length === 1);
    t("logged event matches webhook event", logCalls[0]?.eventName === "LOAN APPROVED");
    t("logged status is FIRED", logCalls[0]?.status === "FIRED");
  }

  // --- Test 2: Valid signed webhook matches trigger but skips when conditions fail ---
  {
    logCalls.length = 0;
    const body = {
      event: "LOAN APPROVED",
      requestId: "req-124",
      orgId: "org-1",
      payload: { loan_amount: 150000, stage: "Approved", uw_status: "Approved" }
    };
    const req = makeRequest(body);
    const res = await POST(req);
    t("low amount status is 200", res.status === 200);
    const data = await res.json();
    t("low amount outputs CONDITIONS_NOT_MET", data.results?.[0]?.outcome === "CONDITIONS_NOT_MET");
    t("conditions not met trace is logged", logCalls.length === 1);
    t("logged status is CONDITIONS_NOT_MET", logCalls[0]?.status === "CONDITIONS_NOT_MET");
  }

  // --- Test 3: Invalid signature is rejected with HTTP 401 ---
  {
    const body = {
      event: "LOAN APPROVED",
      requestId: "req-125",
      orgId: "org-1",
      payload: { loan_amount: 300000 }
    };
    const req = makeRequest(body, "wrong-secret");
    const res = await POST(req);
    t("invalid signature returns 401", res.status === 401);
  }

  // --- Test 4: Missing signature header is rejected with HTTP 401 ---
  {
    const body = {
      event: "LOAN APPROVED",
      requestId: "req-125",
      orgId: "org-1",
      payload: { loan_amount: 300000 }
    };
    const req = makeRequest(body, "test-webhook-secret", false);
    const res = await POST(req);
    t("missing signature header returns 401", res.status === 401);
  }

  // Restore originals
  prisma.workflow.findMany = saved.workflowFindMany;
  OrgControlsService.isPaused = saved.isPaused;
  RuleExecutionService.logExecution = saved.logExecution;
  RuleExecutionService.hasFired = saved.hasFired;

  console.log(`\nWebhook assertion results: ${failures === 0 ? "PASS" : "FAIL"} (${failures} failures)`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Webhook assertions threw:", err);
  process.exit(1);
});
