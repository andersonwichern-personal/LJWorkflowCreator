/**
 * Thin client for the /api/workflows route handlers (backend scaffolded by the
 * Overseer). Uses a fixed tenant context for the demo, per the UI prompt.
 */

import { WorkflowRule, normalizeRule } from "./vocabulary";

/** Fixed demo tenant. Real app derives org_id from the authed session / JWT. */
export const DEMO_ORG_ID = "test-org-uuid-999";

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
  const res = await fetch(`/api/workflows?orgId=${encodeURIComponent(DEMO_ORG_ID)}`, {
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
  const res = await fetch(`/api/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId: DEMO_ORG_ID, ...input }),
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
  const res = await fetch(`/api/workflows/${id}?orgId=${encodeURIComponent(DEMO_ORG_ID)}`, {
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
  const res = await fetch(`/api/workflows/${id}?orgId=${encodeURIComponent(DEMO_ORG_ID)}`, {
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
  escalationId: string | null;
  autoApprove: boolean;
}

export async function listAuthorities(): Promise<AuthorityRecord[]> {
  const res = await fetch(`/api/platform/authorities?orgId=${encodeURIComponent(DEMO_ORG_ID)}`, {
    cache: "no-store",
  });
  return handle<AuthorityRecord[]>(res);
}

export async function createAuthority(input: AuthorityInput): Promise<AuthorityRecord> {
  const res = await fetch(`/api/platform/authorities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId: DEMO_ORG_ID, ...input }),
  });
  return handle<AuthorityRecord>(res);
}

export async function updateAuthority(
  id: string,
  updates: Partial<AuthorityInput>
): Promise<AuthorityRecord> {
  const res = await fetch(
    `/api/platform/authorities/${id}?orgId=${encodeURIComponent(DEMO_ORG_ID)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );
  return handle<AuthorityRecord>(res);
}

export async function deleteAuthority(id: string): Promise<void> {
  const res = await fetch(
    `/api/platform/authorities/${id}?orgId=${encodeURIComponent(DEMO_ORG_ID)}`,
    { method: "DELETE" }
  );
  await handle<{ success: boolean }>(res);
}
