"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NAV } from "./nav";
import { REQUESTS, formatCurrency } from "@/lib/platformData";

interface Item {
  id: string;
  label: string;
  sub?: string;
  icon: string;
  href: string;
  group: string;
}

function buildItems(): Item[] {
  const nav: Item[] = NAV.map((n) => ({ id: "nav-" + n.href, label: n.label, icon: n.icon, href: n.href, group: "Go to" }));
  const reqs: Item[] = REQUESTS.map((r) => ({
    id: "req-" + r.id,
    label: r.name,
    sub: `${r.id} · ${formatCurrency(r.loanAmount)} · ${r.retailer}`,
    icon: "📄",
    href: `/requests/${r.id}`,
    group: "Requests",
  }));
  return [...nav, ...reqs];
}

/** Cmd/Ctrl-K command palette: jump to any section or request. */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const items = useMemo(buildItems, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => (i.label + " " + (i.sub ?? "")).toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  function go(href: string) {
    router.push(href);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" onMouseDown={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.4)" }} />
      <div
        className="glass animate-popin relative w-full max-w-[560px] overflow-hidden rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--panel-border)" }}>
          <span style={{ color: "var(--fg-subtle)" }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter" && filtered[active]) { e.preventDefault(); go(filtered[active].href); }
              else if (e.key === "Escape") onClose();
            }}
            placeholder="Search sections and requests…"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: "var(--fg)" }}
          />
          <kbd className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--tok-op-bg)", color: "var(--fg-subtle)" }}>esc</kbd>
        </div>

        <div className="scroll-thin max-h-[52vh] overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-sm" style={{ color: "var(--fg-subtle)" }}>No matches.</div>
          )}
          {filtered.map((i, idx) => (
            <button
              key={i.id}
              type="button"
              onMouseEnter={() => setActive(idx)}
              onClick={() => go(i.href)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
              style={{ background: idx === active ? "var(--accent-soft)" : "transparent" }}
            >
              <span className="text-base" aria-hidden>{i.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" style={{ color: "var(--fg)" }}>{i.label}</span>
                {i.sub && <span className="block truncate text-xs" style={{ color: "var(--fg-subtle)" }}>{i.sub}</span>}
              </span>
              <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--fg-subtle)" }}>{i.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
