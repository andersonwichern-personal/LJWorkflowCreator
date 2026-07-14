"use client";

import { useState } from "react";
import WorkflowCreator from "@/components/WorkflowCreator";
import ApprovalAuthorities from "@/components/ApprovalAuthorities";
import AuditLogs from "@/components/AuditLogs";

const TABS = [
  { key: "rules", label: "Rules Canvas" },
  { key: "authorities", label: "Approval Authorities" },
  { key: "audit", label: "Audit Logs" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabKey>("rules");

  return (
    <div className="min-h-screen">
      <header
        className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"
        style={{ borderColor: "var(--panel-border)", background: "var(--panel)" }}
      >
        <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--fg)" }}>
          LJ Decisioning Engine
        </h1>
        <nav className="flex gap-2" aria-label="Sections">
          {TABS.map((t) => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                aria-current={active ? "page" : undefined}
                className={`ring-accent rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                  active ? "" : "hover:bg-[var(--accent-soft)]"
                }`}
                style={
                  active
                    ? { background: "var(--accent)", color: "#fff" }
                    : { color: "var(--fg-muted)" }
                }
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-6">
        {activeTab === "rules" ? (
          <WorkflowCreator />
        ) : activeTab === "authorities" ? (
          <ApprovalAuthorities />
        ) : (
          <AuditLogs />
        )}
      </main>
    </div>
  );
}
