"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Step {
  title: string;
  body: string;
  href: string;
  icon: string;
}

/** The Growmark booking-error → escalation story, told across the real screens. */
const STEPS: Step[] = [
  {
    icon: "🏠",
    title: "Welcome to the console",
    body: "This is the Landjourney admin console. Follow along as a booking error becomes an automated escalation — across real screens.",
    href: "/",
  },
  {
    icon: "📡",
    title: "An event fires",
    body: "System Events is the live lifecycle log. A booking to Fiserv just failed for Prairie Gold Farms — a SYSTEM ERROR event. Notice which workflows it triggered.",
    href: "/system-events",
  },
  {
    icon: "📄",
    title: "The affected request",
    body: "Open the failing request. The Booking tab shows the error; the Automation tab shows exactly which saved workflows would act on it, and what they'd do.",
    href: "/requests/REQ-4821",
  },
  {
    icon: "⚡",
    title: "The workflow that handles it",
    body: "Here's the builder. Edit the rule in plain English — the simulation panel shows, live, which real requests it matches right now.",
    href: "/workflows",
  },
  {
    icon: "📊",
    title: "The whole book at a glance",
    body: "Insights rolls it all up: volume, approval rate, booking health, and the automation run-history. That's the loop — event → rule → action → audit.",
    href: "/insights",
  },
];

export default function DemoTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (open) {
      setI(0);
      router.push(STEPS[0].href);
    }
  }, [open, router]);

  if (!open) return null;
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  function go(next: number) {
    setI(next);
    router.push(STEPS[next].href);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[75] flex justify-center px-4 pb-5" role="dialog" aria-label="Guided tour">
      <div className="glass animate-rise w-full max-w-[520px] rounded-2xl p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: "var(--accent-soft)" }}>
            {step.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold" style={{ color: "var(--fg)" }}>{step.title}</h3>
              <button type="button" onClick={onClose} aria-label="End tour" className="ring-accent rounded-lg px-2 text-lg" style={{ color: "var(--fg-subtle)" }}>×</button>
            </div>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>{step.body}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((_, idx) => (
              <button
                key={idx}
                type="button"
                aria-label={`Step ${idx + 1}`}
                onClick={() => go(idx)}
                className="h-1.5 rounded-full transition-all"
                style={{ width: idx === i ? 20 : 8, background: idx === i ? "var(--accent)" : "var(--tok-op-bg)" }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {i > 0 && (
              <button type="button" onClick={() => go(i - 1)} className="ring-accent rounded-lg px-3 py-1.5 text-sm font-medium" style={{ color: "var(--fg-muted)" }}>
                ← Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? onClose() : go(i + 1))}
              className="ring-accent rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition-all hover:brightness-110"
              style={{ background: "var(--accent)" }}
            >
              {last ? "Done" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
