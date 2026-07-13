"use client";

import { WorkflowRecord } from "@/lib/api";
import { getEvent } from "@/lib/vocabulary";
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
          const ev = getEvent(wf.ruleJson?.event);
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
                    {ev?.label ?? wf.ruleJson?.event ?? "—"}
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
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                  style={{
                    background: wf.enabled ? "var(--tok-if-bg)" : "var(--tok-op-bg)",
                    color: wf.enabled ? "var(--tok-if-fg)" : "var(--fg-subtle)",
                  }}
                >
                  {wf.enabled ? "Enabled" : "Off"}
                </span>
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
    </aside>
  );
}
