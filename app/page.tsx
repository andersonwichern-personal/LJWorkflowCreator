"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  REQUESTS,
  SYSTEM_EVENTS,
  stageCounts,
  formatCurrency,
  bookedLoans,
} from "@/lib/platformData";
import { listWorkflows, WorkflowRecord } from "@/lib/api";
import StatCard from "@/components/ui/StatCard";
import StatusBadge from "@/components/ui/StatusBadge";
import PageHeader from "@/components/ui/PageHeader";
import { AreaTrend } from "@/components/ui/charts";
import { monthlyVolume } from "@/lib/analytics";

export default function HomePage() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[] | null>(null);

  useEffect(() => {
    listWorkflows().then(setWorkflows).catch(() => setWorkflows([]));
  }, []);

  const stages = stageCounts();
  const openRequests = REQUESTS.filter((r) => r.stage !== "Closed").length;
  const reviewNeeded = REQUESTS.filter((r) => r.uwStatus === "Pending" && r.uwQueue !== "Unassigned").length;
  const unassigned = REQUESTS.filter((r) => r.uwQueue === "Unassigned").length;
  const bookingErrors = REQUESTS.filter((r) => r.bookStatus === "Error").length;
  const enabledWf = workflows?.filter((w) => w.enabled).length ?? 0;

  const myTasks = REQUESTS.filter((r) => r.teamMember === "Wael");
  const recentEvents = SYSTEM_EVENTS.slice(0, 5);

  return (
    <div>
      <PageHeader
        title="Home"
        icon="🏠"
        subtitle="Organic Bank of America — everything needing your attention today."
        actions={
          <Link
            href="/requests"
            className="ring-accent rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:brightness-110"
            style={{ background: "var(--accent)" }}
          >
            + Create request
          </Link>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open requests" value={openRequests} hint={`${stages.Processing} processing · ${stages.Initiated} initiated`} icon="📥" />
        <StatCard label="Review needed" value={reviewNeeded} hint="pending underwriting" icon="🔎" />
        <StatCard label="Unassigned" value={unassigned} hint="awaiting a team member" icon="🕒" />
        <StatCard label="Booking errors" value={bookingErrors} hint="need escalation" icon="🚨" accent={bookingErrors > 0} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* My tasks */}
        <div className="glass rounded-2xl p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>My open requests</h3>
            <Link href="/underwriting" className="text-xs font-medium" style={{ color: "var(--accent)" }}>
              View underwriting →
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {myTasks.map((r) => (
              <Link
                key={r.id}
                href={`/requests/${r.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:bg-[var(--accent-soft)]"
                style={{ borderColor: "var(--panel-border)" }}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" style={{ color: "var(--fg)" }}>{r.name}</div>
                  <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>
                    {r.id} · {r.retailer} · {r.program}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden text-sm font-semibold sm:block" style={{ color: "var(--fg-muted)" }}>
                    {formatCurrency(r.loanAmount)}
                  </span>
                  <StatusBadge status={r.bookStatus === "Error" ? "Error" : r.uwStatus} />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Pipeline + automation */}
        <div className="flex flex-col gap-5">
          <div className="glass rounded-2xl p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>Booked volume</h3>
              <Link href="/insights" className="text-xs font-medium" style={{ color: "var(--accent)" }}>Insights →</Link>
            </div>
            <AreaTrend data={monthlyVolume()} money />
          </div>

          <div className="glass rounded-2xl p-5">
            <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--fg)" }}>Pipeline</h3>
            <div className="flex flex-col gap-2.5">
              {(["Initiated", "Processing", "Approved", "Closed"] as const).map((s) => {
                const max = Math.max(...Object.values(stages), 1);
                const pct = Math.round((stages[s] / max) * 100);
                return (
                  <div key={s}>
                    <div className="mb-1 flex justify-between text-xs" style={{ color: "var(--fg-muted)" }}>
                      <span>{s}</span>
                      <span className="font-semibold">{stages[s]}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--tok-op-bg)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--accent)" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Link href="/workflows" className="glass rounded-2xl p-5 transition-all hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>⚡ Workflows</h3>
              <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase text-white" style={{ background: "var(--accent)" }}>
                New
              </span>
            </div>
            <p className="mt-2 text-2xl font-semibold" style={{ color: "var(--fg)" }}>
              {workflows === null ? "…" : enabledWf} <span className="text-sm font-normal" style={{ color: "var(--fg-subtle)" }}>active automations</span>
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--fg-subtle)" }}>
              Automate assignments, escalations and tagging. Open the builder →
            </p>
          </Link>
        </div>
      </div>

      {/* Recent system events */}
      <div className="glass mt-5 rounded-2xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>Recent system events</h3>
          <Link href="/system-events" className="text-xs font-medium" style={{ color: "var(--accent)" }}>
            View all →
          </Link>
        </div>
        <div className="flex flex-col gap-1.5">
          {recentEvents.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2" style={{ borderBottom: "1px solid var(--panel-border)" }}>
              <div className="flex min-w-0 items-center gap-3">
                <StatusBadge status={e.type === "SYSTEM ERROR" ? "Error" : e.type === "LOAN REJECTED" ? "Rejected" : "Approved"}>
                  {e.type}
                </StatusBadge>
                <span className="truncate text-sm" style={{ color: "var(--fg-muted)" }}>{e.detail}</span>
              </div>
              <span className="hidden shrink-0 text-xs sm:block" style={{ color: "var(--fg-subtle)" }}>{e.timestamp}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 text-center text-xs" style={{ color: "var(--fg-subtle)" }}>
        {REQUESTS.length} requests · {bookedLoans().length} booked loans · demo data grounded in verified platform vocabulary
      </div>
    </div>
  );
}
