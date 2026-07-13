"use client";

import { useState } from "react";
import Link from "next/link";
import { REQUESTS, formatCurrency, PlatformRequest } from "@/lib/platformData";
import PageHeader from "@/components/ui/PageHeader";
import QueueTabs from "@/components/ui/QueueTabs";
import DataTable, { Column } from "@/components/ui/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";
import CreateRequestWizard from "@/components/CreateRequestWizard";

const STAGES = ["All", "Initiated", "Processing", "Approved", "Closed"];

export default function RequestsPage() {
  const [stage, setStage] = useState("All");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const rows = REQUESTS.filter((r) => stage === "All" || r.stage === stage);

  function onComplete(summary: string) {
    setToast(summary);
    setTimeout(() => setToast(null), 3600);
  }

  const columns: Column<PlatformRequest>[] = [
    {
      key: "name",
      header: "Request",
      render: (r) => (
        <Link href={`/requests/${r.id}`} className="block">
          <div className="font-medium hover:underline" style={{ color: "var(--fg)" }}>{r.name}</div>
          <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>{r.id} · {r.customerType}</div>
        </Link>
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
            onClick={() => setWizardOpen(true)}
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

      <CreateRequestWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onComplete={onComplete} />

      {toast && (
        <div className="animate-popin glass fixed bottom-5 right-5 z-[80] rounded-xl px-4 py-2.5 text-sm shadow-lg" style={{ color: "var(--fg)", borderLeft: "3px solid var(--accent)" }}>
          {toast} <span style={{ color: "var(--fg-subtle)" }}>(demo — not persisted)</span>
        </div>
      )}
    </div>
  );
}
