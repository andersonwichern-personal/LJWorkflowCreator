/**
 * Thin client for the /api/workflows + /api/platform route handlers.
 *
 * Tenant identity is resolved once from /api/platform/me (alignment doc
 * §4c/§8: one real org everywhere — the same org scopes persistence and the
 * platform bridge). Falls back to the demo tenant when no live session exists.
 */

import { WorkflowRule, normalizeRule } from "./vocabulary";

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
