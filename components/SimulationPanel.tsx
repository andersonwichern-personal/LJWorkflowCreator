"use client";

import Link from "next/link";
import { useMemo } from "react";
import { WorkflowRule, getAction, paramKeyFor, ActionExecution } from "@/lib/vocabulary";
import { formatCurrency } from "@/lib/platformData";
import { matchingRequests } from "@/lib/ruleEngine";
import StatusBadge from "@/components/ui/StatusBadge";

/** §6c: never let the UI imply a gated action runs — badge each effect's status. */
const STATUS_META: Record<ActionExecution["status"], { label: string; bg: string; fg: string }> = {
  "executable-now": { label: "live", bg: "var(--tok-if-bg)", fg: "var(--tok-if-fg)" },
  "backend-required": { label: "backend", bg: "var(--warn-bg)", fg: "var(--warn-fg)" },
  "mocked-surface": { label: "mocked", bg: "var(--tok-op-bg)", fg: "var(--fg-subtle)" },
};

/**
 * Live "test against real requests" panel. As the rule changes in the builder,
 * this shows which of the representative requests it would match right now and
 * what actions would run — instant feedback grounded in the platform data.
 */
export default function SimulationPanel({ rule }: { rule: WorkflowRule }) {
  const matches = useMemo(() => matchingRequests(rule), [rule]);
  const actions = useMemo(
    () =>
      rule.actions.map((o) => {
        const def = getAction(o.action);
        const label = def?.label ?? o.action;
        const val = def?.paramKind === "none" ? "" : ` ${o.params[paramKeyFor(o.action)] || "…"}`;
        return { text: `${label}${val}`, status: def?.execution.status ?? "backend-required" };
      }),
    [rule]
  );

  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg text-sm" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            🧪
          </span>
          <h3 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>Simulation</h3>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{
            background: matches.length ? "var(--tok-if-bg)" : "var(--tok-op-bg)",
            color: matches.length ? "var(--tok-if-fg)" : "var(--fg-subtle)",
          }}
        >
          {matches.length} match{matches.length === 1 ? "" : "es"}
        </span>
      </div>

      {actions.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs" style={{ color: "var(--fg-subtle)" }}>Would run:</span>
          {actions.map((a, i) => {
            const meta = STATUS_META[a.status];
            return (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "var(--tok-then-bg)", color: "var(--tok-then-fg)" }}>
                → {a.text}
                <span
                  className="rounded-full px-1.5 py-px text-[9px] font-bold uppercase leading-tight"
                  style={{ background: meta.bg, color: meta.fg }}
                  title={
                    a.status === "executable-now"
                      ? "Executable now via the real sink"
                      : a.status === "backend-required"
                      ? "Needs a confirmed backend write endpoint"
                      : "Target surface is mocked in the test tenant"
                  }
                >
                  {meta.label}
                </span>
              </span>
            );
          })}
        </div>
      )}

      {matches.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-4 text-center text-sm" style={{ borderColor: "var(--panel-border)", color: "var(--fg-subtle)" }}>
          No current requests match this trigger + conditions. Loosen the conditions or pick a different event.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {matches.map((r) => (
            <Link
              key={r.id}
              href={`/requests/${r.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 transition-colors hover:bg-[var(--accent-soft)]"
              style={{ borderColor: "var(--panel-border)" }}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium" style={{ color: "var(--fg)" }}>{r.name}</div>
                <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>{r.id} · {r.retailer}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-sm font-semibold sm:block" style={{ color: "var(--fg-muted)" }}>{formatCurrency(r.loanAmount)}</span>
                <StatusBadge status={r.bookStatus === "Error" ? "Error" : r.uwStatus} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
