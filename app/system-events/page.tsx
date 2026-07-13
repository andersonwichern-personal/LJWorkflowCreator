"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SYSTEM_EVENTS, SystemEvent } from "@/lib/platformData";
import { listWorkflows, WorkflowRecord } from "@/lib/api";
import { workflowsForEvent } from "@/lib/ruleEngine";
import PageHeader from "@/components/ui/PageHeader";
import QueueTabs from "@/components/ui/QueueTabs";
import StatusBadge from "@/components/ui/StatusBadge";

const TYPES = ["ALL", "SYSTEM ERROR", "LOAN APPROVED", "LOAN REJECTED", "OFFER ACCEPTED", "FISERV LOAN", "FMAC LOAN"];

function badgeStatus(t: SystemEvent["type"]): string {
  if (t === "SYSTEM ERROR") return "Error";
  if (t === "LOAN REJECTED") return "Rejected";
  return "Approved";
}

export default function SystemEventsPage() {
  const [type, setType] = useState("ALL");
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);

  useEffect(() => {
    listWorkflows().then(setWorkflows).catch(() => setWorkflows([]));
  }, []);

  const rows = SYSTEM_EVENTS.filter((e) => type === "ALL" || e.type === type);

  return (
    <div>
      <PageHeader title="System Events" icon="📡" subtitle="The platform's lifecycle event log — the same events that trigger workflows." />

      <Link
        href="/workflows"
        className="glass mb-4 flex items-center justify-between gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg text-lg" style={{ background: "var(--accent-soft)" }}>⚡</span>
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--fg)" }}>Turn these events into automations</div>
            <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>
              Each event type is the <strong>WHEN</strong> trigger of a workflow. Matches are shown live below.
            </div>
          </div>
        </div>
        <span className="text-sm font-medium" style={{ color: "var(--accent)" }}>Open Workflows →</span>
      </Link>

      <div className="mb-4">
        <QueueTabs
          tabs={TYPES.map((t) => ({ key: t, label: t === "ALL" ? "All events" : t, count: SYSTEM_EVENTS.filter((e) => t === "ALL" || e.type === t).length }))}
          active={type}
          onChange={setType}
        />
      </div>

      <div className="glass rounded-2xl p-2">
        {rows.map((e) => {
          const fired = workflowsForEvent(e, workflows);
          return (
            <div key={e.id} className="rounded-xl px-3 py-3 transition-colors hover:bg-[var(--accent-soft)]" style={{ borderBottom: "1px solid var(--panel-border)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <StatusBadge status={badgeStatus(e.type)}>{e.type}</StatusBadge>
                  <div className="min-w-0">
                    <div className="text-sm" style={{ color: "var(--fg)" }}>{e.detail}</div>
                    <div className="mt-0.5 text-xs" style={{ color: "var(--fg-subtle)" }}>
                      <Link href={`/requests/${e.requestId}`} className="hover:underline">{e.requestName} · {e.requestId}</Link>
                    </div>
                  </div>
                </div>
                <span className="shrink-0 whitespace-nowrap text-xs" style={{ color: "var(--fg-subtle)" }}>{e.timestamp}</span>
              </div>
              {fired.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-1">
                  <span className="text-[11px] font-semibold" style={{ color: "var(--accent)" }}>⚡ triggered:</span>
                  {fired.map((w) => (
                    <Link key={w.id} href="/workflows" className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                      {w.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <div className="px-3 py-10 text-center text-sm" style={{ color: "var(--fg-subtle)" }}>No events of this type.</div>}
      </div>
    </div>
  );
}
