"use client";

import { useState } from "react";
import WorkflowCreator from "@/components/WorkflowCreator";
import ApprovalAuthorities from "@/components/ApprovalAuthorities";
import AuditLogs from "@/components/AuditLogs";
import { PERSONAS, ViewpointProvider, useViewpoint } from "@/lib/viewpoint";

const TABS = [
  { key: "rules", label: "Rules Canvas" },
  { key: "authorities", label: "Approval Authorities" },
  { key: "audit", label: "Audit Logs", builderOnly: true },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function HomePage() {
  return (
    <ViewpointProvider>
      <HomeShell />
    </ViewpointProvider>
  );
}

function HomeShell() {
  const [activeTab, setActiveTab] = useState<TabKey>("rules");
  const { persona, setPersona, isPresentation, setViewMode } = useViewpoint();

  // Presentation view hides the dev-facing audit surface entirely.
  const tabs = TABS.filter((t) => !(isPresentation && "builderOnly" in t && t.builderOnly));
  const currentTab = tabs.some((t) => t.key === activeTab) ? activeTab : "rules";

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
          {tabs.map((t) => {
            const active = currentTab === t.key;
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

        <div className="flex items-center gap-3">
          {/* Role switcher — impersonate a viewpoint to demo permission gating */}
          <label className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--fg-subtle)" }}>
            <span aria-hidden>👤</span>
            <select
              value={persona.id}
              onChange={(e) => {
                const next = PERSONAS.find((p) => p.id === e.target.value);
                if (next) setPersona(next);
              }}
              aria-label="Viewing as"
              className="ring-accent rounded-lg px-2.5 py-1.5 text-sm font-medium"
              style={{
                background: "var(--panel-solid)",
                border: "1px solid var(--panel-border)",
                color: "var(--fg)",
              }}
            >
              {PERSONAS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.roleLabel})
                </option>
              ))}
            </select>
          </label>

          {/* Demo layout switch — clean client-facing vs full dev surface */}
          <div
            className="flex items-center rounded-xl border p-0.5"
            style={{ borderColor: "var(--panel-border)", background: "var(--panel-solid)" }}
            role="group"
            aria-label="Layout view"
          >
            {(["builder", "presentation"] as const).map((mode) => {
              const active = (mode === "presentation") === isPresentation;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  aria-pressed={active}
                  className="ring-accent rounded-[10px] px-3 py-1.5 text-xs font-semibold capitalize transition-all"
                  style={
                    active
                      ? { background: "var(--accent)", color: "#fff" }
                      : { color: "var(--fg-muted)" }
                  }
                >
                  {mode}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-6">
        {currentTab === "rules" ? (
          <WorkflowCreator />
        ) : currentTab === "authorities" ? (
          <ApprovalAuthorities />
        ) : (
          <AuditLogs />
        )}
      </main>
    </div>
  );
}
