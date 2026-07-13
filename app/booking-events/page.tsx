"use client";

import { useState } from "react";
import { bookingEvents, formatCurrency, PlatformRequest } from "@/lib/platformData";
import PageHeader from "@/components/ui/PageHeader";
import QueueTabs from "@/components/ui/QueueTabs";
import DataTable, { Column } from "@/components/ui/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";

const STATUSES = ["All", "In Flight", "Sent", "Confirmed", "Partially Confirmed", "Unconfirmed", "Error"];

/** Derive the two Booking Events dimensions from the overall status. */
function dataStatus(r: PlatformRequest): string {
  if (r.bookStatus === "Error") return "Error";
  if (r.bookStatus === "Not Sent" || r.bookStatus === "In Flight") return "Incomplete";
  return "Complete";
}
function processingStatus(r: PlatformRequest): string {
  if (r.bookStatus === "Error") return "Error";
  if (r.bookStatus === "In Flight") return "Processing";
  if (r.bookStatus === "Sent") return "Queued";
  return "Done";
}

export default function BookingEventsPage() {
  const [status, setStatus] = useState("All");
  const all = bookingEvents();
  const rows = all.filter((r) => status === "All" || r.bookStatus === status);

  const columns: Column<PlatformRequest>[] = [
    {
      key: "name",
      header: "Request",
      render: (r) => (
        <div>
          <div className="font-medium" style={{ color: "var(--fg)" }}>{r.name}</div>
          <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>{r.id}</div>
        </div>
      ),
    },
    { key: "core", header: "Core", render: (r) => <StatusBadge tone="blue">{r.core}</StatusBadge> },
    { key: "amount", header: "Loan amount", align: "right", hideOnMobile: true, render: (r) => <span className="font-semibold">{formatCurrency(r.loanAmount)}</span> },
    { key: "book", header: "Booking status", render: (r) => <StatusBadge status={r.bookStatus} /> },
    { key: "data", header: "Data status", hideOnMobile: true, render: (r) => <StatusBadge status={dataStatus(r)} /> },
    { key: "proc", header: "Processing status", hideOnMobile: true, render: (r) => <StatusBadge status={processingStatus(r)} /> },
  ];

  return (
    <div>
      <PageHeader title="Booking Events" icon="🏦" subtitle="Loan data transmitted to the core banking systems (Fiserv / FMAC)." />
      <div className="mb-4">
        <QueueTabs
          tabs={STATUSES.map((s) => ({ key: s, label: s, count: all.filter((r) => s === "All" || r.bookStatus === s).length }))}
          active={status}
          onChange={setStatus}
        />
      </div>
      <DataTable columns={columns} rows={rows} empty="No booking events in this status." />
      <p className="mt-3 text-xs" style={{ color: "var(--fg-subtle)" }}>
        Data Status &amp; Processing Status are shown as derived dimensions — their exact enum values are pending confirmation against the live platform.
      </p>
    </div>
  );
}
