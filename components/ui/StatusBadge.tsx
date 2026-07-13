import { ReactNode } from "react";

type Tone = "green" | "amber" | "red" | "blue" | "gray";

/** Map a known platform status string to a color tone. */
function toneFor(status: string): Tone {
  const s = status.toLowerCase();
  if (["confirmed", "approved", "auto approved", "sent", "assigned", "complete", "done"].includes(s))
    return "green";
  if (["error", "rejected", "declined", "unconfirmed", "failed"].includes(s)) return "red";
  if (
    ["in flight", "processing", "pending", "partially confirmed", "queued", "initiated", "not sent"].includes(s)
  )
    return "amber";
  if (["closed"].includes(s)) return "gray";
  return "blue";
}

const TONES: Record<Tone, { bg: string; fg: string; br: string }> = {
  green: { bg: "var(--tok-if-bg)", fg: "var(--tok-if-fg)", br: "var(--tok-if-br)" },
  amber: { bg: "var(--warn-bg)", fg: "var(--warn-fg)", br: "var(--warn-br)" },
  red: { bg: "var(--danger-bg)", fg: "var(--danger-fg)", br: "var(--danger-br)" },
  blue: { bg: "var(--tok-when-bg)", fg: "var(--tok-when-fg)", br: "var(--tok-when-br)" },
  gray: { bg: "var(--tok-op-bg)", fg: "var(--fg-subtle)", br: "transparent" },
};

export default function StatusBadge({
  status,
  tone,
  children,
}: {
  status?: string;
  tone?: Tone;
  children?: ReactNode;
}) {
  const t = TONES[tone ?? toneFor(status ?? "")];
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: t.bg, color: t.fg, border: `1px solid ${t.br}` }}
    >
      {children ?? status}
    </span>
  );
}
