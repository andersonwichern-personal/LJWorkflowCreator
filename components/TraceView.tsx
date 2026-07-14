"use client";

import { EvaluationTrace } from "@/lib/api";
import { opLabel, FIELDS } from "@/lib/vocabulary";

/**
 * Colored evaluation-trace tree (simulator spec §3A): trigger check, each
 * condition's expected vs actual (green pass / red fail), dispatched actions
 * as blue badges. Shared by the Simulation panel and the Audit Logs detail.
 */
export default function TraceView({
  trace,
  actions,
}: {
  trace: EvaluationTrace;
  actions: string[];
}) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      {/* Trigger */}
      <div
        className="flex items-start gap-2 rounded-lg px-3 py-2"
        style={{
          background: trace.trigger.matched ? "var(--tok-if-bg)" : "var(--danger-bg)",
          color: trace.trigger.matched ? "var(--tok-if-fg)" : "var(--danger-fg)",
        }}
      >
        <span aria-hidden className="font-bold">{trace.trigger.matched ? "✓" : "✗"}</span>
        <span>
          Trigger <span className="font-semibold">[{trace.trigger.event}]</span>{" "}
          {trace.trigger.matched ? "matched" : "did not match this request"}
        </span>
      </div>

      {/* Conditions */}
      {trace.conditions.map((c, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded-lg px-3 py-2"
          style={{
            background: c.matched ? "var(--tok-if-bg)" : "var(--danger-bg)",
            color: c.matched ? "var(--tok-if-fg)" : "var(--danger-fg)",
          }}
        >
          <span aria-hidden className="font-bold">{c.matched ? "✓" : "✗"}</span>
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
    </div>
  );
}

/** Operator wording needs the field's kind; ID-bound (ff:) fields default to text. */
function fieldKindOf(fieldKey: string) {
  return FIELDS[fieldKey]?.kind ?? "text";
}
