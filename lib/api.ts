/**
 * Thin client for the /api/workflows route handlers (backend scaffolded by the
 * Overseer). Uses a fixed tenant context for the demo, per the UI prompt.
 */

import { WorkflowRule } from "./vocabulary";

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

export async function listWorkflows(): Promise<WorkflowRecord[]> {
  const res = await fetch(`/api/workflows?orgId=${encodeURIComponent(DEMO_ORG_ID)}`, {
    cache: "no-store",
  });
  return handle<WorkflowRecord[]>(res);
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
  return handle<WorkflowRecord>(res);
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
  return handle<WorkflowRecord>(res);
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
