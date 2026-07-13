"use client";

import { useState } from "react";
import { offers, formatCurrency, PlatformRequest } from "@/lib/platformData";
import PageHeader from "@/components/ui/PageHeader";
import QueueTabs from "@/components/ui/QueueTabs";
import DataTable, { Column } from "@/components/ui/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";

const QUEUES = ["All", "Unassigned", "Assigned", "Rejected"];

export default function OffersPage() {
  const [queue, setQueue] = useState("All");
  const all = offers();
  const rows = all.filter((r) => queue === "All" || r.offerQueue === queue);

  const columns: Column<PlatformRequest>[] = [
    {
      key: "name",
      header: "Request",
      render: (r) => (
        <div>
          <div className="font-medium" style={{ color: "var(--fg)" }}>{r.name}</div>
          <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>{r.mainBorrower}</div>
        </div>
      ),
    },
    { key: "amount", header: "Offer amount", align: "right", render: (r) => <span className="font-semibold">{formatCurrency(r.loanAmount)}</span> },
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
    { key: "product", header: "Product", hideOnMobile: true, render: (r) => <span style={{ color: "var(--fg-muted)" }}>{r.loanProduct}</span> },
    { key: "queue", header: "Queue", render: (r) => <StatusBadge status={r.offerQueue ?? "Unassigned"} /> },
  ];

  return (
    <div>
      <PageHeader title="Offers" icon="✉️" subtitle="Product offers sent to borrowers, grouped by review queue." />
      <div className="mb-4">
        <QueueTabs
          tabs={QUEUES.map((q) => ({ key: q, label: q, count: all.filter((r) => q === "All" || r.offerQueue === q).length }))}
          active={queue}
          onChange={setQueue}
        />
      </div>
      <DataTable columns={columns} rows={rows} empty="No offers in this queue." />
    </div>
  );
}
