"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SYSTEM_EVENTS } from "@/lib/platformData";
import { listWorkflows, WorkflowRecord } from "@/lib/api";
import { workflowsForEvent, describeActions } from "@/lib/ruleEngine";
import StatusBadge from "@/components/ui/StatusBadge";

interface Run {
  key: string;
  workflow: WorkflowRecord;
  eventType: string;
  requestName: string;
  requestId: string;
  timestamp: string;
  actions: string[];
}

/**
 * Simulated automation run-history: for each logged system event, the enabled
 * workflows that would have fired become "runs". Deterministic from the event
 * log + saved rules — a preview of the audit trail the real engine would write.
 */
export default function WorkflowActivity() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[] | null>(null);

  useEffect(() => {
    listWorkflows().then(setWorkflows).catch(() => setWorkflows([]));
  }, []);

  const runs: Run[] = useMemo(() => {
    if (!workflows) return [];
    const out: Run[] = [];
    for (const evt of SYSTEM_EVENTS) {
      for (const w of workflowsForEvent(evt, workflows)) {
        out.push({
          key: `${evt.id}-${w.id}`,
          workflow: w,
          eventType: evt.type,
          requestName: evt.requestName,
          requestId: evt.requestId,
          timestamp: evt.timestamp,
          actions: describeActions(w.ruleJson),
        });
      }
    }
    return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [workflows]);

  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg text-sm" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>⚡</span>
          <h3 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>Automation activity</h3>
        </div>
        <Link href="/workflows" className="text-xs font-medium" style={{ color: "var(--accent)" }}>Manage →</Link>
      </div>

      {workflows === null && <p className="text-sm" style={{ color: "var(--fg-subtle)" }}>Loading…</p>}

      {workflows !== null && runs.length === 0 && (
        <div className="rounded-xl border border-dashed p-5 text-center" style={{ borderColor: "var(--panel-border)" }}>
          <p className="text-sm" style={{ color: "var(--fg-muted)" }}>No automations have fired on the logged events yet.</p>
          <Link href="/workflows" className="mt-1 inline-block text-sm font-medium" style={{ color: "var(--accent)" }}>Build a workflow →</Link>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {runs.map((r) => (
          <div key={r.key} className="rounded-xl border px-3 py-2.5" style={{ borderColor: "var(--panel-border)" }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <StatusBadge tone="green">ran</StatusBadge>
                <span className="truncate text-sm font-medium" style={{ color: "var(--fg)" }}>{r.workflow.name}</span>
              </div>
              <span className="shrink-0 text-xs" style={{ color: "var(--fg-subtle)" }}>{r.timestamp}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs" style={{ color: "var(--fg-subtle)" }}>
              <span>on</span>
              <span className="font-medium" style={{ color: "var(--fg-muted)" }}>{r.eventType}</span>
              <span>·</span>
              <Link href={`/requests/${r.requestId}`} className="hover:underline">{r.requestName}</Link>
              {r.actions.map((a, i) => (
                <span key={i} className="rounded-full px-1.5 py-0.5" style={{ background: "var(--tok-then-bg)", color: "var(--tok-then-fg)" }}>→ {a}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
