"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { ScopeRef } from "@sweet/rule-core";
import VocabIcon from "@/components/ui/VocabIcon";

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

/** Two-step scoped sections (Phase 2 §4.3): Any / By type / Specific. */
export interface ScopedOptions {
  /** Category chips ("By type"). value = category name. */
  categories: PickerOption[];
  /** Instance list ("Specific"). value = platform instance id. */
  instances: PickerOption[];
  /** Shown when the instance level ships disabled (no live endpoint yet). */
  instancesDisabledHint?: string;
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
  /** Author-time validation for free-text values: return an error string to block (C5). */
  validate?: (value: string) => string | null;
  /** Scoped sections; requires onSelectScope. Plain options render under "Specific"
   *  as legacy free-text fallbacks when no live instances exist. */
  scoped?: ScopedOptions;
  onSelect: (value: string) => void;
  /** Structured selection for scoped pickers (Any / By type / live Specific). */
  onSelectScope?: (ref: ScopeRef) => void;
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
  validate,
  scoped,
  onSelect,
  onSelectScope,
  onClose,
}: TokenPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);

  if (process.env.NODE_ENV !== "production" && scoped && !onSelectScope) {
    // eslint-disable-next-line no-console
    console.warn("TokenPicker: `scoped` requires an `onSelectScope` callback.");
  }

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

  const q = query.toLowerCase();
  const filtered = query ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const liveInstances = scoped?.instances ?? [];
  const filteredInstances = query ? liveInstances.filter((o) => o.label.toLowerCase().includes(q)) : liveInstances;
  const grouped = options.some((o) => o.group);
  const showSearch = freeText || options.length > 6 || liveInstances.length > 6;
  // C5: block invalid free-text at author time — never save a value that can't match.
  const validationError = freeText && query.trim() && validate ? validate(query.trim()) : null;

  // Preserve group order as first-seen.
  const groupOrder: string[] = [];
  for (const o of filtered) {
    const g = o.group ?? "";
    if (!groupOrder.includes(g)) groupOrder.push(g);
  }

  function sectionHeader(text: string) {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: "var(--fg-subtle)" }}
      >
        {text}
      </div>
    );
  }

  function renderOption(o: PickerOption, pick?: () => void) {
    const selected = o.value === value;
    return (
      <button
        key={o.value}
        type="button"
        onClick={pick ?? (() => onSelect(o.value))}
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
          {selected && <Check size={13} strokeWidth={2.5} style={{ color: "var(--accent)" }} />}
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
              if (e.key === "Enter" && freeText && query.trim() && !validationError) {
                onSelect(query.trim());
              }
            }}
            className="ring-accent w-full rounded-lg px-2.5 py-1.5 text-sm"
            style={{
              background: "var(--panel-solid)",
              border: `1px solid ${validationError ? "var(--danger-fg)" : "var(--panel-border)"}`,
              color: "var(--fg)",
            }}
          />
          {validationError && (
            <p className="mt-1 px-1 text-[11px]" style={{ color: "var(--danger-fg)" }} role="alert">
              {validationError}
            </p>
          )}
        </div>
      )}

      {freeText && query.trim() && !validationError && !filtered.some((o) => o.label.toLowerCase() === query.toLowerCase()) && (
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

      {/* Scoped sections: Any / By type / Specific (Phase 2 §4.3) */}
      {scoped && onSelectScope && (
        <>
          {sectionHeader("Any")}
          <button
            type="button"
            onClick={() => onSelectScope({ level: "any" })}
            className="mb-0.5 flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--accent-soft)]"
            style={{ color: "var(--fg)" }}
          >
            Any {title.toLowerCase()}
          </button>

          {scoped.categories.length > 0 && (
            <>
              {sectionHeader("By type")}
              <div className="flex flex-wrap gap-1.5 px-2 pb-1.5">
                {scoped.categories.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.hint}
                    onClick={() => onSelectScope({ level: "category", category: c.value })}
                    className="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--accent-soft)]"
                    style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}
                  >
                    {c.label}
                    {c.confidence === "unconfirmed" && (
                      <span className="ml-1 text-[9px] font-bold" style={{ color: "var(--warn-fg)" }} title="Unconfirmed against the live platform">?</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {sectionHeader("Specific")}
          {filteredInstances.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {filteredInstances.map((o) =>
                renderOption(o, () => onSelectScope({ level: "instance", id: o.value, label: o.label }))
              )}
            </div>
          ) : scoped.instancesDisabledHint ? (
            <p className="px-2.5 pb-2 text-[11px]" style={{ color: "var(--fg-subtle)" }}>
              {scoped.instancesDisabledHint}
            </p>
          ) : liveInstances.length > 0 ? (
            <p className="px-2.5 pb-2 text-[11px]" style={{ color: "var(--fg-subtle)" }}>No matches.</p>
          ) : (
            // Static mode: no platform ids — fall through to the plain option
            // list below, which emits legacy strings (never fabricated ids).
            <p className="px-2.5 pb-1 text-[11px]" style={{ color: "var(--fg-subtle)" }}>
              Demo values (no platform IDs) — picks save as plain text:
            </p>
          )}
        </>
      )}

      {/* Plain options — hidden when live instances already fill "Specific". */}
      {!(scoped && filteredInstances.length > 0) &&
        (grouped ? (
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
                      {icon && <VocabIcon name={icon} size={12} />}
                      {g}
                    </div>
                    <div className="flex flex-col gap-0.5">{opts.map((o) => renderOption(o))}</div>
                  </div>
                );
              })}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">{filtered.map((o) => renderOption(o))}</div>
        ))}

      {filtered.length === 0 && filteredInstances.length === 0 && !freeText && !scoped && (
        <div className="px-2.5 py-3 text-sm" style={{ color: "var(--fg-subtle)" }}>
          No matches.
        </div>
      )}
    </div>
  );
}
