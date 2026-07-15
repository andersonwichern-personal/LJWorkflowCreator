"use client";

/**
 * Global automation kill switch (Phase 4 §4).
 *
 * A tenant-wide pause that the server's `fire` route enforces (matched rules log
 * PAUSED_ORG and run nothing while paused). This provides the header button and
 * the prominent banner; state is shared via a small context so both stay in sync.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { PauseCircle, Play } from "lucide-react";
import { getOrgControls, setAutomationsPaused } from "@/lib/api";

interface AutomationValue {
  paused: boolean;
  loading: boolean;
  saving: boolean;
  toggle: () => void;
}

const AutomationContext = createContext<AutomationValue>({
  paused: false,
  loading: true,
  saving: false,
  toggle: () => {},
});

export function AutomationProvider({ children }: { children: React.ReactNode }) {
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getOrgControls()
      .then((c) => setPaused(c.automationsPaused))
      .catch(() => setPaused(false))
      .finally(() => setLoading(false));
  }, []);

  const toggle = useCallback(() => {
    setSaving(true);
    const next = !paused;
    setPaused(next); // optimistic
    setAutomationsPaused(next)
      .then((c) => setPaused(c.automationsPaused))
      .catch(() => setPaused(!next)) // roll back on failure
      .finally(() => setSaving(false));
  }, [paused]);

  return (
    <AutomationContext.Provider value={{ paused, loading, saving, toggle }}>
      {children}
    </AutomationContext.Provider>
  );
}

export function useAutomation(): AutomationValue {
  return useContext(AutomationContext);
}

/** Kill switch — Pause all automations / Resume automations. */
export function PauseAutomationsButton() {
  const { paused, saving, toggle } = useAutomation();
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      aria-pressed={paused}
      title={paused ? "Automations are paused org-wide" : "Pause all automations org-wide"}
      className="ring-accent flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50"
      style={
        paused
          ? { background: "var(--warn-fg)", borderColor: "var(--warn-fg)", color: "#fff" }
          : { borderColor: "var(--panel-border)", color: "var(--fg-muted)" }
      }
    >
      {paused ? <Play size={13} strokeWidth={2.5} /> : <PauseCircle size={13} strokeWidth={2} />}
      {paused ? "Resume automations" : "Pause all automations"}
    </button>
  );
}

/** Full-width banner shown while automations are paused. Renders null otherwise. */
export function AutomationPausedBanner() {
  const { paused, saving, toggle } = useAutomation();
  if (!paused) return null;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm font-medium"
      style={{ background: "var(--warn-bg)", color: "var(--warn-fg)", borderBottom: "1px solid var(--warn-br, var(--panel-border))" }}
      role="status"
    >
      <span className="flex items-center gap-2">
        <PauseCircle size={16} strokeWidth={2} aria-hidden />
        Automations are paused for this organization — matched rules are logged as
        <code className="rounded bg-black/10 px-1">PAUSED_ORG</code> and take no action.
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={saving}
        className="ring-accent rounded-lg px-3 py-1 text-xs font-semibold transition-all disabled:opacity-50"
        style={{ background: "var(--warn-fg)", color: "#fff" }}
      >
        {saving ? "Resuming…" : "Resume"}
      </button>
    </div>
  );
}
