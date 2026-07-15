"use client";

import { AlertTriangle, Check, X } from "lucide-react";
import { EvaluationTrace } from "@/lib/api";
import { opLabel, FIELDS } from "@/lib/vocabulary";

/**
 * Colored evaluation-trace tree (schema v3): the OR-combined trigger line, each
 * condition's expected vs actual (green pass / red fail, indented by group
 * depth), dispatched actions, Otherwise actions, and missing-data alerts.
 * Shared by the Simulation panel and the Audit Logs detail (defensive against
 * legacy single-trigger audit rows).
 */
export default function TraceView({
  trace,
  actions,
  elseActions,
  alerts,
}: {
  trace: EvaluationTrace;
  actions: string[];
  elseActions?: string[];
  alerts?: string[];
}) {
  // Back-compat: older audit rows stored a single `trigger` object.
  const legacy = trace as unknown as { trigger?: { event: string; matched: boolean } };
  const triggers = trace.triggers ?? (legacy.trigger ? [legacy.trigger] : []);
  const anyTrigger = triggers.some((t) => t.matched);

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      {/* Triggers (OR) */}
      <div
        className="flex items-start gap-2 rounded-lg px-3 py-2"
        style={{
          background: anyTrigger ? "var(--tok-if-bg)" : "var(--danger-bg)",
          color: anyTrigger ? "var(--tok-if-fg)" : "var(--danger-fg)",
        }}
      >
        <span aria-hidden className="mt-0.5 shrink-0">
          {anyTrigger ? <Check size={15} strokeWidth={2.5} /> : <X size={15} strokeWidth={2.5} />}
        </span>
        <span className="min-w-0">
          {triggers.length > 1 ? "Any trigger " : "Trigger "}
          <span className="font-semibold">
            [{triggers.map((t) => t.event).join(" or ")}]
          </span>{" "}
          {anyTrigger
            ? `matched${triggers.length > 1 && trace.matchedTrigger ? ` (${trace.matchedTrigger})` : ""}`
            : "did not match this request"}
        </span>
      </div>

      {/* Conditions (depth-indented) */}
      {trace.conditions.map((c, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded-lg px-3 py-2"
          style={{
            marginLeft: (c.depth ?? 0) * 16,
            background: c.matched ? "var(--tok-if-bg)" : "var(--danger-bg)",
            color: c.matched ? "var(--tok-if-fg)" : "var(--danger-fg)",
          }}
        >
          <span aria-hidden className="mt-0.5 shrink-0">
            {c.matched ? <Check size={15} strokeWidth={2.5} /> : <X size={15} strokeWidth={2.5} />}
          </span>
          <span className="min-w-0">
            Condition{" "}
            <span className="font-semibold">
              [{c.label} {opLabel(fieldKindOf(c.field), c.operator)} {c.expected}]
            </span>{" "}
            {c.matched ? "passed" : "failed"}{" "}
            <span className="opacity-80">
              (actual: {c.actual === null ? "— not on this request" : c.actual || "empty"})
            </span>
          </span>
        </div>
      ))}
      {trace.conditions.length === 0 && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--tok-op-bg)", color: "var(--fg-muted)" }}>
          No conditions — fires on every event of this type.
        </div>
      )}

      {/* Missing-data alerts (fail-closed) */}
      {alerts && alerts.length > 0 && (
        <div className="mt-1 flex flex-col gap-1 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}>
          {alerts.map((a, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <AlertTriangle size={13} strokeWidth={2} /> {a}
            </span>
          ))}
        </div>
      )}

      {/* Dispatched actions */}
      {actions.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-xs" style={{ color: "var(--fg-subtle)" }}>Actions dispatched:</span>
          {actions.map((a, i) => (
            <span
              key={i}
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ background: "var(--tok-when-bg)", color: "var(--tok-when-fg)" }}
            >
              {a}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-xs" style={{ color: "var(--fg-subtle)" }}>
          No actions dispatched.
        </div>
      )}

      {/* Otherwise (else) actions */}
      {elseActions && elseActions.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-xs" style={{ color: "var(--fg-subtle)" }}>Otherwise would run:</span>
          {elseActions.map((a, i) => (
            <span
              key={i}
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ background: "var(--tok-op-bg)", color: "var(--fg-muted)" }}
            >
              {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Operator wording needs the field's kind; ID-bound (ff:) fields default to text. */
function fieldKindOf(fieldKey: string) {
  return FIELDS[fieldKey]?.kind ?? "text";
}
