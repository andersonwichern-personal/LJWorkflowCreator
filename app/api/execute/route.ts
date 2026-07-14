import { NextRequest, NextResponse } from "next/server";
import { getAction, scopeLabel, ScopeValue } from "@/lib/vocabulary";
import { decideAuthority, AuthorityInput } from "@/lib/authorityEngine";
import { ApprovalAuthorityService } from "@/lib/services/authority";

export const dynamic = "force-dynamic";

/** Demo tenant fallback, matching the authorities routes. */
const DEFAULT_ORG_ID = "test-org-uuid-999";

interface ExecuteBody {
  action: string;
  params?: Record<string, ScopeValue>;
  orgId?: string;
  /** Request context for authority decisioning (amount/grade/product). */
  context?: Partial<AuthorityInput> & { requestId?: string };
}

/**
 * POST /api/execute — the action executor (alignment doc §6a/§6b).
 *
 * First real sink: `notify` → Novu event trigger (the admin's inbox is already
 * wired). `assign_authority` runs the authority evaluator and returns the
 * resolved routing. Every other action honestly reports its execution status
 * from the ActionDef contract instead of pretending to run.
 */
export async function POST(req: NextRequest) {
  let body: ExecuteBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = getAction(body.action ?? "");
  if (!action) {
    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }

  try {
    switch (action.key) {
      case "notify":
        return NextResponse.json(await executeNotify(body));
      case "assign_authority":
        return NextResponse.json(await executeAuthority(body));
      default:
        return NextResponse.json({
          executed: false,
          action: action.key,
          status: action.execution.status,
          sink: action.execution.sink,
          detail:
            action.execution.status === "mocked-surface"
              ? "Target surface is client-mocked in the test tenant."
              : "Awaiting a confirmed write endpoint in the admin repo (build manual §12).",
        });
    }
  } catch (error: unknown) {
    console.error(`Execute failed for ${action.key}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Execution failed" },
      { status: 500 }
    );
  }
}

/**
 * `notify` via the Novu trigger API. Env-gated: without NOVU_API_KEY the route
 * degrades to a not-configured result instead of faking success.
 */
async function executeNotify(body: ExecuteBody) {
  const apiKey = process.env.NOVU_API_KEY?.trim();
  const workflowId = process.env.NOVU_WORKFLOW_ID?.trim() || "workflow-notify";
  const recipient = scopeLabel(body.params?.value) || scopeLabel(body.params?.recipient) || "";

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

  const res = await fetch("https://api.novu.co/v1/events/trigger", {
    method: "POST",
    headers: {
      Authorization: `ApiKey ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: workflowId,
      to: { subscriberId: recipient },
      payload: {
        requestId: body.context?.requestId ?? null,
        source: "lj-workflow-creator",
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => `HTTP ${res.status}`);
    return { executed: false, action: "notify", status: "failed", detail };
  }
  const out = (await res.json().catch(() => ({}))) as { data?: { transactionId?: string } };
  return {
    executed: true,
    action: "notify",
    status: "sent",
    transactionId: out.data?.transactionId ?? null,
  };
}

/**
 * `escalate to authority`: run the matrix evaluator over the tenant's
 * configured levels. The resolved routing (owning level, lane, chain) is the
 * executable output today; a hard approval gate remains backend-required.
 */
async function executeAuthority(body: ExecuteBody) {
  const { amount, riskGrade, product } = body.context ?? {};
  if (typeof amount !== "number" || !riskGrade || !product) {
    return {
      executed: false,
      action: "assign_authority",
      status: "invalid",
      detail: "context.amount (number), context.riskGrade, and context.product are required.",
    };
  }

  const orgId = body.orgId || DEFAULT_ORG_ID;
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
