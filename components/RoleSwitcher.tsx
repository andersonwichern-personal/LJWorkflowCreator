"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ActiveRole = "admin" | "approver" | "preparer";

export interface ActiveRolePersona {
  id: string;
  name: string;
  role: ActiveRole;
  roleLabel: string;
  badgeLabel: string;
  tone: "admin" | "approver" | "preparer";
}

export type Persona = ActiveRolePersona;

export const ACTIVE_ROLES: ActiveRolePersona[] = [
  {
    id: "u-anderson",
    name: "Anderson",
    role: "admin",
    roleLabel: "Admin",
    badgeLabel: "Anderson (Admin)",
    tone: "admin",
  },
  {
    id: "u-wael",
    name: "Wael",
    role: "approver",
    roleLabel: "Committee",
    badgeLabel: "Wael (Committee)",
    tone: "approver",
  },
  {
    id: "u-omar",
    name: "Omar",
    role: "preparer",
    roleLabel: "Preparer",
    badgeLabel: "Omar (Preparer)",
    tone: "preparer",
  },
] as const;

const ROLE_KEY = "wf-active-role";
const ROLE_EVENT = "wf-active-role-change";

function isActiveRole(value: string | null): value is ActiveRole {
  return value === "admin" || value === "approver" || value === "preparer";
}

export function roleFor(value: ActiveRole): ActiveRolePersona {
  return ACTIVE_ROLES.find((role) => role.role === value) ?? ACTIVE_ROLES[0];
}

export function useActiveRole() {
  const [role, setRoleState] = useState<ActiveRole>("admin");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(ROLE_KEY);
      if (isActiveRole(saved)) {
        setRoleState(saved);
        return;
      }
      const legacyPersona = localStorage.getItem("wf-persona");
      const legacyRole = ACTIVE_ROLES.find((persona) => persona.id === legacyPersona)?.role;
      if (legacyRole) setRoleState(legacyRole);
    } catch {
      /* localStorage unavailable; defaults stand */
    }
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === ROLE_KEY && isActiveRole(event.newValue)) {
        setRoleState(event.newValue);
      }
    };
    const onCustom = (event: Event) => {
      const next = (event as CustomEvent<ActiveRole>).detail;
      if (isActiveRole(next)) {
        setRoleState(next);
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(ROLE_EVENT, onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ROLE_EVENT, onCustom as EventListener);
    };
  }, []);

  const setRole = useCallback((next: ActiveRole) => {
    setRoleState(next);
    try {
      localStorage.setItem(ROLE_KEY, next);
    } catch {
      /* best effort only */
    }
    window.dispatchEvent(new CustomEvent<ActiveRole>(ROLE_EVENT, { detail: next }));
  }, []);

  const persona = useMemo(() => roleFor(role), [role]);

  return { role, setRole, persona } as const;
}

function roleBadgeStyles(role: ActiveRole) {
  switch (role) {
    case "admin":
      return {
        background: "linear-gradient(180deg, rgba(34,197,94,0.18), rgba(34,197,94,0.08))",
        color: "var(--fg)",
        boxShadow: "0 0 0 1px rgba(34,197,94,0.24), 0 18px 32px rgba(34,197,94,0.16)",
      };
    case "approver":
      return {
        background: "linear-gradient(180deg, rgba(168,85,247,0.18), rgba(168,85,247,0.08))",
        color: "var(--fg)",
        boxShadow: "0 0 0 1px rgba(168,85,247,0.22), 0 18px 32px rgba(168,85,247,0.16)",
      };
    case "preparer":
      return {
        background: "linear-gradient(180deg, rgba(245,158,11,0.18), rgba(245,158,11,0.08))",
        color: "var(--fg)",
        boxShadow: "0 0 0 1px rgba(245,158,11,0.22), 0 18px 32px rgba(245,158,11,0.16)",
      };
  }
}

function roleMenuStyles(role: ActiveRole) {
  switch (role) {
    case "admin":
      return {
        accent: "rgba(34,197,94,0.28)",
        dot: "rgb(34,197,94)",
        label: "Admin",
      };
    case "approver":
      return {
        accent: "rgba(168,85,247,0.28)",
        dot: "rgb(168,85,247)",
        label: "Committee",
      };
    case "preparer":
      return {
        accent: "rgba(245,158,11,0.28)",
        dot: "rgb(245,158,11)",
        label: "Preparer",
      };
  }
}

export default function RoleSwitcher() {
  const { role, setRole, persona } = useActiveRole();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const roles = ACTIVE_ROLES;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition-transform hover:-translate-y-0.5"
        style={{
          ...roleBadgeStyles(role),
          border: "none",
        }}
      >
        <span className="max-w-[12rem] truncate">{persona.badgeLabel}</span>
        <span
          aria-hidden
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          style={{ color: "var(--fg-muted)" }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Switch active role"
          className="absolute right-0 top-[calc(100%+0.65rem)] z-30 w-72 overflow-hidden rounded-3xl p-2"
          style={{
            background: "var(--panel-solid)",
            boxShadow: "0 28px 60px rgba(15, 23, 42, 0.2), 0 0 0 1px rgba(255,255,255,0.04)",
          }}
        >
          <div className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: "var(--fg-subtle)" }}>
            Active role
          </div>
          <div className="space-y-1">
            {roles.map((item) => {
              const active = item.role === role;
              const menu = roleMenuStyles(item.role);
              return (
                <button
                  key={item.role}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    setRole(item.role);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left transition-all hover:-translate-y-0.5"
                  style={{
                    background: active ? `linear-gradient(180deg, ${menu.accent}, rgba(255,255,255,0.03))` : "transparent",
                    color: "var(--fg)",
                    border: "none",
                  }}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: menu.dot }}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{item.badgeLabel}</span>
                      <span className="block text-[11px]" style={{ color: "var(--fg-subtle)" }}>
                        {active ? "Currently active" : `Switch to ${menu.label.toLowerCase()}`}
                      </span>
                    </span>
                  </span>
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={{
                      background: active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)",
                      color: "var(--fg)",
                    }}
                  >
                    {menu.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
