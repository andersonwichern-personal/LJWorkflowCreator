import { ReactNode } from "react";

/** Compact KPI tile used across the Home dashboard and section headers. */
export default function StatCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: string;
  accent?: boolean;
}) {
  return (
    <div
      className="glass rounded-2xl p-4"
      style={accent ? { borderColor: "var(--ring)" } : undefined}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>
          {label}
        </span>
        {icon && <span aria-hidden>{icon}</span>}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight" style={{ color: "var(--fg)" }}>
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-xs" style={{ color: "var(--fg-subtle)" }}>
          {hint}
        </div>
      )}
    </div>
  );
}
