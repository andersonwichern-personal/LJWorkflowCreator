"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { WorkflowRule, getAction, paramKeyFor, ActionExecution, scopeLabel } from "@sweet/rule-core";
import { formatCurrency, PlatformRequest, REQUESTS } from "@sweet/rule-core";
import { matchingRequests } from "@sweet/rule-core";
import { SimulateResult, simulateWorkflowRule, backtestRule, BacktestResult } from "@/lib/api";
import StatusBadge from "@/components/ui/StatusBadge";
import TraceView from "@/components/TraceView";

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
export default function SimulationPanel({
  rule,
  workflowId,
}: {
  rule: WorkflowRule;
  /** Saved-workflow id — when present, simulator runs are audit-logged. */
  workflowId?: string | null;
}) {
  const matches = useMemo(() => matchingRequests(rule), [rule]);

  // Live request simulator (spec §3A): search → pick → dry-run → trace tree.
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PlatformRequest | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  // Backtest: dry-run the rule across every request record at once (Phase 4 §2).
  const [backtesting, setBacktesting] = useState(false);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return REQUESTS.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.mainBorrower.toLowerCase().includes(q) ||
        r.retailer.toLowerCase().includes(q)
    ).slice(0, 6);
  }, [query]);

  async function runSimulation() {
    if (!selected) return;
    setSimulating(true);
    setSimError(null);
    try {
      setResult(await simulateWorkflowRule(selected.id, rule, workflowId));
    } catch (e: unknown) {
      setResult(null);
      setSimError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setSimulating(false);
    }
  }

  async function runBacktest() {
    setBacktesting(true);
    setSimError(null);
    try {
      setBacktest(await backtestRule(rule));
    } catch (e: unknown) {
      setBacktest(null);
      setSimError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setBacktesting(false);
    }
  }
  const actions = useMemo(
    () =>
      rule.actions.map((o) => {
        const def = getAction(o.action);
        const label = def?.label ?? o.action;
        const val = def?.paramKind === "none" ? "" : ` ${scopeLabel(o.params[paramKeyFor(o.action)]) || "…"}`;
        return { text: `${label}${val}`, status: def?.execution.status ?? "backend-required" };
      }),
    [rule]
  );

  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <FlaskConical size={14} strokeWidth={2} />
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

      {/* Live request simulator: search → select → dry-run */}
      <div className="mb-4 rounded-xl border p-3" style={{ borderColor: "var(--panel-border)" }}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <input
              value={selected ? `${selected.id} — ${selected.name}` : query}
              onChange={(e) => {
                setSelected(null);
                setResult(null);
                setQuery(e.target.value);
              }}
              placeholder="Search a request to simulate against… (id, name, borrower, retailer)"
              className="ring-accent w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)", color: "var(--fg)" }}
              aria-label="Search requests"
            />
            {!selected && searchResults.length > 0 && (
              <div
                className="animate-popin absolute z-20 mt-1 w-full overflow-hidden rounded-xl border shadow-lg"
                style={{ background: "var(--panel-solid)", borderColor: "var(--panel-border)" }}
              >
                {searchResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setSelected(r);
                      setQuery("");
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent-soft)]"
                    style={{ color: "var(--fg)" }}
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{r.name}</span>
                      <span style={{ color: "var(--fg-subtle)" }}> · {r.id} · {r.retailer}</span>
                    </span>
                    <span className="shrink-0 text-xs" style={{ color: "var(--fg-muted)" }}>
                      {formatCurrency(r.loanAmount)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={runSimulation}
            disabled={!selected || simulating}
            className="ring-accent shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            {simulating ? "Simulating…" : "Simulate Rule"}
          </button>
          <button
            type="button"
            onClick={runBacktest}
            disabled={backtesting}
            title="Dry-run this rule against every request record"
            className="ring-accent shrink-0 rounded-xl border px-4 py-2 text-sm font-semibold transition-all hover:bg-[var(--accent-soft)] disabled:opacity-40"
            style={{ borderColor: "var(--panel-border)", color: "var(--fg-muted)" }}
          >
            {backtesting ? "Backtesting…" : "Backtest all"}
          </button>
        </div>

        {simError && (
          <p className="mt-2 text-xs" style={{ color: "var(--danger-fg)" }}>{simError}</p>
        )}

        {backtest && (
          <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--panel-border)" }}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-bold"
                style={{
                  background: backtest.matchCount ? "var(--tok-if-bg)" : "var(--tok-op-bg)",
                  color: backtest.matchCount ? "var(--tok-if-fg)" : "var(--fg-subtle)",
                }}
              >
                {backtest.matchCount} / {backtest.total} requests match
              </span>
              {backtest.alerts.length > 0 && (
                <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}>
                  {backtest.alerts.length} data alert{backtest.alerts.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            {backtest.matches.length > 0 && (
              <div className="flex flex-col gap-1">
                {backtest.matches.slice(0, 8).map((m) => (
                  <div key={m.requestId} className="flex items-center justify-between gap-2 text-xs" style={{ color: "var(--fg-muted)" }}>
                    <span className="min-w-0 truncate">
                      <span className="font-medium" style={{ color: "var(--fg)" }}>{m.name}</span> · {m.requestId}
                    </span>
                    <span className="shrink-0" style={{ color: "var(--fg-subtle)" }}>
                      {m.actions.length ? m.actions.join(", ") : "no actions"}
                    </span>
                  </div>
                ))}
                {backtest.matches.length > 8 && (
                  <span className="text-xs" style={{ color: "var(--fg-subtle)" }}>+{backtest.matches.length - 8} more…</span>
                )}
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="mt-3">
            <div className="mb-2 flex items-center gap-2">
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-bold uppercase"
                style={
                  result.matched
                    ? { background: "var(--tok-if-bg)", color: "var(--tok-if-fg)" }
                    : { background: "var(--tok-op-bg)", color: "var(--fg-subtle)" }
                }
              >
                {result.matched ? "Fired" : "Skipped"}
              </span>
              <span className="text-xs" style={{ color: "var(--fg-subtle)" }}>
                {result.request.id} — {result.request.name}
                {result.logged ? " · logged to audit trail" : ""}
                {result.logError ? ` · log failed: ${result.logError}` : ""}
              </span>
            </div>
            <TraceView trace={result.trace} actions={result.actions} elseActions={result.elseActions} alerts={result.alerts} />
          </div>
        )}
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
