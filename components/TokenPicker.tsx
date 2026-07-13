"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface PickerOption {
  value: string;
  label: string;
  confidence?: "verified" | "unconfirmed";
  hint?: string;
  /** Optional category header the option is grouped under. */
  group?: string;
  /** Optional leading icon for the group (shown once per group). */
  groupIcon?: string;
}

interface TokenPickerProps {
  anchor: HTMLElement | null;
  title: string;
  options: PickerOption[];
  value?: string;
  freeText?: boolean;
  freeTextPlaceholder?: string;
  /** Restrict the free-text input to digits (numeric fields). */
  numeric?: boolean;
  onSelect: (value: string) => void;
  onClose: () => void;
}

export default function TokenPicker({
  anchor,
  title,
  options,
  value,
  freeText = false,
  freeTextPlaceholder = "Type a value…",
  numeric = false,
  onSelect,
  onClose,
}: TokenPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = 288;
    let left = r.left;
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
    const below = window.innerHeight - r.bottom - 16;
    setPos({ top: r.bottom + 8, left, maxH: Math.min(380, Math.max(220, below)) });
  }, [anchor]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node) && e.target !== anchor) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  if (!pos) return null;

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;
  const grouped = options.some((o) => o.group);
  const showSearch = freeText || options.length > 6;

  // Preserve group order as first-seen.
  const groupOrder: string[] = [];
  for (const o of filtered) {
    const g = o.group ?? "";
    if (!groupOrder.includes(g)) groupOrder.push(g);
  }

  function renderOption(o: PickerOption) {
    const selected = o.value === value;
    return (
      <button
        key={o.value}
        type="button"
        onClick={() => onSelect(o.value)}
        title={o.hint}
        className="group flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors"
        style={{ background: selected ? "var(--accent-soft)" : "transparent", color: "var(--fg)" }}
        onMouseEnter={(e) => {
          if (!selected) e.currentTarget.style.background = "var(--accent-soft)";
        }}
        onMouseLeave={(e) => {
          if (!selected) e.currentTarget.style.background = "transparent";
        }}
      >
        <span className="min-w-0 truncate">{o.label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {o.confidence === "unconfirmed" && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: "var(--warn-bg)", color: "var(--warn-fg)", border: "1px solid var(--warn-br)" }}
              title="Not confirmed against the live platform — may not execute."
            >
              unconfirmed
            </span>
          )}
          {selected && <span style={{ color: "var(--accent)" }}>✓</span>}
        </span>
      </button>
    );
  }

  return (
    <div
      ref={ref}
      className="glass animate-popin scroll-thin fixed z-50 w-[288px] overflow-y-auto rounded-2xl p-1.5"
      style={{ top: pos.top, left: pos.left, maxHeight: pos.maxH }}
      role="dialog"
      aria-label={title}
    >
      <div
        className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--fg-subtle)" }}
      >
        {title}
      </div>

      {showSearch && (
        <div className="sticky top-0 z-10 px-1 pb-1.5" style={{ background: "var(--panel)" }}>
          <input
            autoFocus
            value={query}
            onChange={(e) =>
              setQuery(numeric ? e.target.value.replace(/[^\d.,]/g, "") : e.target.value)
            }
            inputMode={numeric ? "numeric" : "text"}
            placeholder={freeText ? freeTextPlaceholder : "Search…"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && freeText && query.trim()) onSelect(query.trim());
            }}
            className="ring-accent w-full rounded-lg px-2.5 py-1.5 text-sm"
            style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)", color: "var(--fg)" }}
          />
        </div>
      )}

      {freeText && query.trim() && !filtered.some((o) => o.label.toLowerCase() === query.toLowerCase()) && (
        <button
          type="button"
          onClick={() => onSelect(query.trim())}
          className="mb-0.5 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--accent-soft)]"
          style={{ color: "var(--fg)" }}
        >
          <span>
            Use “<span className="font-medium">{query.trim()}</span>”
          </span>
          <span className="text-[11px]" style={{ color: "var(--fg-subtle)" }}>
            {numeric ? "amount" : "custom"}
          </span>
        </button>
      )}

      {grouped ? (
        <div className="flex flex-col gap-1">
          {groupOrder
            .filter((g) => g !== "")
            .map((g) => {
              const opts = filtered.filter((o) => (o.group ?? "") === g);
              if (!opts.length) return null;
              const icon = opts[0].groupIcon;
              return (
                <div key={g}>
                  <div
                    className="flex items-center gap-1.5 px-2.5 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: "var(--fg-subtle)" }}
                  >
                    {icon && <span aria-hidden>{icon}</span>}
                    {g}
                  </div>
                  <div className="flex flex-col gap-0.5">{opts.map(renderOption)}</div>
                </div>
              );
            })}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">{filtered.map(renderOption)}</div>
      )}

      {filtered.length === 0 && !freeText && (
        <div className="px-2.5 py-3 text-sm" style={{ color: "var(--fg-subtle)" }}>
          No matches.
        </div>
      )}
    </div>
  );
}
