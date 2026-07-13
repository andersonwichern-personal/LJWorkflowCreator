"use client";

import { useState } from "react";
import Link from "next/link";
import { REQUESTS, formatCurrency, PlatformRequest } from "@/lib/platformData";
import { ASSIGNEES } from "@/lib/vocabulary";
import PageHeader from "@/components/ui/PageHeader";
import QueueTabs from "@/components/ui/QueueTabs";
import DataTable, { Column } from "@/components/ui/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";

const QUEUES = ["My Requests", "Unassigned", "Assigned", "Auto Approved", "Approved", "Rejected", "All Requests"] as const;
const ME = "Wael";

function inQueue(r: PlatformRequest, q: string): boolean {
  if (q === "All Requests") return true;
  if (q === "My Requests") return r.teamMember === ME;
  return r.uwQueue === q;
}

export default function UnderwritingPage() {
  const [queue, setQueue] = useState<string>("All Requests");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const rows = REQUESTS.filter((r) => inQueue(r, queue));

  function toggleRow(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  }
  function bulk(msg: string) {
    setToast(`${msg} for ${selected.size} request${selected.size === 1 ? "" : "s"} (demo — not persisted).`);
    setSelected(new Set());
    setTimeout(() => setToast(null), 3600);
  }

  const columns: Column<PlatformRequest>[] = [
    {
      key: "name",
      header: "Request",
      render: (r) => (
        <Link href={`/requests/${r.id}`} className="block">
          <div className="font-medium hover:underline" style={{ color: "var(--fg)" }}>{r.name}</div>
          <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>{r.id}</div>
        </Link>
      ),
    },
    { key: "date", header: "Submitted", hideOnMobile: true, render: (r) => <span style={{ color: "var(--fg-muted)" }}>{r.dateSubmitted}</span> },
    { key: "amount", header: "Loan amount", align: "right", render: (r) => <span className="font-semibold">{formatCurrency(r.loanAmount)}</span> },
    {
      key: "retailer",
      header: "Retailer & Program",
      hideOnMobile: true,
      render: (r) => (
        <div>
          <div style={{ color: "var(--fg)" }}>{r.retailer}</div>
          <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>{r.program}</div>
        </div>
      ),
    },
    {
      key: "tags",
      header: "Tags",
      hideOnMobile: true,
      render: (r) =>
        r.tags.length ? (
          <div className="flex flex-wrap gap-1">
            {r.tags.map((t) => (
              <span key={t} className="rounded-md px-1.5 py-0.5 text-[11px]" style={{ background: "var(--tok-op-bg)", color: "var(--fg-muted)" }}>{t}</span>
            ))}
          </div>
        ) : (
          <span style={{ color: "var(--fg-subtle)" }}>—</span>
        ),
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.uwStatus} /> },
    { key: "team", header: "Team member", hideOnMobile: true, render: (r) => <span style={{ color: r.teamMember ? "var(--fg)" : "var(--fg-subtle)" }}>{r.teamMember ?? "Unassigned"}</span> },
    { key: "borrower", header: "Main borrower", hideOnMobile: true, render: (r) => <span style={{ color: "var(--fg-muted)" }}>{r.mainBorrower}</span> },
  ];

  return (
    <div>
      <PageHeader title="Underwriting" icon="⚖️" subtitle="Review, assign and decision loan requests across queues." />
      <div className="mb-4">
        <QueueTabs
          tabs={QUEUES.map((q) => ({ key: q, label: q, count: REQUESTS.filter((r) => inQueue(r, q)).length }))}
          active={queue}
          onChange={(k) => { setQueue(k); setSelected(new Set()); }}
        />
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="glass animate-popin mb-3 flex flex-wrap items-center gap-2 rounded-xl p-2.5">
          <span className="px-2 text-sm font-medium" style={{ color: "var(--fg)" }}>{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              onChange={(e) => { if (e.target.value) bulk(`Assigned to ${e.target.value}`); e.currentTarget.selectedIndex = 0; }}
              className="ring-accent rounded-lg px-2.5 py-1.5 text-sm"
              style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)", color: "var(--fg)" }}
              defaultValue=""
            >
              <option value="" disabled>Assign to…</option>
              {ASSIGNEES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button type="button" onClick={() => bulk("Tagged 'priority'")} className="ring-accent rounded-lg px-3 py-1.5 text-sm font-medium" style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)", color: "var(--fg)" }}>
              + Tag priority
            </button>
            <button type="button" onClick={() => bulk("Marked approved")} className="ring-accent rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ background: "var(--accent)" }}>
              Approve
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="ring-accent rounded-lg px-2 py-1.5 text-sm" style={{ color: "var(--fg-subtle)" }}>Clear</button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        empty="No requests in this queue."
        selectable
        selected={selected}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
      />

      {toast && (
        <div className="animate-popin glass fixed bottom-5 right-5 z-[80] rounded-xl px-4 py-2.5 text-sm shadow-lg" style={{ color: "var(--fg)", borderLeft: "3px solid var(--accent)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
