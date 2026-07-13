"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, activeHref } from "./nav";
import ThemeToggle from "../ThemeToggle";

/**
 * Landjourney-style application shell: fixed left icon+label rail, a top bar
 * with the current section title, and a scrollable content area. Wraps every
 * route so the Workflow Creator lives inside a believable admin console.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = NAV.find((n) => n.href === active);

  const navList = (
    <nav className="flex flex-1 flex-col gap-0.5 px-2.5">
      {NAV.map((item) => {
        const on = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className="group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150"
            style={{
              background: on ? "var(--accent-soft)" : "transparent",
              color: on ? "var(--accent)" : "var(--fg-muted)",
            }}
          >
            <span className="text-base" aria-hidden>
              {item.icon}
            </span>
            <span className="flex-1">{item.label}</span>
            {item.isNew && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                New
              </span>
            )}
            {on && !item.isNew && (
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
            )}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <Link href="/" className="flex items-center gap-2.5 px-4 py-4" onClick={() => setMobileOpen(false)}>
      <span
        className="flex h-9 w-9 items-center justify-center rounded-xl text-lg font-bold text-white shadow"
        style={{ background: "linear-gradient(135deg, var(--accent), #a855f7)" }}
      >
        ⚡
      </span>
      <span>
        <span className="block text-sm font-semibold leading-tight" style={{ color: "var(--fg)" }}>
          Landjourney
        </span>
        <span className="block text-[11px] leading-tight" style={{ color: "var(--fg-subtle)" }}>
          Admin Console
        </span>
      </span>
    </Link>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className="glass fixed inset-y-0 left-0 z-30 hidden w-[240px] flex-col lg:flex"
        style={{ borderRadius: 0, borderRight: "1px solid var(--panel-border)" }}
      >
        {brand}
        {navList}
        <div className="px-4 py-3 text-[11px]" style={{ color: "var(--fg-subtle)", borderTop: "1px solid var(--panel-border)" }}>
          Organic Bank of America · test tenant
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setMobileOpen(false)} />
          <aside className="glass animate-rise absolute inset-y-0 left-0 flex w-[240px] flex-col" style={{ borderRadius: 0 }}>
            {brand}
            {navList}
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-[240px]">
        {/* Top bar */}
        <header
          className="glass sticky top-0 z-20 flex items-center justify-between gap-3 px-4 py-3 sm:px-6"
          style={{ borderRadius: 0, borderBottom: "1px solid var(--panel-border)" }}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="ring-accent flex h-9 w-9 items-center justify-center rounded-lg lg:hidden"
              style={{ color: "var(--fg-muted)" }}
            >
              ☰
            </button>
            <span className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--fg-muted)" }}>
              <span aria-hidden>{current?.icon}</span>
              {current?.label ?? "Home"}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <span
              className="hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex"
              style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)", color: "var(--fg-muted)" }}
            >
              🔍 Quick search
            </span>
            <ThemeToggle />
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ background: "linear-gradient(135deg, #6366f1, #a855f7)" }}
              title="anderson@landjourney.ai"
            >
              AW
            </span>
          </div>
        </header>

        <main className="animate-rise mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
