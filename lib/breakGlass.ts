import { Prisma } from "@prisma/client";

export interface BreakGlassInput {
  requestId: string;
  reason: string;
  requestName?: string;
  actorId?: string | null;
}

export interface BreakGlassAuditPayload {
  requestId: string;
  requestName: string;
  eventName: "BREAK_GLASS_OVERRIDE";
  status: "OVERRIDDEN";
  mode: "armed";
  trace: Prisma.InputJsonValue;
  actions: Prisma.InputJsonValue;
}

export function normalizeBreakGlassInput(raw: {
  requestId?: unknown;
  reason?: unknown;
  requestName?: unknown;
  actorId?: unknown;
}): BreakGlassInput {
  const requestId = typeof raw.requestId === "string" ? raw.requestId.trim() : "";
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (!requestId) throw new Error("Request ID is required");
  if (!reason) throw new Error("Break-glass reason is required");
  return {
    requestId,
    reason,
    requestName:
      typeof raw.requestName === "string" && raw.requestName.trim()
        ? raw.requestName.trim()
        : undefined,
    actorId: typeof raw.actorId === "string" && raw.actorId.trim() ? raw.actorId.trim() : null,
  };
}

export function buildBreakGlassAudit(
  input: BreakGlassInput,
  tasksOverridden: number
): BreakGlassAuditPayload {
  return {
    requestId: input.requestId,
    requestName: input.requestName ?? input.requestId,
    eventName: "BREAK_GLASS_OVERRIDE",
    status: "OVERRIDDEN",
    mode: "armed",
    trace: {
      override: true,
      reason: input.reason,
      actorId: input.actorId ?? null,
      tasksOverridden,
    },
    actions: [{ action: "break_glass", reason: input.reason, tasksOverridden }],
  };
}
