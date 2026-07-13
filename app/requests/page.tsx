"use client";

import { useState } from "react";
import { REQUESTS, formatCurrency, PlatformRequest } from "@/lib/platformData";
import PageHeader from "@/components/ui/PageHeader";
import QueueTabs from "@/components/ui/QueueTabs";
import DataTable, { Column } from "@/components/ui/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";

const STAGES = ["All", "Initiated", "Processing", "Approved", "Closed"];

export default function RequestsPage() {
  const [stage, setStage] = useState("All");
  const rows = REQUESTS.filter((r) => stage === "All" || r.stage === stage);

  const columns: Column<PlatformRequest>[] = [
    {
      key: "name",
      header: "Request",
      render: (r) => (
        <div>
          <div className="font-medium" style={{ color: "var(--fg)" }}>{r.name}</div>
          <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>{r.id} · {r.customerType}</div>
        </div>
      ),
    },
    { key: "stage", header: "Stage", render: (r) => <StatusBadge status={r.stage} /> },
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
    { key: "amount", header: "Amount", align: "right", render: (r) => <span className="font-semibold">{formatCurrency(r.loanAmount)}</span> },
    { key: "team", header: "Owner", hideOnMobile: true, render: (r) => <span style={{ color: r.teamMember ? "var(--fg)" : "var(--fg-subtle)" }}>{r.teamMember ?? "Unassigned"}</span> },
    { key: "date", header: "Submitted", align: "right", hideOnMobile: true, render: (r) => <span style={{ color: "var(--fg-muted)" }}>{r.dateSubmitted}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Requests"
        icon="📥"
        subtitle="Every loan request moving through the pipeline."
        actions={
          <button
            type="button"
            className="ring-accent rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:brightness-110"
            style={{ background: "var(--accent)" }}
          >
            + Create New
          </button>
        }
      />
      <div className="mb-4">
        <QueueTabs
          tabs={STAGES.map((s) => ({ key: s, label: s === "All" ? "All requests" : s, count: REQUESTS.filter((r) => s === "All" || r.stage === s).length }))}
          active={stage}
          onChange={setStage}
        />
      </div>
      <DataTable columns={columns} rows={rows} empty="No requests at this stage." />
    </div>
  );
}
