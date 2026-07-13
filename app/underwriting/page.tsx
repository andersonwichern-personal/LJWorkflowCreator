"use client";

import { useState } from "react";
import Link from "next/link";
import { REQUESTS, formatCurrency, PlatformRequest } from "@/lib/platformData";
import PageHeader from "@/components/ui/PageHeader";
import QueueTabs from "@/components/ui/QueueTabs";
import DataTable, { Column } from "@/components/ui/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";

const QUEUES = [
  "My Requests",
  "Unassigned",
  "Assigned",
  "Auto Approved",
  "Approved",
  "Rejected",
  "All Requests",
] as const;

/** Current demo user — used for the "My Requests" queue. */
const ME = "Wael";

function inQueue(r: PlatformRequest, q: string): boolean {
  if (q === "All Requests") return true;
  if (q === "My Requests") return r.teamMember === ME;
  return r.uwQueue === q;
}

export default function UnderwritingPage() {
  const [queue, setQueue] = useState<string>("All Requests");
  const rows = REQUESTS.filter((r) => inQueue(r, queue));

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
    { key: "date", header: "Submitted", align: "left", hideOnMobile: true, render: (r) => <span style={{ color: "var(--fg-muted)" }}>{r.dateSubmitted}</span> },
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
              <span key={t} className="rounded-md px-1.5 py-0.5 text-[11px]" style={{ background: "var(--tok-op-bg)", color: "var(--fg-muted)" }}>
                {t}
              </span>
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
          onChange={setQueue}
        />
      </div>
      <DataTable columns={columns} rows={rows} empty="No requests in this queue." />
    </div>
  );
}
