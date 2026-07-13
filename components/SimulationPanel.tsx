"use client";

import Link from "next/link";
import { useMemo } from "react";
import { WorkflowRule } from "@/lib/vocabulary";
import { formatCurrency } from "@/lib/platformData";
import { matchingRequests, describeActions } from "@/lib/ruleEngine";
import StatusBadge from "@/components/ui/StatusBadge";

/**
 * Live "test against real requests" panel. As the rule changes in the builder,
 * this shows which of the representative requests it would match right now and
 * what actions would run — instant feedback grounded in the platform data.
 */
export default function SimulationPanel({ rule }: { rule: WorkflowRule }) {
  const matches = useMemo(() => matchingRequests(rule), [rule]);
  const actions = useMemo(() => describeActions(rule), [rule]);

  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg text-sm" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            🧪
          </span>
          <h3 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>Test against real requests</h3>
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
          {actions.map((a, i) => (
            <span key={i} className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "var(--tok-then-bg)", color: "var(--tok-then-fg)" }}>
              → {a}
            </span>
          ))}
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
      <p className="mt-3 text-[11px]" style={{ color: "var(--fg-subtle)" }}>
        Simulation against representative data — the real event bus runs in the backend.
      </p>
    </div>
  );
}
