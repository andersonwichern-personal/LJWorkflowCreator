/**
 * Thin client for the /api/workflows + /api/platform route handlers.
 *
 * Tenant identity is resolved once from /api/platform/me (alignment doc
 * §4c/§8: one real org everywhere — the same org scopes persistence and the
 * platform bridge). Falls back to the demo tenant when no live session exists.
 */

import { WorkflowRule, normalizeRule } from "./vocabulary";
import { ApprovalRequirement, ApprovalVerdict, RequirementStatus } from "./authorityEngine";

/** Demo tenant used only when /api/platform/me can't resolve a real org. */
const DEMO_FALLBACK_ORG_ID = "test-org-uuid-999";

let orgPromise: Promise<string> | null = null;

/** Resolve (and cache) the tenant org id for this session. */
export function getOrgId(): Promise<string> {
  if (!orgPromise) {
    orgPromise = fetch("/api/platform/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => body?.orgId || DEMO_FALLBACK_ORG_ID)
      .catch(() => DEMO_FALLBACK_ORG_ID);
  }
  return orgPromise;
}

export interface WorkflowRecord {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  ruleJson: WorkflowRule;
  createdAt: string;
  updatedAt: string;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore parse errors */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/** Upgrade a record's rule JSON to the versioned v2 schema (handles legacy rows). */
function normalizeRecord(rec: WorkflowRecord): WorkflowRecord {
  return { ...rec, ruleJson: normalizeRule(rec.ruleJson) };
}

export async function listWorkflows(): Promise<WorkflowRecord[]> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/workflows?orgId=${encodeURIComponent(orgId)}`, {
    cache: "no-store",
  });
  return (await handle<WorkflowRecord[]>(res)).map(normalizeRecord);
}

export async function createWorkflow(input: {
  name: string;
  description?: string;
  ruleJson: WorkflowRule;
  enabled?: boolean;
}): Promise<WorkflowRecord> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, ...input }),
  });
  return normalizeRecord(await handle<WorkflowRecord>(res));
}

export async function updateWorkflow(
  id: string,
  updates: Partial<{
    name: string;
    description: string | null;
    enabled: boolean;
    ruleJson: WorkflowRule;
  }>
): Promise<WorkflowRecord> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/workflows/${id}?orgId=${encodeURIComponent(orgId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return normalizeRecord(await handle<WorkflowRecord>(res));
}

export async function toggleWorkflow(id: string, enabled: boolean): Promise<WorkflowRecord> {
  return updateWorkflow(id, { enabled });
}

export async function deleteWorkflow(id: string): Promise<void> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/workflows/${id}?orgId=${encodeURIComponent(orgId)}`, {
    method: "DELETE",
  });
  await handle<{ success: boolean }>(res);
}

/* -------------------------------------------------------------------------- */
/* Approval Authorities — /api/platform/authorities                           */
/* -------------------------------------------------------------------------- */

export interface AuthorityRecord {
  id: string;
  orgId: string;
  name: string;
  /** Prisma Decimal serializes to a string over JSON. */
  limit: string | number;
  riskGrade: string;
  product: string;
  userIds: string[];
  /** Phase 3: configured approval topology (null → legacy any-of userIds). */
  requirement: ApprovalRequirement | null;
  escalationId: string | null;
  autoApprove: boolean;
  createdAt: string;
  updatedAt: string;
  escalation: { id: string; name: string } | null;
}

export interface AuthorityInput {
  name: string;
  limit: number;
  riskGrade: string;
  product: string;
  userIds: string[];
  requirement: ApprovalRequirement | null;
  escalationId: string | null;
  autoApprove: boolean;
}

export async function listAuthorities(): Promise<AuthorityRecord[]> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/platform/authorities?orgId=${encodeURIComponent(orgId)}`, {
    cache: "no-store",
  });
  return handle<AuthorityRecord[]>(res);
}

export async function createAuthority(input: AuthorityInput): Promise<AuthorityRecord> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/platform/authorities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, ...input }),
  });
  return handle<AuthorityRecord>(res);
}

export async function updateAuthority(
  id: string,
  updates: Partial<AuthorityInput>
): Promise<AuthorityRecord> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/platform/authorities/${id}?orgId=${encodeURIComponent(orgId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return handle<AuthorityRecord>(res);
}

export async function deleteAuthority(id: string): Promise<void> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/platform/authorities/${id}?orgId=${encodeURIComponent(orgId)}`, {
    method: "DELETE",
  });
  await handle<{ success: boolean }>(res);
}

/* -------------------------------------------------------------------------- */
/* Customers — /api/platform/customers                                        */
/* -------------------------------------------------------------------------- */

export interface CustomerRecord {
  id: string;
  orgId: string;
  type: "Business" | "Individual";
  name: string;
  status: "active" | "merged" | "archived";
  mergedIntoId: string | null;
  version: number;
}

export interface CustomerGraphRole {
  id: string;
  orgId: string;
  requestId: string;
  customerId: string;
  role: string;
}

export interface CustomerExposureSummary {
  customerId: string;
  canonicalCustomerId: string | null;
  connectedPartyCount: number;
  relationshipCount: number;
  brokenReferenceCount: number;
  connectedCustomers: Array<{ id: string; name: string; status: "active" | "merged" | "archived" | string }>;
}

export async function listCustomers(requestId?: string): Promise<{
  customers: CustomerRecord[];
  roles: CustomerGraphRole[];
  summaries: CustomerExposureSummary[];
}> {
  const orgId = await getOrgId();
  const qs = new URLSearchParams({ orgId });
  if (requestId) qs.set("requestId", requestId);
  const res = await fetch(`/api/platform/customers?${qs}`, { cache: "no-store" });
  return handle<{ customers: CustomerRecord[]; roles: CustomerGraphRole[]; summaries: CustomerExposureSummary[] }>(res);
}

export async function mergeCustomersApi(input: {
  survivorId: string;
  duplicateId: string;
  reason: string;
  actorId?: string;
  expectedVersion?: number;
}): Promise<{ survivorId: string; duplicateId: string; movedRoles: number; movedRelationships: number; noOp?: boolean }> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/platform/customers/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, ...input }),
  });
  return handle<{ survivorId: string; duplicateId: string; movedRoles: number; movedRelationships: number; noOp?: boolean }>(res);
}

/* -------------------------------------------------------------------------- */
/* Approval Tasks — /api/platform/authorities/tasks                           */
/* -------------------------------------------------------------------------- */

export interface DecisionRecord {
  id: string;
  taskId: string;
  approverId: string;
  approverLabel: string;
  verdict: ApprovalVerdict;
  note: string | null;
  createdAt: string;
}

export interface ApprovalTaskRecord {
  id: string;
  orgId: string;
  authorityId: string;
  requestId: string;
  /** Envelope persisted server-side: topology + frozen maker-checker exclusions. */
  requirement: {
    requirement: ApprovalRequirement;
    exclusions: string[];
    delegations: { fromId: string; toId: string }[];
  };
  status: "open" | "approved" | "declined" | "expired";
  createdAt: string;
  decisions: DecisionRecord[];
  authority: { id: string; name: string } | null;
  /** Server-evaluated quorum/sequence progress at read time. */
  requirementStatus: RequirementStatus;
}

export async function listApprovalTasks(requestId?: string): Promise<ApprovalTaskRecord[]> {
  const orgId = await getOrgId();
  const qs = new URLSearchParams({ orgId });
  if (requestId) qs.set("requestId", requestId);
  const res = await fetch(`/api/platform/authorities/tasks?${qs}`, { cache: "no-store" });
  return handle<ApprovalTaskRecord[]>(res);
}

export async function createApprovalTask(input: {
  authorityId: string;
  requestId: string;
  requirement?: ApprovalRequirement;
  exclusions?: string[];
}): Promise<ApprovalTaskRecord> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/platform/authorities/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, ...input }),
  });
  return handle<ApprovalTaskRecord>(res);
}

export async function recordApprovalDecision(
  taskId: string,
  input: { approverId: string; approverLabel?: string; verdict: ApprovalVerdict; note?: string }
): Promise<ApprovalTaskRecord> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/platform/authorities/tasks/${taskId}/decisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, ...input }),
  });
  return handle<ApprovalTaskRecord>(res);
}

/* -------------------------------------------------------------------------- */
/* Simulator + Audit Logs — /api/workflows/simulate, /api/workflows/executions */
/* -------------------------------------------------------------------------- */

export interface ConditionTraceRecord {
  field: string;
  label: string;
  operator: string;
  expected: string;
  actual: string | null;
  matched: boolean;
  /** Nesting depth for indented rendering (0 = a leaf of the root group). */
  depth: number;
}

export interface TriggerTraceRecord {
  event: string;
  matched: boolean;
}

export interface EvaluationTrace {
  /** Every trigger (OR-combined); `matchedTrigger` is the first that matched. */
  triggers: TriggerTraceRecord[];
  matchedTrigger: string | null;
  conditions: ConditionTraceRecord[];
}

export interface SimulateResult {
  matched: boolean;
  trace: EvaluationTrace;
  actions: string[];
  /** Otherwise-branch descriptors when a trigger matched but conditions failed. */
  elseActions: string[];
  /** missingData:"alert" fields absent from the request (fail-closed). */
  alerts: string[];
  request: { id: string; name: string };
  logged: boolean;
  logError?: string;
}

export type ExecutionStatus =
  | "FIRED"
  | "CONDITIONS_NOT_MET"
  | "ERROR"
  | "SHADOW"
  | "PAUSED_ORG"
  | "SKIPPED_DUPLICATE"
  | "PAUSED_RATE_LIMIT";

export interface ExecutionRecord {
  id: string;
  orgId: string;
  workflowId: string;
  requestId: string;
  requestName: string;
  eventName: string;
  status: ExecutionStatus;
  /** Phase 4: enforcement mode captured at fire time. */
  mode?: "shadow" | "armed";
  evaluationTrace: EvaluationTrace | { error?: string };
  actionsDispatched: string[];
  createdAt: string;
  workflow: { id: string; name: string } | null;
}

/** Dry-run the rule against a request; logs to the audit trail when workflowId is given. */
export async function simulateWorkflowRule(
  requestId: string,
  rule: WorkflowRule,
  workflowId?: string | null
): Promise<SimulateResult> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/workflows/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, rule, orgId, workflowId: workflowId || undefined }),
  });
  return handle<SimulateResult>(res);
}

export async function listExecutions(): Promise<ExecutionRecord[]> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/workflows/executions?orgId=${encodeURIComponent(orgId)}`, {
    cache: "no-store",
  });
  return handle<ExecutionRecord[]>(res);
}

/* -------------------------------------------------------------------------- */
/* Phase 4 — backtest, fire, and org automation controls                      */
/* -------------------------------------------------------------------------- */

export interface BacktestResult {
  total: number;
  matchCount: number;
  matches: { requestId: string; name: string; matchedTrigger: string | null; actions: string[] }[];
  alerts: string[];
}

/** Dry-run a rule against every request record (no side effects, nothing logged). */
export async function backtestRule(rule: WorkflowRule): Promise<BacktestResult> {
  const res = await fetch(`/api/workflows/backtest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rule }),
  });
  return handle<BacktestResult>(res);
}

export interface FireResult {
  outcome: ExecutionStatus;
  fired: boolean;
  matched?: boolean;
  mode?: "shadow" | "armed";
  reason?: string;
  actions?: string[];
  wouldRun?: string[];
}

/** Run the real fire path (guardrails enforced server-side). */
export async function fireWorkflow(workflowId: string, requestId: string): Promise<FireResult> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/workflows/${workflowId}/fire`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, orgId }),
  });
  return handle<FireResult>(res);
}

export interface OrgControls {
  orgId: string;
  automationsPaused: boolean;
  updatedAt: string | null;
}

export async function getOrgControls(): Promise<OrgControls> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/platform/controls?orgId=${encodeURIComponent(orgId)}`, {
    cache: "no-store",
  });
  return handle<OrgControls>(res);
}

export async function setAutomationsPaused(paused: boolean): Promise<OrgControls> {
  const orgId = await getOrgId();
  const res = await fetch(`/api/platform/controls`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, automationsPaused: paused }),
  });
  return handle<OrgControls>(res);
}
