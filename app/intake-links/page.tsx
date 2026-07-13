"use client";

import { useState } from "react";
import { RETAILERS } from "@/lib/platformData";
import PageHeader from "@/components/ui/PageHeader";
import Toggle from "@/components/Toggle";

interface IntakeLink {
  id: string;
  name: string;
  template: string;
  retailer: string;
  slug: string;
  enabled: boolean;
}

const INITIAL: IntakeLink[] = [
  { id: "IL-1", name: "Ag Term Loan — Public", template: "Loan Application", retailer: RETAILERS[0], slug: "growmark-ag-term", enabled: true },
  { id: "IL-2", name: "Equipment Finance Intake", template: "Loan Application", retailer: RETAILERS[2], slug: "heartland-equipment", enabled: true },
  { id: "IL-3", name: "Operating Line Renewal", template: "Covenant", retailer: RETAILERS[1], slug: "fcs-operating-line", enabled: false },
  { id: "IL-4", name: "Real Estate Origination", template: "Origination", retailer: RETAILERS[0], slug: "growmark-real-estate", enabled: true },
];

export default function IntakeLinksPage() {
  const [links, setLinks] = useState(INITIAL);
  const [copied, setCopied] = useState<string | null>(null);

  function toggle(id: string, v: boolean) {
    setLinks((l) => l.map((x) => (x.id === id ? { ...x, enabled: v } : x)));
  }
  function copy(slug: string) {
    const url = `https://clients-test.landjourney.ai/intake/${slug}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(slug);
    setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div>
      <PageHeader
        title="Intake Links"
        icon="🔗"
        subtitle="Public client-portal links — each binds a template + retailer and can be toggled on/off."
        actions={
          <button type="button" className="ring-accent rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:brightness-110" style={{ background: "var(--accent)" }}>
            + New link
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {links.map((l) => (
          <div key={l.id} className="glass rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold" style={{ color: "var(--fg)" }}>{l.name}</h3>
                <p className="mt-0.5 text-xs" style={{ color: "var(--fg-subtle)" }}>{l.template} · {l.retailer}</p>
              </div>
              <Toggle checked={l.enabled} onChange={(v) => toggle(l.id, v)} label={l.name} />
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)" }}>
              <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--fg-muted)" }}>
                clients-test.landjourney.ai/intake/{l.slug}
              </span>
              <button type="button" onClick={() => copy(l.slug)} className="ring-accent shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                {copied === l.slug ? "Copied ✓" : "Copy"}
              </button>
            </div>

            <div className="mt-3">
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: l.enabled ? "var(--tok-if-bg)" : "var(--tok-op-bg)", color: l.enabled ? "var(--tok-if-fg)" : "var(--fg-subtle)" }}>
                {l.enabled ? "Live" : "Off"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
