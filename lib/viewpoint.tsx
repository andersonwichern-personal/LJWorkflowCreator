"use client";

/**
 * Phase 3: user viewpoints and the demo layout switch.
 *
 * The header exposes two client-side switches:
 *  - Role switcher — impersonate a persona (Admin / Approver / Preparer) to
 *    demo permission gating without a real auth session.
 *  - View mode — Presentation (clean, client-facing) vs Builder (full dev
 *    surface: simulation traces, rule JSON, audit logs).
 *
 * Honesty guardrail: this is UI gating for the demo. Server routes enforce the
 * hard rules that matter (maker-checker, seat eligibility) independently.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ACTIVE_ROLES, useActiveRole, type ActiveRole, type Persona } from "@/components/RoleSwitcher";

export type ViewpointRole = ActiveRole;
export type ViewMode = "builder" | "presentation";

export type { Persona } from "@/components/RoleSwitcher";
export const PERSONAS = ACTIVE_ROLES as Persona[];

/** Directory-less demo mapping: an assignee label → its approver seat id. */
export function approverIdFor(label: string): string {
  return `u-${label.trim().toLowerCase().replace(/\s+/g, "-")}`;
}

/**
 * Maker-checker exclusions frozen onto a new task: every preparer seat (the
 * request maker) plus the persona initiating the review (the requester).
 */
export function makerCheckerExclusions(requesterId?: string): string[] {
  const ids = PERSONAS.filter((p) => p.role === "preparer").map((p) => p.id);
  if (requesterId && !ids.includes(requesterId)) ids.push(requesterId);
  return ids;
}

interface ViewpointValue {
  persona: Persona;
  setPersona: (p: Persona) => void;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  /** Only the Admin viewpoint may edit the canvas and authority settings. */
  canEdit: boolean;
  /** The Committee viewpoint may draft rules that save as `proposed` drafts. */
  canPropose: boolean;
  /** Presentation view hides dev logs, traces, lint panels, and raw JSON. */
  isPresentation: boolean;
}

const ViewpointContext = createContext<ViewpointValue>({
  persona: PERSONAS[0],
  setPersona: () => {},
  viewMode: "builder",
  setViewMode: () => {},
  canEdit: true,
  canPropose: false,
  isPresentation: false,
});

const VIEWMODE_KEY = "wf-viewmode";

export function ViewpointProvider({ children }: { children: React.ReactNode }) {
  const { persona, setRole } = useActiveRole();
  const [viewMode, setViewModeState] = useState<ViewMode>("builder");
  const setPersona = useCallback(
    (p: Persona) => {
      setRole(p.role);
    },
    [setRole]
  );

  // Rehydrate after mount (SSR-safe): the switches survive reloads mid-demo.
  useEffect(() => {
    try {
      const mode = localStorage.getItem(VIEWMODE_KEY);
      if (mode === "presentation" || mode === "builder") setViewModeState(mode);
    } catch {
      /* private mode etc. — defaults stand */
    }
  }, []);

  const setViewMode = useCallback((m: ViewMode) => {
    setViewModeState(m);
    try {
      localStorage.setItem(VIEWMODE_KEY, m);
    } catch {}
  }, []);

  return (
    <ViewpointContext.Provider
      value={{
        persona,
        setPersona,
        viewMode,
        setViewMode,
        canEdit: persona.role === "admin",
        canPropose: persona.role === "approver",
        isPresentation: viewMode === "presentation",
      }}
    >
      {children}
    </ViewpointContext.Provider>
  );
}

export function useViewpoint(): ViewpointValue {
  return useContext(ViewpointContext);
}
