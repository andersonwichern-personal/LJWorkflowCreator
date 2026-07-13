"use client";

/** Horizontal pill tabs with counts (Underwriting / Offers queues, Loans tabs). */
export default function QueueTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="scroll-thin flex gap-1.5 overflow-x-auto pb-1">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className="ring-accent flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all"
            style={{
              background: on ? "var(--accent)" : "var(--panel)",
              color: on ? "#fff" : "var(--fg-muted)",
              border: `1px solid ${on ? "transparent" : "var(--panel-border)"}`,
            }}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span
                className="rounded-full px-1.5 text-[11px] font-semibold"
                style={{
                  background: on ? "rgba(255,255,255,0.25)" : "var(--tok-op-bg)",
                  color: on ? "#fff" : "var(--fg-subtle)",
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
