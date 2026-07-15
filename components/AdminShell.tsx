"use client";

/**
 * Phase 5: the application shell.
 *
 * Owns the providers (brand / viewpoint / automation), renders the collapsible
 * AdminSidebar, and switches the main pane between the dashboard landing, the
 * creator canvas (new / edit / view), and the admin surfaces (approval
 * authorities, audit logs). In-app view state keeps create/edit routing clean
 * without a full page reload.
 */

import { useState } from "react";
import { Construction } from "lucide-react";
import AdminSidebar, { SIDEBAR_RAIL_WIDTH, type NavKey } from "@/components/AdminSidebar";
import WorkflowDashboard, { type OpenCreator } from "@/components/WorkflowDashboard";
import WorkflowCreator from "@/components/WorkflowCreator";
import ApprovalAuthorities from "@/components/ApprovalAuthorities";
import AuditLogs from "@/components/AuditLogs";
import CustomersPanel from "@/components/CustomersPanel";
import { AutomationPausedBanner, AutomationProvider } from "@/components/AutomationControls";
import { ViewpointProvider, useViewpoint } from "@/lib/viewpoint";
import { BrandProvider } from "@/lib/brand";

type View =
  | { name: "dashboard" }
  | { name: "creator"; id: string | null; intent: OpenCreator["intent"] }
  | { name: "authorities" }
  | { name: "customers" }
  | { name: "audit" }
  | { name: "placeholder"; key: NavKey; label: string };

const PLACEHOLDER_LABELS: Partial<Record<NavKey, string>> = {
  home: "Home",
  requests: "Requests",
  templates: "Templates",
  customers: "Customers",
  offers: "Offers",
  underwriting: "Underwriting",
  loans: "Loans",
  booking: "Booking Events",
};

export default function AdminShell({ initialView = "dashboard" }: { initialView?: "dashboard" }) {
  return (
    <BrandProvider>
      <ViewpointProvider>
        <AutomationProvider>
          <ShellBody initialView={initialView} />
        </AutomationProvider>
      </ViewpointProvider>
    </BrandProvider>
  );
}

function ShellBody({ initialView }: { initialView: "dashboard" }) {
  const [view, setView] = useState<View>({ name: initialView });
  const [reloadToken, setReloadToken] = useState(0);

  function navigate(key: NavKey) {
    if (key === "workflows") setView({ name: "dashboard" });
    else if (key === "root") setView({ name: "authorities" });
    else if (key === "customers") setView({ name: "customers" });
    else if (key === "system") setView({ name: "audit" });
    else setView({ name: "placeholder", key, label: PLACEHOLDER_LABELS[key] ?? "Section" });
  }

  function openCreator(opts: OpenCreator) {
    setView({ name: "creator", id: opts.id ?? null, intent: opts.intent });
  }

  function backToDashboard() {
    setReloadToken((t) => t + 1); // re-fetch the list on return
    setView({ name: "dashboard" });
  }

  const activeNav: NavKey =
    view.name === "dashboard" || view.name === "creator"
      ? "workflows"
      : view.name === "authorities"
        ? "root"
        : view.name === "customers"
          ? "customers"
        : view.name === "audit"
          ? "system"
          : view.key;

  return (
    <div className="min-h-screen">
      <AdminSidebar activeNav={activeNav} onNavigate={navigate} />

      <div style={{ paddingLeft: SIDEBAR_RAIL_WIDTH }}>
        <AutomationPausedBanner />
        <main className="mx-auto max-w-[1440px] px-5 py-6 sm:px-8">
          {view.name === "dashboard" && (
            <WorkflowDashboard reloadToken={reloadToken} onOpenCreator={openCreator} />
          )}
          {view.name === "creator" && (
            <WorkflowCreator intent={view.intent} initialWorkflowId={view.id} onExit={backToDashboard} />
          )}
          {view.name === "authorities" && <AdminSection title="Approval Authorities"><ApprovalAuthorities /></AdminSection>}
          {view.name === "customers" && <AdminSection title="Customers"><CustomersPanel /></AdminSection>}
          {view.name === "audit" && <AdminSection title="Audit Logs"><AuditLogs /></AdminSection>}
          {view.name === "placeholder" && <Placeholder label={view.label} onBack={() => navigate("workflows")} />}
        </main>
      </div>
    </div>
  );
}

/** Approval/audit surfaces are dev-facing; hide them in presentation view. */
function AdminSection({ title, children }: { title: string; children: React.ReactNode }) {
  const { isPresentation } = useViewpoint();
  if (isPresentation) {
    return (
      <div className="glass mx-auto mt-10 max-w-md rounded-2xl p-8 text-center">
        <h2 className="text-lg font-semibold" style={{ color: "var(--fg)" }}>
          {title}
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--fg-subtle)" }}>
          This surface is hidden in presentation view. Switch to Builder in Settings to see it.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function Placeholder({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="glass mx-auto mt-10 max-w-lg rounded-2xl p-10 text-center">
      <div
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: "var(--accent-soft)" }}
      >
        <Construction size={26} strokeWidth={1.75} style={{ color: "var(--accent)" }} />
      </div>
      <h1 className="mt-4 text-xl font-semibold" style={{ color: "var(--fg)" }}>
        {label}
      </h1>
      <p className="mt-1.5 text-sm" style={{ color: "var(--fg-subtle)" }}>
        This section of the Landjourney admin console isn&apos;t part of the Workflow Creator demo.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="ring-accent mt-5 inline-block rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110"
        style={{ background: "var(--accent)" }}
      >
        Back to Workflows
      </button>
    </div>
  );
}
