"use client";

/**
 * Phase 5: retractable hover sidebar (Landjourney admin look).
 *
 * Collapsed to a 64px icon rail; expands to 260px on hover / focus (or while a
 * popover is pinned open). Carries the primary nav, the mock "Organic Bank of
 * America" brand header, a footer persona switcher (moved out of the page
 * header), and a settings popover that hosts the brand customiser.
 *
 * Supersedes the earlier hand-rolled SVG stub: uses Lucide icons, drives
 * in-app view routing via onNavigate, and re-themes with the brand tokens.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  CalendarClock,
  ChevronDown,
  GitBranch,
  Home,
  Inbox,
  Landmark,
  LayoutTemplate,
  type LucideIcon,
  Palette,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Tag,
  UserCircle,
  Users,
  Wheat,
  Wrench,
} from "lucide-react";
import { ACTIVE_ROLES, useActiveRole, type ActiveRole } from "@/components/RoleSwitcher";
import {
  useBrand,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  normalizeHex,
} from "@/lib/brand";
import { useViewpoint } from "@/lib/viewpoint";
import { PauseAutomationsButton } from "@/components/AutomationControls";

export type NavKey =
  | "home"
  | "requests"
  | "templates"
  | "customers"
  | "offers"
  | "underwriting"
  | "loans"
  | "booking"
  | "workflows"
  | "root"
  | "system";

interface NavItem {
  key: NavKey;
  label: string;
  icon: LucideIcon;
}

/** Nav order matches the Landjourney admin rail; Workflows is our live page. */
const NAV: NavItem[] = [
  { key: "home", label: "Home", icon: Home },
  { key: "requests", label: "Requests", icon: Inbox },
  { key: "templates", label: "Templates", icon: LayoutTemplate },
  { key: "customers", label: "Customers", icon: Users },
  { key: "offers", label: "Offers", icon: Tag },
  { key: "underwriting", label: "Underwriting", icon: ShieldCheck },
  { key: "loans", label: "Loans", icon: Landmark },
  { key: "booking", label: "Booking Events", icon: CalendarClock },
  { key: "workflows", label: "Workflows", icon: GitBranch },
  { key: "root", label: "Root Tools", icon: Wrench },
  { key: "system", label: "System Events", icon: Activity },
];

const RAIL = "var(--brand-primary)"; // primary brand colour — the console chrome
const RAIL_HOVER = "rgba(255,255,255,0.06)";
const RAIL_ACTIVE = "rgba(255,255,255,0.12)";
const TEXT = "rgba(255,255,255,0.74)";
const TEXT_ACTIVE = "#ffffff";

export const SIDEBAR_RAIL_WIDTH = 64;

export default function AdminSidebar({
  activeNav,
  onNavigate,
}: {
  activeNav: NavKey;
  onNavigate: (key: NavKey) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [openPopover, setOpenPopover] = useState<null | "persona" | "settings">(null);
  const [logoError, setLogoError] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);
  const { brand } = useBrand();

  const expanded = hovered || openPopover !== null;
  const showLogo = !!brand.logoUrl && !logoError;

  // A new logo URL gets a fresh chance to load.
  useEffect(() => {
    setLogoError(false);
  }, [brand.logoUrl]);

  // Close popovers on outside click / Escape.
  useEffect(() => {
    if (!openPopover) return;
    const onDown = (e: MouseEvent) => {
      if (asideRef.current && !asideRef.current.contains(e.target as Node)) setOpenPopover(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenPopover(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openPopover]);

  return (
    <aside
      ref={asideRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setHovered(false);
      }}
      aria-label="Primary navigation"
      className="fixed left-0 top-0 z-40 flex h-screen flex-col"
      style={{
        width: expanded ? 260 : SIDEBAR_RAIL_WIDTH,
        background: RAIL,
        color: TEXT,
        transition: "width 0.25s ease",
        boxShadow: expanded ? "8px 0 32px rgba(2, 20, 28, 0.35)" : "none",
      }}
    >
      {/* Brand header — the brand logo (falls back to a wheat mark on error). */}
      <div className="flex h-16 shrink-0 items-center gap-3 px-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl"
          style={{ background: showLogo ? "#ffffff" : "rgba(255,255,255,0.10)" }}
        >
          {showLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt="LandJourney"
              className="h-full w-full object-contain p-1"
              onError={() => setLogoError(true)}
            />
          ) : (
            <Wheat size={20} strokeWidth={1.75} style={{ color: "var(--accent)" }} />
          )}
        </div>
        <div
          className="min-w-0 overflow-hidden whitespace-nowrap"
          style={{ opacity: expanded ? 1 : 0, transition: "opacity 0.2s ease" }}
        >
          <div className="truncate text-sm font-semibold" style={{ color: TEXT_ACTIVE }}>
            LandJourney
          </div>
          <div className="truncate text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
            Admin Console
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        {expanded ? (
          <label
            className="flex items-center gap-2 rounded-lg px-2.5 py-2"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <Search size={16} strokeWidth={1.75} style={{ color: "rgba(255,255,255,0.55)" }} />
            <input
              type="search"
              placeholder="Search…"
              aria-label="Search the console"
              className="w-full bg-transparent text-sm outline-none placeholder:text-white/40"
              style={{ color: TEXT_ACTIVE }}
            />
          </label>
        ) : (
          <div
            className="flex h-9 items-center justify-center rounded-lg"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <Search size={18} strokeWidth={1.75} style={{ color: "rgba(255,255,255,0.6)" }} />
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2 py-1">
        {NAV.map((item) => (
          <NavButton
            key={item.key}
            item={item}
            active={item.key === activeNav}
            expanded={expanded}
            onClick={() => onNavigate(item.key)}
          />
        ))}
      </nav>

      {/* Footer — settings + persona switcher */}
      <div
        className="relative shrink-0 border-t px-2 py-2"
        style={{ borderColor: "rgba(255,255,255,0.08)" }}
      >
        <SettingsButton
          expanded={expanded}
          open={openPopover === "settings"}
          onToggle={() => setOpenPopover((p) => (p === "settings" ? null : "settings"))}
        />
        <PersonaFooter
          expanded={expanded}
          open={openPopover === "persona"}
          onToggle={() => setOpenPopover((p) => (p === "persona" ? null : "persona"))}
        />
      </div>
    </aside>
  );
}

function NavButton({
  item,
  active,
  expanded,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      title={expanded ? undefined : item.label}
      aria-current={active ? "page" : undefined}
      className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors"
      style={{
        background: active ? RAIL_ACTIVE : "transparent",
        color: active ? TEXT_ACTIVE : TEXT,
        boxShadow: active ? "inset 3px 0 0 var(--accent)" : "none",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = RAIL_HOVER;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <Icon size={19} strokeWidth={active ? 2 : 1.75} />
      </span>
      <span
        className="min-w-0 flex-1 truncate"
        style={{ opacity: expanded ? 1 : 0, transition: "opacity 0.18s ease" }}
      >
        {item.label}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings popover — hosts the brand customiser + demo controls.             */
/* -------------------------------------------------------------------------- */

function SettingsButton({
  expanded,
  open,
  onToggle,
}: {
  expanded: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        title={expanded ? undefined : "Settings & branding"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="mb-1 flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors"
        style={{ background: open ? RAIL_ACTIVE : "transparent", color: open ? TEXT_ACTIVE : TEXT }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = RAIL_HOVER;
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "transparent";
        }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          <Settings size={19} strokeWidth={1.75} />
        </span>
        <span
          className="min-w-0 flex-1 truncate"
          style={{ opacity: expanded ? 1 : 0, transition: "opacity 0.18s ease" }}
        >
          Settings
        </span>
      </button>
      {open && <BrandSettingsPanel />}
    </div>
  );
}

function ColorField({
  label,
  value,
  fallback,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  fallback: string;
  placeholder: string;
  onCommit: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (v: string) => {
    setDraft(v);
    if (normalizeHex(v)) onCommit(v);
  };

  return (
    <>
      <label
        className="mb-1 block text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--fg-subtle)" }}
      >
        {label}
      </label>
      <div className="mb-3 flex items-center gap-2">
        <input
          type="color"
          aria-label={`Pick ${label.toLowerCase()}`}
          value={normalizeHex(draft) ?? fallback}
          onChange={(e) => commit(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0"
        />
        <input
          type="text"
          aria-label={`${label} hex`}
          value={draft}
          onChange={(e) => commit(e.target.value)}
          placeholder={placeholder}
          className="ring-accent w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
          style={{ borderColor: "var(--panel-border)", background: "var(--panel)", color: "var(--fg)" }}
        />
      </div>
    </>
  );
}

function BrandSettingsPanel() {
  const { brand, setPrimary, setSecondary, setLogoUrl, reset } = useBrand();
  const { viewMode, setViewMode } = useViewpoint();

  const handleSync = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/vocabulary/sync", { method: "POST" });
      if (!res.ok) throw new Error(`Sync failed (${res.status})`);
      const schema = await res.json();
      localStorage.setItem("wf-custom-vocab", JSON.stringify(schema));
      window.dispatchEvent(new Event("wf-custom-vocab-sync"));
      alert("Synced 2 fields and 2 tags from Landjourney schema!");
    } catch (error: unknown) {
      alert(`Failed to sync vocabulary: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  return (
    <div
      role="dialog"
      aria-label="Settings and branding"
      className="animate-popin absolute bottom-0 left-[calc(100%+10px)] z-50 w-72 rounded-2xl p-4"
      style={{
        background: "var(--panel-solid)",
        border: "1px solid var(--panel-border)",
        boxShadow: "0 24px 60px rgba(15,23,42,0.28)",
        color: "var(--fg)",
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Palette size={16} strokeWidth={2} style={{ color: "var(--accent)" }} />
        <h3 className="text-sm font-semibold">Brand customizer</h3>
      </div>

      <ColorField
        label="Primary brand color"
        value={brand.primary}
        fallback={DEFAULT_PRIMARY_COLOR}
        placeholder="#133C14"
        onCommit={setPrimary}
      />
      <ColorField
        label="Secondary brand color"
        value={brand.secondary}
        fallback={DEFAULT_SECONDARY_COLOR}
        placeholder="#1CBE73"
        onCommit={setSecondary}
      />

      {/* Logo URL */}
      <label
        className="mb-1 block text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--fg-subtle)" }}
      >
        Branding logo URL
      </label>
      <input
        type="url"
        aria-label="Branding logo URL"
        value={brand.logoUrl}
        onChange={(e) => setLogoUrl(e.target.value)}
        placeholder="https://…/logo.png"
        className="ring-accent mb-3 w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
        style={{ borderColor: "var(--panel-border)", background: "var(--panel)", color: "var(--fg)" }}
      />

      <button
        type="button"
        onClick={reset}
        className="ring-accent mb-3 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--accent-soft)]"
        style={{ borderColor: "var(--panel-border)", color: "var(--fg-muted)" }}
      >
        <RotateCcw size={13} strokeWidth={2} /> Reset to default
      </button>

      {/* Demo controls */}
      <div className="mt-1 border-t pt-3" style={{ borderColor: "var(--panel-border)" }}>
        <div
          className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--fg-subtle)" }}
        >
          Custom Vocabulary
        </div>
        <button
          type="button"
          onClick={handleSync}
          className="ring-accent mb-3 flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all hover:bg-[var(--accent-soft)]"
          style={{ borderColor: "var(--panel-border)", color: "var(--fg-muted)" }}
        >
          Sync Live Schema
        </button>

        <div
          className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--fg-subtle)" }}
        >
          Demo controls
        </div>
        <div
          className="mb-2 flex items-center rounded-xl border p-0.5"
          style={{ borderColor: "var(--panel-border)", background: "var(--panel)" }}
          role="group"
          aria-label="Layout view"
        >
          {(["builder", "presentation"] as const).map((mode) => {
            const active = mode === viewMode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                aria-pressed={active}
                className="ring-accent flex-1 rounded-[9px] px-2.5 py-1.5 text-xs font-semibold capitalize transition-all"
                style={active ? { background: "var(--accent)", color: "#fff" } : { color: "var(--fg-muted)" }}
              >
                {mode}
              </button>
            );
          })}
        </div>
        <PauseAutomationsButton />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Persona footer — the RoleSwitcher, relocated from the page header.         */
/* -------------------------------------------------------------------------- */

function roleDot(role: ActiveRole): string {
  return role === "admin"
    ? "rgb(34,197,94)"
    : role === "approver"
      ? "rgb(168,85,247)"
      : "rgb(245,158,11)";
}

function PersonaFooter({
  expanded,
  open,
  onToggle,
}: {
  expanded: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { role, setRole, persona } = useActiveRole();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        title={expanded ? undefined : persona.badgeLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors"
        style={{ background: open ? RAIL_ACTIVE : "transparent" }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = RAIL_HOVER;
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "transparent";
        }}
      >
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
          <UserCircle size={26} strokeWidth={1.5} style={{ color: TEXT_ACTIVE }} />
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
            style={{ background: roleDot(role), boxShadow: `0 0 0 2px ${RAIL}` }}
            aria-hidden
          />
        </span>
        <span
          className="min-w-0 flex-1 overflow-hidden"
          style={{ opacity: expanded ? 1 : 0, transition: "opacity 0.18s ease" }}
        >
          <span className="block truncate text-sm font-semibold" style={{ color: TEXT_ACTIVE }}>
            {persona.name}
          </span>
          <span className="block truncate text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
            {persona.roleLabel}
          </span>
        </span>
        {expanded && (
          <ChevronDown
            size={16}
            strokeWidth={2}
            style={{
              color: "rgba(255,255,255,0.6)",
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 0.18s ease",
            }}
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Switch active role"
          className="animate-popin absolute bottom-0 left-[calc(100%+10px)] z-50 w-64 rounded-2xl p-2"
          style={{
            background: "var(--panel-solid)",
            border: "1px solid var(--panel-border)",
            boxShadow: "0 24px 60px rgba(15,23,42,0.28)",
            color: "var(--fg)",
          }}
        >
          <div
            className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.24em]"
            style={{ color: "var(--fg-subtle)" }}
          >
            Active role
          </div>
          <div className="space-y-1">
            {ACTIVE_ROLES.map((item) => {
              const active = item.role === role;
              return (
                <button
                  key={item.role}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    setRole(item.role);
                    onToggle();
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-colors"
                  style={{ background: active ? "var(--accent-soft)" : "transparent", color: "var(--fg)" }}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: roleDot(item.role) }}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{item.name}</span>
                      <span className="block text-[11px]" style={{ color: "var(--fg-subtle)" }}>
                        {active ? "Currently active" : `Switch to ${item.roleLabel.toLowerCase()}`}
                      </span>
                    </span>
                  </span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: "var(--tok-op-bg)", color: "var(--fg-muted)" }}
                  >
                    {item.roleLabel}
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
