"use client";

import { useState } from "react";
import { bookedLoans, formatCurrency, PlatformRequest } from "@/lib/platformData";
import PageHeader from "@/components/ui/PageHeader";
import QueueTabs from "@/components/ui/QueueTabs";
import DataTable, { Column } from "@/components/ui/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";

const TABS = ["All", "Term Loan", "Line of Credit"];

export default function LoansPage() {
  const [tab, setTab] = useState("All");
  const all = bookedLoans();
  const rows = all.filter((r) => tab === "All" || r.loanProduct === tab);

  const columns: Column<PlatformRequest>[] = [
    {
      key: "name",
      header: "Loan",
      render: (r) => (
        <div>
          <div className="font-medium" style={{ color: "var(--fg)" }}>{r.name}</div>
          <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>{r.id} · {r.mainBorrower}</div>
        </div>
      ),
    },
    { key: "product", header: "Product", render: (r) => <StatusBadge tone="blue">{r.loanProduct}</StatusBadge> },
    { key: "amount", header: "Amount", align: "right", render: (r) => <span className="font-semibold">{formatCurrency(r.loanAmount)}</span> },
    { key: "core", header: "Core", hideOnMobile: true, render: (r) => <span style={{ color: "var(--fg-muted)" }}>{r.core}</span> },
    { key: "retailer", header: "Retailer", hideOnMobile: true, render: (r) => <span style={{ color: "var(--fg-muted)" }}>{r.retailer}</span> },
    { key: "status", header: "Booking", render: (r) => <StatusBadge status={r.bookStatus} /> },
  ];

  return (
    <div>
      <PageHeader title="Loans" icon="💳" subtitle="Booked loans now being serviced, by product type." />
      <div className="mb-4">
        <QueueTabs
          tabs={TABS.map((t) => ({ key: t, label: t === "All" ? "All loans" : t + "s", count: all.filter((r) => t === "All" || r.loanProduct === t).length }))}
          active={tab}
          onChange={setTab}
        />
      </div>
      <DataTable columns={columns} rows={rows} empty="No booked loans of this type." />
    </div>
  );
}
