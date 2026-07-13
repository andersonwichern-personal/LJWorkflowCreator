import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { RETAILERS } from "@/lib/platformData";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" icon="⚙️" subtitle="Users, retailers, and org configuration." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Users" value={43} hint="flat user list" icon="👤" />
        <StatCard label="Retailers" value={RETAILERS.length} hint="active retailers" icon="🏬" />
        <StatCard label="Org" value="OBA" hint="Organic Bank of America" icon="🏦" />
        <StatCard label="Tenant" value="test" hint="admin-test" icon="🧪" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="glass rounded-2xl p-5">
          <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--fg)" }}>Retailers</h3>
          <div className="flex flex-col gap-2">
            {RETAILERS.map((r) => (
              <div key={r} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)" }}>
                <span style={{ color: "var(--fg)" }}>{r}</span>
                <span className="text-xs" style={{ color: "var(--fg-subtle)" }}>Active</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--fg)" }}>Users &amp; permissions</h3>
          <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
            Settings → Users is a flat list of 43 people (name, email, phone). There is no roles /
            authority hierarchy today — workflows assign to a named person or team, not an authority ladder.
          </p>
        </div>
      </div>
    </div>
  );
}
