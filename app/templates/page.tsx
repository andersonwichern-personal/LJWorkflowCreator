import PageHeader from "@/components/ui/PageHeader";

const TEMPLATE_TYPES = [
  { name: "Loan Application", icon: "📝", desc: "Customer-facing intake for a new loan — dynamic form, document checklist, signatures." },
  { name: "Origination", icon: "🏗️", desc: "Staff-driven origination workflow with underwriting and offer steps." },
  { name: "Covenant", icon: "📎", desc: "Ongoing covenant / compliance collection on an existing relationship." },
];

const BUILDERS = ["Dynamic forms", "Document checklists", "Signature templates", "Data-extraction templates", "Letters"];

export default function TemplatesPage() {
  return (
    <div>
      <PageHeader title="Templates" icon="🧩" subtitle="Configure the request types and building blocks used at intake." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {TEMPLATE_TYPES.map((t) => (
          <div key={t.name} className="glass rounded-2xl p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl text-xl" style={{ background: "var(--accent-soft)" }}>{t.icon}</div>
            <h3 className="mt-3 text-base font-semibold" style={{ color: "var(--fg)" }}>{t.name}</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>{t.desc}</p>
          </div>
        ))}
      </div>

      <div className="glass mt-5 rounded-2xl p-5">
        <h3 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>Building blocks</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {BUILDERS.map((b) => (
            <span key={b} className="rounded-full px-3 py-1.5 text-sm" style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)", color: "var(--fg-muted)" }}>
              {b}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
