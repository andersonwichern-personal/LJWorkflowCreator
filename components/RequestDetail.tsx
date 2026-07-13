"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  PlatformRequest,
  formatCurrency,
  documentsFor,
  deriveDataStatus,
  deriveProcessingStatus,
} from "@/lib/platformData";
import { listWorkflows, WorkflowRecord } from "@/lib/api";
import { workflowsForRequest, describeActions } from "@/lib/ruleEngine";
import StatusBadge from "@/components/ui/StatusBadge";
import PageHeader from "@/components/ui/PageHeader";

const TABS = ["Overview", "Documents", "Underwriting", "Booking", "Automation", "Discussion"] as const;
type Tab = (typeof TABS)[number];

export default function RequestDetail({ request }: { request: PlatformRequest }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [workflows, setWorkflows] = useState<WorkflowRecord[] | null>(null);

  useEffect(() => {
    listWorkflows().then(setWorkflows).catch(() => setWorkflows([]));
  }, []);

  const matches = workflowsForRequest(request, workflows ?? []);
  const { docs, extracted } = documentsFor(request);

  return (
    <div>
      <div className="mb-3">
        <Link href="/requests" className="text-sm font-medium" style={{ color: "var(--accent)" }}>
          ← Requests
        </Link>
      </div>

      <PageHeader
        title={request.name}
        icon="📄"
        subtitle={`${request.id} · ${request.customerType} · ${request.retailer} · ${request.program}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={request.stage} />
            {matches.length > 0 && (
              <span
                className="rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                ⚡ {matches.length} workflow{matches.length > 1 ? "s" : ""} match
              </span>
            )}
          </div>
        }
      />

      {/* Tabs */}
      <div className="scroll-thin mb-4 flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--panel-border)" }}>
        {TABS.map((t) => {
          const on = t === tab;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="ring-accent relative shrink-0 px-3.5 py-2.5 text-sm font-medium transition-colors"
              style={{ color: on ? "var(--accent)" : "var(--fg-muted)" }}
            >
              {t}
              {t === "Automation" && matches.length > 0 && (
                <span className="ml-1 rounded-full px-1.5 text-[10px] font-bold" style={{ background: "var(--accent)", color: "#fff" }}>
                  {matches.length}
                </span>
              )}
              {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full" style={{ background: "var(--accent)" }} />}
            </button>
          );
        })}
      </div>

      {tab === "Overview" && <Overview request={request} />}
      {tab === "Documents" && <Documents docs={docs} extracted={extracted} />}
      {tab === "Underwriting" && <Underwriting request={request} />}
      {tab === "Booking" && <Booking request={request} />}
      {tab === "Automation" && <Automation request={request} matches={matches} loaded={workflows !== null} />}
      {tab === "Discussion" && <Discussion request={request} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>{label}</div>
      <div className="mt-1 text-sm" style={{ color: "var(--fg)" }}>{children}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--fg)" }}>{title}</h3>
      {children}
    </div>
  );
}

function Overview({ request: r }: { request: PlatformRequest }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card title="Loan details">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Field label="Loan amount"><span className="text-lg font-semibold">{formatCurrency(r.loanAmount)}</span></Field>
            <Field label="Product">{r.loanProduct}</Field>
            <Field label="Core system">{r.core}</Field>
            <Field label="Main borrower">{r.mainBorrower}</Field>
            <Field label="Retailer">{r.retailer}</Field>
            <Field label="Program">{r.program}</Field>
            <Field label="Team member">{r.teamMember ?? "Unassigned"}</Field>
            <Field label="Submitted">{r.dateSubmitted}</Field>
            <Field label="Customer type">{r.customerType}</Field>
          </div>
          {r.tags.length > 0 && (
            <div className="mt-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>Tags</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {r.tags.map((t) => (
                  <span key={t} className="rounded-md px-2 py-0.5 text-xs" style={{ background: "var(--tok-op-bg)", color: "var(--fg-muted)" }}>{t}</span>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
      <Card title="Status">
        <div className="flex flex-col gap-3">
          <Field label="Stage"><StatusBadge status={r.stage} /></Field>
          <Field label="Underwriting"><StatusBadge status={r.uwStatus} /></Field>
          <Field label="Booking"><StatusBadge status={r.bookStatus} /></Field>
          {r.offerQueue && <Field label="Offer queue"><StatusBadge status={r.offerQueue} /></Field>}
        </div>
      </Card>
    </div>
  );
}

function Documents({ docs, extracted }: { docs: ReturnType<typeof documentsFor>["docs"]; extracted: ReturnType<typeof documentsFor>["extracted"] }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card title="Documents Review">
        <div className="flex flex-col gap-2">
          {docs.map((d) => (
            <div key={d.name} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)" }}>
              <span className="text-sm" style={{ color: "var(--fg)" }}>{d.name}</span>
              <StatusBadge status={d.status} />
            </div>
          ))}
        </div>
      </Card>
      <Card title="AI Data Extraction">
        <div className="flex flex-col gap-2">
          {extracted.map((f) => (
            <div key={f.label} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)" }}>
              <span className="text-sm" style={{ color: "var(--fg-muted)" }}>{f.label}</span>
              <span className="text-sm font-medium" style={{ color: "var(--fg)" }}>{f.value}</span>
            </div>
          ))}
          <p className="mt-1 text-xs" style={{ color: "var(--fg-subtle)" }}>
            Extracted fields are per-template (dynamic form + AI extraction), not a fixed global enum.
          </p>
        </div>
      </Card>
    </div>
  );
}

function Underwriting({ request: r }: { request: PlatformRequest }) {
  return (
    <Card title="Underwriting">
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Field label="Result"><StatusBadge status={r.uwStatus} /></Field>
        <Field label="Queue">{r.uwQueue}</Field>
        <Field label="Reviewer">{r.teamMember ?? "Unassigned"}</Field>
        <Field label="Amount">{formatCurrency(r.loanAmount)}</Field>
      </div>
    </Card>
  );
}

function Booking({ request: r }: { request: PlatformRequest }) {
  return (
    <Card title="Booking Event">
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Field label="Core">{r.core}</Field>
        <Field label="Booking status"><StatusBadge status={r.bookStatus} /></Field>
        <Field label="Data status"><StatusBadge status={deriveDataStatus(r)} /></Field>
        <Field label="Processing status"><StatusBadge status={deriveProcessingStatus(r)} /></Field>
      </div>
      {r.bookStatus === "Error" && (
        <div className="mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ background: "var(--danger-bg)", color: "var(--danger-fg)", border: "1px solid var(--danger-br)" }}>
          <span aria-hidden>🚨</span>
          <span>Booking to {r.core} failed. A <strong>SYSTEM ERROR</strong> event was emitted — see the Automation tab for workflows that would escalate this.</span>
        </div>
      )}
    </Card>
  );
}

function Automation({ request: r, matches, loaded }: { request: PlatformRequest; matches: WorkflowRecord[]; loaded: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <Card title="Workflows that would act on this request">
        {!loaded && <p className="text-sm" style={{ color: "var(--fg-subtle)" }}>Checking saved workflows…</p>}
        {loaded && matches.length === 0 && (
          <div className="rounded-xl border border-dashed p-5 text-center" style={{ borderColor: "var(--panel-border)" }}>
            <p className="text-sm" style={{ color: "var(--fg-muted)" }}>No enabled workflow matches this request&apos;s current state.</p>
            <Link href="/workflows" className="mt-2 inline-block text-sm font-medium" style={{ color: "var(--accent)" }}>
              Build one in the Workflow Creator →
            </Link>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {matches.map((w) => (
            <div key={w.id} className="rounded-xl border p-4" style={{ borderColor: "var(--ring)", background: "var(--accent-soft)" }}>
              <div className="flex items-center justify-between">
                <Link href="/workflows" className="text-sm font-semibold" style={{ color: "var(--fg)" }}>{w.name}</Link>
                <StatusBadge tone="green">would fire</StatusBadge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {describeActions(w.ruleJson).map((a, i) => (
                  <span key={i} className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "var(--tok-then-bg)", color: "var(--tok-then-fg)" }}>
                    → {a}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs" style={{ color: "var(--fg-subtle)" }}>
          Simulation only — the real event bus + action executor run in the backend. This shows how your
          saved rules would evaluate against {r.name}&apos;s current state.
        </p>
      </Card>
    </div>
  );
}

function Discussion({ request: r }: { request: PlatformRequest }) {
  const channels = ["Request-wide", "Customer Task", "Internal Task"];
  return (
    <Card title="Discussions">
      <div className="flex flex-col gap-3">
        {channels.map((c) => (
          <div key={c} className="rounded-xl px-4 py-3" style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)" }}>
            <div className="text-sm font-semibold" style={{ color: "var(--fg)" }}>{c}</div>
            <div className="mt-1 text-sm" style={{ color: "var(--fg-subtle)" }}>
              {c === "Internal Task" ? `Assigned to ${r.teamMember ?? "the team"} — no messages yet.` : "No messages yet."}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
