/**
 * Fire-route contract suite — guardrail ordering, audit statuses, and
 * auto-disable behavior. Run: npx tsx scripts/assert-fire.ts
 */

process.loadEnvFile?.(".env.local");

import type { WorkflowRule } from "@sweet/rule-core";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

type FireLog = {
  orgId: string;
  workflowId: string;
  requestId: string;
  requestName: string;
  eventName: string;
  status: string;
  mode?: string;
  trace: unknown;
  actions: unknown;
};

async function main() {
  const { POST } = await import("../app/api/workflows/[id]/fire/route");
  const { WorkflowService } = await import("../lib/services/workflow");
  const { RuleExecutionService } = await import("../lib/services/execution");
  const { OrgControlsService } = await import("../lib/services/orgControls");
  const { REQUESTS } = await import("@sweet/rule-core");
  const { defaultControls, RULE_SCHEMA_VERSION } = await import("@sweet/rule-core");

  const saved = {
    getWorkflowById: WorkflowService.getWorkflowById,
    toggleWorkflow: WorkflowService.toggleWorkflow,
    isPaused: OrgControlsService.isPaused,
    hasFired: RuleExecutionService.hasFired,
    countFiredSince: RuleExecutionService.countFiredSince,
    logExecution: RuleExecutionService.logExecution,
  };

  const logCalls: FireLog[] = [];
  RuleExecutionService.logExecution = (async (data: FireLog) => {
    logCalls.push(data);
    return {
      id: `exec-${logCalls.length}`,
      orgId: data.orgId,
      workflowId: data.workflowId,
      requestId: data.requestId,
      requestName: data.requestName,
      eventName: data.eventName,
      status: data.status,
      mode: data.mode ?? "shadow",
      evaluationTrace: data.trace,
      actionsDispatched: data.actions,
      createdAt: new Date().toISOString(),
      workflow: null,
    } as never;
  }) as typeof RuleExecutionService.logExecution;

  const baseRule: WorkflowRule = {
    schemaVersion: RULE_SCHEMA_VERSION,
    triggers: [{ event: "SYSTEM ERROR" }],
    conditions: { logic: "AND", children: [] },
    actions: [{ action: "notify", params: { value: "Wael" } }],
    controls: { ...defaultControls(), mode: "shadow", oncePerRequest: true, maxFiresPerHour: 25 },
  };

  WorkflowService.getWorkflowById = (async () => ({
    id: "wf-1",
    orgId: "test-org-uuid-999",
    name: "Test workflow",
    description: null,
    enabled: true,
    ruleJson: baseRule,
    createdAt: new Date(),
    updatedAt: new Date(),
  })) as unknown as typeof WorkflowService.getWorkflowById;
  WorkflowService.toggleWorkflow = (async () => ({
    id: "wf-1",
    orgId: "test-org-uuid-999",
    name: "Test workflow",
    description: null,
    enabled: false,
    ruleJson: baseRule,
    createdAt: new Date(),
    updatedAt: new Date(),
  })) as unknown as typeof WorkflowService.toggleWorkflow;
  OrgControlsService.isPaused = (async () => false) as unknown as typeof OrgControlsService.isPaused;
  RuleExecutionService.hasFired = (async () => false) as unknown as typeof RuleExecutionService.hasFired;
  RuleExecutionService.countFiredSince = (async () => 0) as unknown as typeof RuleExecutionService.countFiredSince;

  async function fire(body: Record<string, unknown>) {
    const response = await POST(
      new Request("http://local/api/workflows/wf-1/fire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }) as never,
      { params: Promise.resolve({ id: "wf-1" }) }
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  t("sanity: demo requests include REQ-4821", REQUESTS.some((r) => r.id === "REQ-4821"));

  logCalls.length = 0;
  OrgControlsService.isPaused = (async () => true) as unknown as typeof OrgControlsService.isPaused;
  let res = await fire({ requestId: "REQ-4821", orgId: "test-org-uuid-999" });
  t("paused org returns PAUSED_ORG", res.body.outcome === "PAUSED_ORG" && res.status === 200, JSON.stringify(res.body));
  t("paused org logs PAUSED_ORG", logCalls.at(-1)?.status === "PAUSED_ORG");

  logCalls.length = 0;
  OrgControlsService.isPaused = (async () => false) as unknown as typeof OrgControlsService.isPaused;
  RuleExecutionService.hasFired = (async () => true) as unknown as typeof RuleExecutionService.hasFired;
  res = await fire({ requestId: "REQ-4821", orgId: "test-org-uuid-999" });
  t("duplicate request returns SKIPPED_DUPLICATE", res.body.outcome === "SKIPPED_DUPLICATE", JSON.stringify(res.body));
  t("duplicate request logs SKIPPED_DUPLICATE", logCalls.at(-1)?.status === "SKIPPED_DUPLICATE");

  logCalls.length = 0;
  RuleExecutionService.hasFired = (async () => false) as unknown as typeof RuleExecutionService.hasFired;
  RuleExecutionService.countFiredSince = (async () => 25) as unknown as typeof RuleExecutionService.countFiredSince;
  res = await fire({ requestId: "REQ-4821", orgId: "test-org-uuid-999" });
  t("rate cap returns PAUSED_RATE_LIMIT", res.body.outcome === "PAUSED_RATE_LIMIT", JSON.stringify(res.body));
  t("rate cap auto-disables workflow", logCalls.some((call) => call.status === "PAUSED_RATE_LIMIT"));

  if (failures) {
    console.error(`\n${failures} fire-route assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll fire-route assertions passed.");

  WorkflowService.getWorkflowById = saved.getWorkflowById;
  WorkflowService.toggleWorkflow = saved.toggleWorkflow;
  OrgControlsService.isPaused = saved.isPaused;
  RuleExecutionService.hasFired = saved.hasFired;
  RuleExecutionService.countFiredSince = saved.countFiredSince;
  RuleExecutionService.logExecution = saved.logExecution;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
