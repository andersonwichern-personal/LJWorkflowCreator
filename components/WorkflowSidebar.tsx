"use client";

import { useEffect, useState } from "react";
import { WorkflowRecord } from "@/lib/api";
import { getEvent } from "@/lib/vocabulary";
import type { RefAuditResult } from "@/lib/refAudit";
import Toggle from "./Toggle";

interface WorkflowSidebarProps {
  workflows: WorkflowRecord[];
  activeId: string | null;
  loading: boolean;
  onSelect: (wf: WorkflowRecord) => void;
  onNew: () => void;
  onToggle: (wf: WorkflowRecord, enabled: boolean) => void;
  onDelete: (wf: WorkflowRecord) => void;
}

export default function WorkflowSidebar({
  workflows,
  activeId,
  loading,
  onSelect,
  onNew,
  onToggle,
  onDelete,
}: WorkflowSidebarProps) {
  return (
    <aside className="glass flex h-full w-full flex-col rounded-2xl p-3">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
          Workflows
        </h2>
        <button
          type="button"
          onClick={onNew}
          className="ring-accent rounded-lg px-2.5 py-1 text-xs font-semibold text-white transition-all hover:brightness-110"
          style={{ background: "var(--accent)" }}
        >
          + New
        </button>
      </div>

      <div className="scroll-thin flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {loading && (
          <div className="px-2 py-6 text-center text-xs" style={{ color: "var(--fg-subtle)" }}>
            Loading…
          </div>
        )}

        {!loading && workflows.length === 0 && (
          <div
            className="mx-1 rounded-xl border border-dashed px-3 py-6 text-center text-xs"
            style={{ borderColor: "var(--panel-border)", color: "var(--fg-subtle)" }}
          >
            No saved workflows yet. Build one and hit Save.
          </div>
        )}

        {workflows.map((wf) => {
          const active = wf.id === activeId;
          const triggers = wf.ruleJson?.triggers ?? [];
          const triggerLabel = triggers.length
            ? triggers.map((t) => getEvent(t.event)?.label ?? t.event).join(" or ")
            : "—";
          const mode = wf.ruleJson?.controls?.mode ?? "shadow";
          return (
            <div
              key={wf.id}
              onClick={() => onSelect(wf)}
              className="group cursor-pointer rounded-xl border px-3 py-2.5 transition-all duration-150"
              style={{
                borderColor: active ? "var(--ring)" : "var(--panel-border)",
                background: active ? "var(--accent-soft)" : "transparent",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div
                    className="truncate text-sm font-medium"
                    style={{ color: "var(--fg)" }}
                  >
                    {wf.name}
                  </div>
                  <div
                    className="mt-0.5 truncate text-[11px] uppercase tracking-wide"
                    style={{ color: "var(--fg-subtle)" }}
                  >
                    {triggerLabel}
                  </div>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <Toggle
                    size="sm"
                    checked={wf.enabled}
                    onChange={(v) => onToggle(wf, v)}
                    label={`Enable ${wf.name}`}
                  />
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                    style={{
                      background: wf.enabled ? "var(--tok-if-bg)" : "var(--tok-op-bg)",
                      color: wf.enabled ? "var(--tok-if-fg)" : "var(--fg-subtle)",
                    }}
                  >
                    {wf.enabled ? "Enabled" : "Off"}
                  </span>
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                    title={mode === "armed" ? "Armed — dispatches actions" : "Shadow — observes without acting"}
                    style={
                      mode === "armed"
                        ? { background: "var(--tok-then-bg)", color: "var(--tok-then-fg)" }
                        : { background: "var(--tok-op-bg)", color: "var(--fg-subtle)" }
                    }
                  >
                    {mode}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(wf);
                  }}
                  className="ring-accent rounded-md px-1.5 py-0.5 text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: "var(--warn-fg)" }}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <ReferencesPanel refreshKey={workflows.length} />
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* References panel — broken-reference audit (Phase 2 §4.5)                   */
/* -------------------------------------------------------------------------- */

function ReferencesPanel({ refreshKey }: { refreshKey: number }) {
  const [audit, setAudit] = useState<RefAuditResult | null>(null);
  const [openPanel, setOpenPanel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workflows/audit-refs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && Array.isArray(d.entries)) setAudit(d as RefAuditResult);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!audit) return null;
  const problems = audit.counts.missing + audit.counts.legacyUnresolved;

  return (
    <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--panel-border)" }}>
      <button
        type="button"
        onClick={() => setOpenPanel((o) => !o)}
        className="ring-accent flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--accent-soft)]"
        style={{ color: "var(--fg-muted)" }}
      >
        <span>🔗 References</span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
          title={
            audit.verified
              ? `${audit.counts.ok} ok · ${audit.counts.missing} missing · ${audit.counts.legacyUnresolved} legacy`
              : "Instance ids not verified — live platform bridge unavailable"
          }
          style={
            problems > 0
              ? { background: "var(--warn-bg)", color: "var(--warn-fg)" }
              : { background: "var(--tok-if-bg)", color: "var(--tok-if-fg)" }
          }
        >
          {problems > 0 ? problems : "✓"}
        </span>
      </button>

      {openPanel && (
        <div className="scroll-thin mt-1 max-h-40 overflow-y-auto px-1">
          {!audit.verified && (
            <p className="px-1 pb-1 text-[10px]" style={{ color: "var(--fg-subtle)" }}>
              Instance ids unverified (no live registries) — shape checks only.
            </p>
          )}
          {audit.entries.filter((e) => e.status !== "ok").length === 0 ? (
            <p className="px-1 py-1 text-[11px]" style={{ color: "var(--fg-subtle)" }}>
              No broken or legacy references.
            </p>
          ) : (
            audit.entries
              .filter((e) => e.status !== "ok")
              .slice(0, 20)
              .map((e, i) => (
                <div key={i} className="flex items-center justify-between gap-2 px-1 py-1 text-[11px]">
                  <span className="min-w-0 truncate" style={{ color: "var(--fg-muted)" }} title={`${e.workflowName} · ${e.path}`}>
                    {e.workflowName}: {e.label || "(empty)"}
                  </span>
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase"
                    style={
                      e.status === "missing"
                        ? { background: "var(--danger-bg)", color: "var(--danger-fg)" }
                        : { background: "var(--warn-bg)", color: "var(--warn-fg)" }
                    }
                  >
                    {e.status === "legacy-unresolved" ? "legacy" : e.status}
                  </span>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}
