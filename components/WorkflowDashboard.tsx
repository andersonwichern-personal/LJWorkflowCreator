"use client";

/**
 * Phase 5: the landing "Existing Workflows" dashboard.
 *
 * Lists every persisted workflow in a table (Name · Trigger · Mode · Status ·
 * Edit) and gates actions by viewpoint:
 *   - Admin (Anderson)     → "+ New Workflow", full edit + toggle, can approve
 *                            proposed drafts.
 *   - Committee (Wael)     → "Propose Workflow" (saves as a proposed draft that
 *                            needs Admin approval); rows are view-only.
 *   - Preparer (Omar)      → read-only list, no create/edit affordances.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  GitBranch,
  Lock,
  Pencil,
  Plus,
  Clock,
  Flame,
  TrendingUp,
} from "lucide-react";
import {
  ExecutionAnalytics,
  WorkflowRecord,
  fetchExecutionAnalytics,
  listWorkflows,
  toggleWorkflow,
  updateWorkflow,
} from "@/lib/api";
import { matchRatePct } from "@/lib/executionAnalytics";
import { getEvent } from "@/lib/vocabulary";
import { useViewpoint } from "@/lib/viewpoint";
import { clearProposed, useProposedIds } from "@/lib/proposals";
import Toggle from "@/components/Toggle";

export interface OpenCreator {
  intent: "edit" | "propose" | "view";
  id?: string;
}

function triggerLabel(wf: WorkflowRecord): string {
  const triggers = wf.ruleJson?.triggers ?? [];
  if (!triggers.length) return "—";
  return triggers.map((t) => getEvent(t.event)?.label ?? t.event).join(" or ");
}

export default function WorkflowDashboard({
  reloadToken = 0,
  onOpenCreator,
}: {
  reloadToken?: number;
  onOpenCreator: (opts: OpenCreator) => void;
}) {
  const { persona, canEdit, canPropose } = useViewpoint();
  const proposedIds = useProposedIds();
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Phase 7.1: Rules List vs Diagnostics & Analytics view.
  const [activeTab, setActiveTab] = useState<"workflows" | "analytics">("workflows");
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<ExecutionAnalytics | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorkflows(await listWorkflows());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load workflows");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadToken]);

  useEffect(() => {
    if (activeTab !== "analytics") return;
    let cancelled = false;
    async function loadAnalytics() {
      setAnalyticsLoading(true);
      setAnalyticsError(null);
      try {
        const body = await fetchExecutionAnalytics();
        if (!cancelled) setAnalytics(body);
      } catch (e) {
        if (!cancelled) setAnalyticsError(e instanceof Error ? e.message : "Couldn't load analytics");
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    }
    void loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [activeTab, reloadToken]);

  async function onToggle(wf: WorkflowRecord, next: boolean) {
    if (!canEdit) return; // read-only viewpoints can't flip enablement
    setWorkflows((list) => list.map((w) => (w.id === wf.id ? { ...w, enabled: next } : w)));
    try {
      await toggleWorkflow(wf.id, next);
    } catch {
      setWorkflows((list) => list.map((w) => (w.id === wf.id ? { ...w, enabled: !next } : w)));
    }
  }

  async function approveProposed(wf: WorkflowRecord) {
    // Admin approval: clear the proposed flag and activate the draft.
    setWorkflows((list) => list.map((w) => (w.id === wf.id ? { ...w, enabled: true } : w)));
    clearProposed(wf.id);
    try {
      await updateWorkflow(wf.id, { enabled: true });
    } catch {
      /* optimistic; the toggle can retry */
    }
  }

  const enabledCount = workflows.filter((w) => w.enabled).length;
  const rowAction: OpenCreator["intent"] = canEdit ? "edit" : "view";

  return (
    <div className="animate-rise">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: "var(--accent-soft)" }}
            aria-hidden
          >
            <GitBranch size={20} strokeWidth={2} style={{ color: "var(--accent)" }} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--fg)" }}>
              Existing Workflows
            </h1>
            <p className="mt-0.5 text-sm" style={{ color: "var(--fg-subtle)" }}>
              {loading
                ? "Loading…"
                : `${workflows.length} ${workflows.length === 1 ? "rule" : "rules"} · ${enabledCount} enabled`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <RoleChip persona={persona.roleLabel} canEdit={canEdit} canPropose={canPropose} />
          {canEdit && (
            <button
              type="button"
              onClick={() => onOpenCreator({ intent: "edit" })}
              className="ring-accent flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110"
              style={{ background: "var(--accent)" }}
            >
              <Plus size={16} strokeWidth={2.5} /> New Workflow
            </button>
          )}
          {canPropose && (
            <button
              type="button"
              onClick={() => onOpenCreator({ intent: "propose" })}
              className="ring-accent flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--accent-soft)]"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
            >
              <Plus size={16} strokeWidth={2.5} /> Propose Workflow
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          className="mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
          style={{ background: "var(--danger-bg)", color: "var(--danger-fg)", border: "1px solid var(--danger-br)" }}
          role="alert"
        >
          <AlertTriangle size={16} strokeWidth={2} /> {error}
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        {(["workflows", "analytics"] as const).map((tab) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="ring-accent rounded-full border px-4 py-2 text-sm font-semibold transition-colors"
              style={
                active
                  ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
                  : { background: "var(--panel)", borderColor: "var(--panel-border)", color: "var(--fg-muted)" }
              }
            >
              {tab === "workflows" ? "Rules List" : "Diagnostics & Analytics"}
            </button>
          );
        })}
      </div>

      {activeTab === "workflows" ? (
        <div className="glass overflow-hidden rounded-2xl">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--panel-border)" }}>
                  <Th>Name</Th>
                  <Th>Event Trigger</Th>
                  <Th>Mode</Th>
                  <Th className="text-center">Status</Th>
                  <Th className="text-right">Edit</Th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm" style={{ color: "var(--fg-subtle)" }}>
                      Loading workflows…
                    </td>
                  </tr>
                )}

                {!loading && workflows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center" style={{ color: "var(--fg-subtle)" }}>
                      <p className="text-sm font-medium" style={{ color: "var(--fg-muted)" }}>
                        No workflows yet.
                      </p>
                      <p className="mt-1 text-xs">
                        {canEdit
                          ? "Click “New Workflow” to build your first rule."
                          : canPropose
                            ? "Click “Propose Workflow” to draft a rule for Admin approval."
                            : "Nothing has been created yet."}
                      </p>
                    </td>
                  </tr>
                )}

                {!loading &&
                  workflows.map((wf) => {
                    const mode = wf.ruleJson?.controls?.mode ?? "shadow";
                    const proposed = proposedIds.has(wf.id);
                    return (
                      <tr
                        key={wf.id}
                        className="transition-colors hover:bg-[var(--accent-soft)]"
                        style={{ borderBottom: "1px solid var(--panel-border)" }}
                      >
                      {/* Name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium" style={{ color: "var(--fg)" }}>
                            {wf.name}
                          </span>
                          {proposed && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}
                              title="Proposed draft — awaiting Admin approval"
                            >
                              <AlertTriangle size={11} strokeWidth={2.5} /> Proposed
                            </span>
                          )}
                        </div>
                        {wf.description && (
                          <div className="mt-0.5 truncate text-xs" style={{ color: "var(--fg-subtle)" }}>
                            {wf.description}
                          </div>
                        )}
                      </td>

                      {/* Trigger */}
                      <td className="px-4 py-3">
                        <span className="text-xs uppercase tracking-wide" style={{ color: "var(--fg-muted)" }}>
                          {triggerLabel(wf)}
                        </span>
                      </td>

                      {/* Mode */}
                      <td className="px-4 py-3">
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                          title={mode === "armed" ? "Armed — dispatches actions" : "Shadow — observes without acting"}
                          style={
                            mode === "armed"
                              ? { background: "var(--tok-then-bg)", color: "var(--tok-then-fg)" }
                              : { background: "var(--tok-op-bg)", color: "var(--fg-subtle)" }
                          }
                        >
                          {mode}
                        </span>
                      </td>

                      {/* Status toggle */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <Toggle
                            size="sm"
                            checked={wf.enabled}
                            disabled={!canEdit}
                            onChange={(v) => onToggle(wf, v)}
                            label={`Enable ${wf.name}`}
                          />
                          <span className="text-[11px] font-medium" style={{ color: "var(--fg-subtle)" }}>
                            {wf.enabled ? "On" : "Off"}
                          </span>
                        </div>
                      </td>

                      {/* Edit / View / Approve */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {canEdit && proposed && (
                            <button
                              type="button"
                              onClick={() => approveProposed(wf)}
                              className="ring-accent inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white transition-all hover:brightness-110"
                              style={{ background: "var(--accent)" }}
                              title="Approve this proposed draft and activate it"
                            >
                              <Check size={13} strokeWidth={2.5} /> Approve
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenCreator({ intent: rowAction, id: wf.id })}
                            className="ring-accent inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--accent-soft)]"
                            style={{ borderColor: "var(--panel-border)", color: "var(--fg-muted)" }}
                          >
                            {rowAction === "edit" ? (
                              <>
                                <Pencil size={13} strokeWidth={2} /> Edit
                              </>
                            ) : (
                              <>
                                <Eye size={13} strokeWidth={2} /> View
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              icon={<Clock size={18} strokeWidth={2} />}
              label="Average queue latency"
              value={analytics ? `${analytics.averageLatencyMinutes} min avg manual wait` : "—"}
              tone="clock"
            />
            <MetricCard
              icon={<TrendingUp size={18} strokeWidth={2} />}
              label="Execution success rate"
              value={analytics ? `${matchRatePct(analytics)}%` : "—"}
              tone="trend"
            />
            <MetricCard
              icon={<Flame size={18} strokeWidth={2} />}
              label="Executed runs"
              value={analytics ? String(analytics.totals.fired) : "—"}
              tone="fire"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="glass rounded-2xl border p-5" style={{ borderColor: "var(--panel-border)" }}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--fg)" }}>
                    <Flame size={14} strokeWidth={2} style={{ color: "var(--warn-fg)" }} /> Hotspot Leaderboard
                  </h2>
                  <p className="text-xs" style={{ color: "var(--fg-subtle)" }}>
                    Most active workflows by execution count.
                  </p>
                </div>
                <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
                  {analytics?.totals.evaluations ?? 0} total runs
                </span>
              </div>
              {analyticsLoading ? (
                <div className="py-10 text-center text-sm" style={{ color: "var(--fg-subtle)" }}>
                  Loading analytics…
                </div>
              ) : analyticsError ? (
                <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "var(--danger-br)", color: "var(--danger-fg)", background: "var(--danger-bg)" }}>
                  {analyticsError}
                </div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(analytics?.hotspots ?? {})
                    .sort((a, b) => b[1] - a[1])
                    .map(([workflowId, executions], index) => (
                    <div
                      key={workflowId}
                      className="flex items-center justify-between rounded-xl border px-4 py-3"
                      style={{ borderColor: "var(--panel-border)", background: "var(--panel)" }}
                    >
                      <div>
                        <div className="text-sm font-medium" style={{ color: "var(--fg)" }}>
                          {index + 1}. {workflows.find((wf) => wf.id === workflowId)?.name ?? workflowId}
                        </div>
                        <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>
                          {workflowId}
                        </div>
                      </div>
                      <div className="text-right text-sm font-semibold" style={{ color: "var(--fg)" }}>
                        {executions}
                      </div>
                    </div>
                  ))}
                  {Object.keys(analytics?.hotspots ?? {}).length === 0 && (
                    <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm" style={{ borderColor: "var(--panel-border)", color: "var(--fg-subtle)" }}>
                      No execution history yet.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="glass rounded-2xl border p-5" style={{ borderColor: "var(--panel-border)" }}>
              <h2 className="mb-4 text-sm font-semibold" style={{ color: "var(--fg)" }}>
                Status mix
              </h2>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-xl bg-[var(--panel)] px-4 py-3">
                  <span style={{ color: "var(--fg-muted)" }}>Shadow</span>
                  <span className="font-semibold" style={{ color: "var(--fg)" }}>
                    {analytics?.totals.shadow ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-[var(--panel)] px-4 py-3">
                  <span style={{ color: "var(--fg-muted)" }}>Errors</span>
                  <span className="font-semibold" style={{ color: "var(--fg)" }}>
                    {analytics?.totals.errors ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-[var(--panel)] px-4 py-3">
                  <span style={{ color: "var(--fg-muted)" }}>Match rate</span>
                  <span className="font-semibold" style={{ color: "var(--fg)" }}>
                    {analytics ? `${matchRatePct(analytics)}%` : "—"}
                  </span>
                </div>
              </div>
              {!analyticsLoading && !analyticsError && (
                <p className="mt-4 text-xs" style={{ color: "var(--fg-subtle)" }}>
                  Turnaround is simulated (deterministic 15–90 min per request) — the platform
                  exposes no real decision timestamps yet.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {!canEdit && !canPropose && !loading && (
        <p className="mt-3 flex items-center gap-1.5 text-xs" style={{ color: "var(--fg-subtle)" }}>
          <Lock size={12} strokeWidth={2} /> {persona.roleLabel} view is read-only.
        </p>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "clock" | "trend" | "fire";
}) {
  const tones: Record<typeof tone, { background: string; color: string }> = {
    clock: { background: "var(--tok-when-bg)", color: "var(--tok-when-fg)" },
    trend: { background: "var(--tok-if-bg)", color: "var(--tok-if-fg)" },
    fire: { background: "var(--danger-bg)", color: "var(--danger-fg)" },
  };
  const style = tones[tone];
  return (
    <div className="glass rounded-2xl border p-4" style={{ borderColor: "var(--panel-border)" }}>
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: style.background, color: style.color }}>
          {icon}
        </span>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--fg-subtle)" }}>
            {label}
          </div>
          <div className="text-xl font-semibold" style={{ color: "var(--fg)" }}>
            {value}
          </div>
        </div>
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider ${className}`}
      style={{ color: "var(--fg-subtle)" }}
    >
      {children}
    </th>
  );
}

function RoleChip({
  persona,
  canEdit,
  canPropose,
}: {
  persona: string;
  canEdit: boolean;
  canPropose: boolean;
}) {
  const label = canEdit ? "Full access" : canPropose ? "Can propose" : "Read-only";
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium sm:inline-flex"
      style={{ background: "var(--panel)", border: "1px solid var(--panel-border)", color: "var(--fg-muted)" }}
      title={`${persona} viewpoint`}
    >
      {!canEdit && !canPropose && <Lock size={12} strokeWidth={2} />}
      {persona} · {label}
    </span>
  );
}
