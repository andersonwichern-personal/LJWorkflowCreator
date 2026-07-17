/**
 * Action executor service (Phase 4 §1).
 *
 * Extracted from app/api/execute/route.ts so both the thin /api/execute wrapper
 * and the /api/workflows/[id]/fire route share one execution path. Honesty
 * guardrail intact: only `notify` (Novu) and `assign_authority` (matrix
 * evaluator) do real work; every other action reports its ActionDef status
 * instead of pretending to run.
 *
 * `executeAction` runs a single action with its failure policy (retry/skip/halt).
 * `executeActions` runs a sequence, honoring halt-on-failure between steps.
 */

import { getAction, scopeLabel, ScopeValue, RuleOutput, paramKeyFor } from "@sweet/rule-core";
import { decideAuthority, AuthorityInput } from "@/lib/authorityEngine";
import { ApprovalAuthorityService } from "@/lib/services/authority";
import { SinkHealthService } from "@/lib/services/sinkHealth";
import { breakerAllows } from "@/lib/circuitBreaker";

/** Demo tenant fallback, matching the authorities routes. */
const DEFAULT_ORG_ID = "test-org-uuid-999";

export interface ExecuteContext {
  orgId?: string;
  /** Request context for authority decisioning (amount/grade/product/id). */
  request?: Partial<AuthorityInput> & { requestId?: string };
}

export interface ActionResult {
  executed: boolean;
  action: string;
  status: string;
  detail?: string;
  sink?: string;
  transactionId?: string | null;
  decision?: unknown;
  /** Attempts made before this result was returned (retry accounting). */
  attempts?: number;
  /** True when a `halt` action failed and stopped the remaining sequence. */
  halted?: boolean;
}

/**
 * Failure taxonomy:
 *  - "failed"          → a real runner error (Novu HTTP error / thrown) — transient, retry-eligible.
 *  - "invalid"         → bad input (no recipient, missing context) — a failure, but retrying won't help.
 *  - "integration-unavailable" → the sink's circuit is OPEN (Phase 8 §11): a failure for
 *                        sequencing (halt applies), but never retried — the breaker is the
 *                        one deciding when the sink may be tried again. Kept distinct from
 *                        "failed" so outage noise doesn't read as rule misconfiguration.
 *  - everything else   → a completed side effect ("sent") or an honest no-op
 *                        ("backend-required"/"mocked-surface"/"not-configured"): not a failure.
 */
function isFailure(result: ActionResult): boolean {
  return (
    result.status === "failed" ||
    result.status === "invalid" ||
    result.status === "integration-unavailable"
  );
}
function isRetryable(result: ActionResult): boolean {
  return result.status === "failed";
}

/**
 * Execute one action with its failure policy. `retry` (default) makes up to
 * `maxAttempts` attempts on a *transient* failure; `skip`/`halt` make a single
 * attempt and let the caller decide sequencing. Deterministic no-ops and
 * bad-input failures never loop.
 */
export async function executeAction(
  action: string,
  params: Record<string, ScopeValue>,
  ctx: ExecuteContext = {},
  policy: { onFailure?: "retry" | "skip" | "halt"; maxAttempts?: number } = {}
): Promise<ActionResult> {
  const def = getAction(action);
  if (!def) {
    return { executed: false, action, status: "invalid", detail: `Unknown action: ${action}`, attempts: 1 };
  }

  const onFailure = policy.onFailure ?? "retry";
  const maxAttempts = onFailure === "retry" ? Math.max(1, policy.maxAttempts ?? 3) : 1;

  let last: ActionResult = { executed: false, action, status: "unknown", attempts: 0 };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await runOnce(def.key, params, ctx);
    last.attempts = attempt;
    if (!isFailure(last)) return last; // success or honest no-op → done
    if (!isRetryable(last)) break; // bad input won't improve on retry
  }
  return last;
}

/**
 * Execute a rule's action list sequentially. Each action's `onFailure` governs
 * its own retry; a failed `halt` action stops the remaining sequence (the rest
 * are returned with status "not-run"). Returns every attempted result in order.
 */
export async function executeActions(
  actions: RuleOutput[],
  ctx: ExecuteContext = {}
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const result = await executeAction(a.action, a.params, ctx, { onFailure: a.onFailure });
    if (isFailure(result) && a.onFailure === "halt") {
      result.halted = true;
      results.push(result);
      for (let j = i + 1; j < actions.length; j++) {
        results.push({ executed: false, action: actions[j].action, status: "not-run", detail: "Halted by a prior failure.", attempts: 0 });
      }
      break;
    }
    results.push(result);
  }
  return results;
}

/** One real attempt at a single action, dispatched by kind. */
async function runOnce(
  key: string,
  params: Record<string, ScopeValue>,
  ctx: ExecuteContext
): Promise<ActionResult> {
  const def = getAction(key)!;
  try {
    switch (key) {
      case "notify":
        return await executeNotify(params, ctx);
      case "assign_authority":
        return await executeAuthority(params, ctx);
      default:
        return {
          executed: false,
          action: key,
          status: def.execution.status,
          sink: def.execution.sink,
          detail:
            def.execution.status === "mocked-surface"
              ? "Target surface is client-mocked in the test tenant."
              : "Awaiting a confirmed write endpoint in the admin repo (build manual §12).",
        };
    }
  } catch (error: unknown) {
    return {
      executed: false,
      action: key,
      status: "failed",
      detail: error instanceof Error ? error.message : "Execution failed",
    };
  }
}

/**
 * `notify` via the Novu trigger API. Env-gated: without NOVU_API_KEY the route
 * degrades to a not-configured result instead of faking success.
 */
async function executeNotify(params: Record<string, ScopeValue>, ctx: ExecuteContext): Promise<ActionResult> {
  const apiKey = process.env.NOVU_API_KEY?.trim();
  const workflowId = process.env.NOVU_WORKFLOW_ID?.trim() || "workflow-notify";
  const recipient = scopeLabel(params?.value) || scopeLabel(params?.[paramKeyFor("notify")]) || scopeLabel(params?.recipient) || "";

  if (!recipient) {
    return { executed: false, action: "notify", status: "invalid", detail: "No recipient given." };
  }
  if (!apiKey) {
    return {
      executed: false,
      action: "notify",
      status: "not-configured",
      detail: "Set NOVU_API_KEY (and optionally NOVU_WORKFLOW_ID) to send real notifications.",
    };
  }

  // Phase 8 §11 — circuit breaker: an open Novu circuit fails fast instead of
  // hanging on a known-down sink. Breaker bookkeeping never blocks the dispatch
  // path itself (a health-table hiccup must not take notifications down).
  const orgId = ctx.orgId || DEFAULT_ORG_ID;
  const nowIso = new Date().toISOString();
  try {
    const state = await SinkHealthService.getState(orgId, "novu");
    if (!breakerAllows(state, nowIso)) {
      return {
        executed: false,
        action: "notify",
        status: "integration-unavailable",
        sink: "novu",
        detail: "Novu circuit is open after repeated failures — failing fast until the cooldown elapses.",
      };
    }
  } catch {
    /* health lookup failed — proceed with the real call */
  }

  let res: Response;
  try {
    res = await fetch("https://api.novu.co/v1/events/trigger", {
      method: "POST",
      headers: { Authorization: `ApiKey ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: workflowId,
        to: { subscriberId: recipient },
        payload: { requestId: ctx.request?.requestId ?? null, source: "lj-workflow-creator" },
      }),
      cache: "no-store",
    });
  } catch (error: unknown) {
    await SinkHealthService.record(orgId, "novu", "failure", nowIso).catch(() => {});
    return {
      executed: false,
      action: "notify",
      status: "failed",
      detail: error instanceof Error ? error.message : "Novu request failed",
    };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => `HTTP ${res.status}`);
    await SinkHealthService.record(orgId, "novu", "failure", nowIso).catch(() => {});
    return { executed: false, action: "notify", status: "failed", detail };
  }
  await SinkHealthService.record(orgId, "novu", "success", nowIso).catch(() => {});
  const out = (await res.json().catch(() => ({}))) as { data?: { transactionId?: string } };
  return { executed: true, action: "notify", status: "sent", transactionId: out.data?.transactionId ?? null };
}

/**
 * `escalate to authority`: run the matrix evaluator over the tenant's
 * configured levels. The resolved routing is the executable output today; the
 * assignment write itself remains backend-required.
 */
async function executeAuthority(params: Record<string, ScopeValue>, ctx: ExecuteContext): Promise<ActionResult> {
  const { amount, riskGrade, product } = ctx.request ?? {};
  if (typeof amount !== "number" || !riskGrade || !product) {
    return {
      executed: false,
      action: "assign_authority",
      status: "invalid",
      detail: "request.amount (number), request.riskGrade, and request.product are required.",
    };
  }

  const orgId = ctx.orgId || DEFAULT_ORG_ID;
  const authorities = await ApprovalAuthorityService.listAuthorities(orgId);
  const decision = decideAuthority(
    { amount, riskGrade, product },
    authorities.map((a) => ({
      ...a,
      limit: Number(a.limit),
      userIds: Array.isArray(a.userIds) ? (a.userIds as string[]) : [],
    }))
  );

  return {
    executed: false, // the assignment write itself is backend-required
    action: "assign_authority",
    status: "backend-required",
    decision: {
      authority: decision.authority ? { id: decision.authority.id, name: decision.authority.name } : null,
      lane: decision.lane,
      assignees: decision.authority?.userIds ?? [],
      escalationChain: decision.escalationChain.map((a) => a.name),
      reason: decision.reason,
    },
  };
}
