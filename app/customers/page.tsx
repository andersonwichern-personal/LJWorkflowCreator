"use client";

import { useState } from "react";
import { CUSTOMERS, Customer } from "@/lib/platformData";
import PageHeader from "@/components/ui/PageHeader";
import QueueTabs from "@/components/ui/QueueTabs";
import DataTable, { Column } from "@/components/ui/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";

const TABS: { key: string; label: string }[] = [
  { key: "All", label: "All customers" },
  { key: "Business", label: "Businesses" },
  { key: "Individual", label: "Individuals" },
];

export default function CustomersPage() {
  const [tab, setTab] = useState("All");
  const rows = CUSTOMERS.filter((c) => tab === "All" || c.type === tab);

  const columns: Column<Customer>[] = [
    { key: "name", header: "Customer", render: (c) => <span className="font-medium" style={{ color: "var(--fg)" }}>{c.name}</span> },
    { key: "type", header: "Type", render: (c) => <StatusBadge tone={c.type === "Business" ? "blue" : "gray"}>{c.type}</StatusBadge> },
    { key: "contact", header: "Contact", hideOnMobile: true, render: (c) => <span style={{ color: "var(--fg-muted)" }}>{c.contact}</span> },
    { key: "email", header: "Email", hideOnMobile: true, render: (c) => <span style={{ color: "var(--fg-subtle)" }}>{c.email}</span> },
    { key: "retailer", header: "Retailer", hideOnMobile: true, render: (c) => <span style={{ color: "var(--fg-muted)" }}>{c.retailer}</span> },
    { key: "open", header: "Open requests", align: "right", render: (c) => <span className="font-semibold">{c.openRequests}</span> },
  ];

  return (
    <div>
      <PageHeader title="Customers" icon="👥" subtitle="Businesses and individuals across your book." />
      <div className="mb-4">
        <QueueTabs
          tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: CUSTOMERS.filter((c) => t.key === "All" || c.type === t.key).length }))}
          active={tab}
          onChange={setTab}
        />
      </div>
      <DataTable columns={columns} rows={rows} empty="No customers of this type." />
    </div>
  );
}
