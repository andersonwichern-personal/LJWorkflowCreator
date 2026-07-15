"use client";

import { useCallback, useEffect, useState } from "react";
import { ExecutionRecord, EvaluationTrace, listExecutions } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import TraceView from "@/components/TraceView";

const STATUS_STYLE: Record<ExecutionRecord["status"], { label: string; bg: string; fg: string }> = {
  FIRED: { label: "FIRED", bg: "var(--tok-if-bg)", fg: "var(--tok-if-fg)" },
  CONDITIONS_NOT_MET: { label: "SKIPPED", bg: "var(--tok-op-bg)", fg: "var(--fg-subtle)" },
  ERROR: { label: "ERROR", bg: "var(--danger-bg)", fg: "var(--danger-fg)" },
  SHADOW: { label: "SHADOW", bg: "var(--tok-op-bg)", fg: "var(--fg-subtle)" },
  PAUSED_ORG: { label: "PAUSED", bg: "var(--tok-op-bg)", fg: "var(--fg-subtle)" },
  SKIPPED_DUPLICATE: { label: "SKIPPED", bg: "var(--tok-op-bg)", fg: "var(--fg-subtle)" },
  PAUSED_RATE_LIMIT: { label: "PAUSED", bg: "var(--tok-op-bg)", fg: "var(--fg-subtle)" },
};

/** Enforcement-mode tag colors (Phase 4 §4). */
const MODE_STYLE: Record<"armed" | "shadow", { label: string; bg: string; fg: string }> = {
  armed: { label: "ARMED", bg: "var(--danger-bg)", fg: "var(--danger-fg)" },
  shadow: { label: "SHADOW", bg: "var(--tok-when-bg)", fg: "var(--tok-when-fg)" },
};

const MODE_FILTERS = ["All", "Armed", "Shadow"] as const;
type ModeFilter = (typeof MODE_FILTERS)[number];

function isTrace(t: ExecutionRecord["evaluationTrace"]): t is EvaluationTrace {
  return !!t && typeof t === "object" && "triggers" in t;
}

/**
 * Execution-history audit log (simulator spec §3B): every persisted rule
 * evaluation, newest first. Click a row for the full evaluation trace.
 */
export default function AuditLogs() {
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ExecutionRecord | null>(null);
  const [modeFilter, setModeFilter] = useState<ModeFilter>("All");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setExecutions(await listExecutions());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't load audit logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const fired = executions.filter((e) => e.status === "FIRED").length;
  const visible = executions.filter((e) =>
    modeFilter === "All" ? true : (e.mode ?? "shadow") === modeFilter.toLowerCase()
  );

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        icon="🧾"
        actions={
          <>
            <div
              className="flex items-center rounded-xl border p-0.5"
              style={{ borderColor: "var(--panel-border)", background: "var(--panel-solid)" }}
              role="group"
              aria-label="Filter by enforcement mode"
            >
              {MODE_FILTERS.map((f) => {
                const active = modeFilter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setModeFilter(f)}
                    aria-pressed={active}
                    className="ring-accent rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-all"
                    style={active ? { background: "var(--accent)", color: "#fff" } : { color: "var(--fg-muted)" }}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
            <span
              className="rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ background: "var(--panel)", border: "1px solid var(--panel-border)", color: "var(--fg-muted)" }}
            >
              {visible.length} shown · {fired} fired
            </span>
            <button
              type="button"
              onClick={refresh}
              className="ring-accent rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-[var(--accent-soft)]"
              style={{ borderColor: "var(--panel-border)", color: "var(--fg-muted)" }}
            >
              Refresh
            </button>
          </>
        }
      />

      <div className="glass overflow-hidden rounded-2xl">
        {loading ? (
          <div className="px-4 py-10 text-center text-sm" style={{ color: "var(--fg-subtle)" }}>
            Loading…
          </div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-sm" style={{ color: "var(--danger-fg)" }}>
            {error}
          </div>
        ) : visible.length === 0 ? (
          <div className="m-4 rounded-xl border border-dashed px-4 py-10 text-center text-sm" style={{ borderColor: "var(--panel-border)", color: "var(--fg-subtle)" }}>
            {executions.length === 0
              ? "No rule evaluations logged yet. Select a saved workflow in the Rules Canvas and run the simulator — attributable runs land here."
              : `No ${modeFilter.toLowerCase()} evaluations to show.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Rule</th>
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Trigger Event</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => {
                  const s = STATUS_STYLE[e.status] ?? STATUS_STYLE.ERROR;
                  const m = MODE_STYLE[(e.mode ?? "shadow") as "armed" | "shadow"];
                  return (
                    <tr
                      key={e.id}
                      onClick={() => setSelected(e)}
                      className="cursor-pointer border-t transition-colors hover:bg-[var(--accent-soft)]"
                      style={{ borderColor: "var(--panel-border)" }}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-xs" style={{ color: "var(--fg-muted)" }}>
                        {new Date(e.createdAt).toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-3 font-medium" style={{ color: "var(--fg)" }}>
                        {e.workflow?.name ?? "(deleted workflow)"}
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--fg-muted)" }}>
                        {e.requestName}
                        <span className="text-xs" style={{ color: "var(--fg-subtle)" }}> · {e.requestId}</span>
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold uppercase" style={{ color: "var(--fg-muted)" }}>
                        {e.eventName}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: m.bg, color: m.fg }}>
                          {m.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: s.bg, color: s.fg }}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--fg-muted)" }}>
                        {Array.isArray(e.actionsDispatched) && e.actionsDispatched.length
                          ? e.actionsDispatched.join(", ")
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Trace detail side panel */}
      {selected && (
        <>
          <div
            className="fixed inset-0 z-50"
            style={{ background: "rgba(2, 6, 23, 0.4)" }}
            onClick={() => setSelected(null)}
            aria-hidden
          />
          <div
            className="animate-slidein fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col overflow-y-auto border-l p-6"
            style={{ background: "var(--panel-solid)", borderColor: "var(--panel-border)" }}
            role="dialog"
            aria-label="Evaluation trace"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: "var(--fg)" }}>
                Evaluation trace
              </h2>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="ring-accent flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors hover:bg-[var(--accent-soft)]"
                style={{ color: "var(--fg-subtle)" }}
              >
                ×
              </button>
            </div>

            <div className="mb-4 rounded-xl border p-3 text-sm" style={{ borderColor: "var(--panel-border)" }}>
              <div style={{ color: "var(--fg)" }} className="font-medium">
                {selected.workflow?.name ?? "(deleted workflow)"}
              </div>
              <div className="mt-0.5 text-xs" style={{ color: "var(--fg-muted)" }}>
                {selected.requestName} ({selected.requestId}) · {selected.eventName} ·{" "}
                {new Date(selected.createdAt).toLocaleString("en-US")}
              </div>
            </div>

            {isTrace(selected.evaluationTrace) ? (
              <TraceView
                trace={selected.evaluationTrace}
                actions={Array.isArray(selected.actionsDispatched) ? selected.actionsDispatched : []}
              />
            ) : (
              <div
                className="rounded-lg px-3 py-2 text-sm"
                style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}
              >
                Evaluator error: {(selected.evaluationTrace as { error?: string })?.error ?? "unknown"}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
