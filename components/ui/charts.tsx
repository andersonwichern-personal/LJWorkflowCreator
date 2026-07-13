import { formatCurrency } from "@/lib/platformData";

type Tone = "green" | "amber" | "red" | "gray" | "blue" | "accent";

export function toneVar(tone: Tone): string {
  switch (tone) {
    case "green": return "var(--tok-if-fg)";
    case "amber": return "var(--warn-fg)";
    case "red": return "var(--danger-fg)";
    case "blue": return "var(--tok-when-fg)";
    case "gray": return "var(--fg-subtle)";
    default: return "var(--accent)";
  }
}

/* -------------------------------------------------------------------------- */
/* Horizontal bar list — magnitude by category (single hue)                   */
/* -------------------------------------------------------------------------- */

export function BarList({
  data,
  money = false,
  tone = "accent",
}: {
  data: { label: string; value: number }[];
  money?: boolean;
  tone?: Tone;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const fmt = (v: number) => (money ? formatCurrency(v) : String(v));
  return (
    <div className="flex flex-col gap-3">
      {data.map((d) => (
        <div key={d.label} className="group">
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span style={{ color: "var(--fg-muted)" }}>{d.label}</span>
            <span className="font-semibold tabular-nums" style={{ color: "var(--fg)" }}>{fmt(d.value)}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: "var(--tok-op-bg)" }}>
            <div
              className="h-full rounded-full transition-all duration-500 group-hover:brightness-110"
              style={{ width: `${Math.max((d.value / max) * 100, 2)}%`, background: toneVar(tone) }}
              title={`${d.label}: ${fmt(d.value)}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Donut — a small distribution, with a labeled legend (never color-alone)    */
/* -------------------------------------------------------------------------- */

export function Donut({
  segments,
  centerLabel,
}: {
  segments: { label: string; value: number; tone: Tone }[];
  centerLabel?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = 60;
  const C = 2 * Math.PI * r;
  const gap = 3; // px surface gap between segments
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label="Distribution">
        <g transform="translate(75,75) rotate(-90)">
          <circle r={r} fill="none" stroke="var(--tok-op-bg)" strokeWidth="16" />
          {segments.map((s) => {
            const len = (s.value / total) * C;
            const dash = `${Math.max(len - gap, 0)} ${C - Math.max(len - gap, 0)}`;
            const el = (
              <circle
                key={s.label}
                r={r}
                fill="none"
                stroke={toneVar(s.tone)}
                strokeWidth="16"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              >
                <title>{`${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        </g>
        <text x="75" y="71" textAnchor="middle" fontSize="24" fontWeight="700" fill="var(--fg)">{total}</text>
        <text x="75" y="90" textAnchor="middle" fontSize="10" fill="var(--fg-subtle)">{centerLabel ?? "total"}</text>
      </svg>

      <div className="flex flex-col gap-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: toneVar(s.tone) }} aria-hidden />
            <span className="flex-1" style={{ color: "var(--fg-muted)" }}>{s.label}</span>
            <span className="font-semibold tabular-nums" style={{ color: "var(--fg)" }}>{s.value}</span>
            <span className="w-9 text-right tabular-nums" style={{ color: "var(--fg-subtle)" }}>
              {Math.round((s.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Area trend — change over time (single series)                              */
/* -------------------------------------------------------------------------- */

export function AreaTrend({ data, money = true }: { data: { label: string; value: number }[]; money?: boolean }) {
  const W = 520;
  const H = 150;
  const pad = { l: 8, r: 8, t: 12, b: 22 };
  const max = Math.max(...data.map((d) => d.value), 1);
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const fmt = (v: number) => (money ? "$" + Math.round(v / 1000) + "k" : String(v));

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.value)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${pad.t + innerH} L${x(0)},${pad.t + innerH} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Trend" style={{ display: "block" }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <line x1={pad.l} y1={pad.t + innerH} x2={W - pad.r} y2={pad.t + innerH} stroke="var(--panel-border)" strokeWidth="1" />
      <path d={area} fill="url(#areaGrad)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={d.label}>
          <circle cx={x(i)} cy={y(d.value)} r="3.5" fill="var(--accent)" stroke="var(--panel-solid)" strokeWidth="2">
            <title>{`${d.label}: ${money ? formatCurrency(d.value) : d.value}`}</title>
          </circle>
          <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--fg-subtle)">{d.label}</text>
          {i === data.length - 1 && (
            <text x={x(i)} y={y(d.value) - 8} textAnchor="end" fontSize="10" fontWeight="700" fill="var(--fg)">{fmt(d.value)}</text>
          )}
        </g>
      ))}
    </svg>
  );
}
