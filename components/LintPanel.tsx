"use client";

import { CircleCheck } from "lucide-react";
import { RuleIssue } from "@/lib/ruleLinter";

/**
 * Linter dashboard (Phase 4 §4): renders the semantic lint issues below the
 * rule builder. Errors are blocking (they also disable Save); warnings are
 * advisory. A clean rule shows a quiet all-clear.
 */
export default function LintPanel({ issues, className }: { issues: RuleIssue[]; className?: string }) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  if (issues.length === 0) {
    return (
      <div
        className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs ${className ?? ""}`}
        style={{ background: "var(--tok-if-bg)", color: "var(--tok-if-fg)" }}
      >
        <CircleCheck size={14} strokeWidth={2} aria-hidden />
        <span>No lint issues — this rule looks sound.</span>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${className ?? ""}`} style={{ borderColor: "var(--panel-border)" }}>
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--panel-border)" }}>
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--fg-subtle)" }}>
          Linter
        </span>
        {errors.length > 0 && (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
            {errors.length} blocking
          </span>
        )}
        {warnings.length > 0 && (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}>
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <ul className="flex flex-col divide-y" style={{ borderColor: "var(--panel-border)" }}>
        {[...errors, ...warnings].map((issue, i) => {
          const isError = issue.severity === "error";
          return (
            <li key={`${issue.code}-${i}`} className="flex items-start gap-2 px-3 py-2 text-xs" style={{ borderColor: "var(--panel-border)" }}>
              <span
                className="mt-px shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase leading-tight"
                style={
                  isError
                    ? { background: "var(--danger-bg)", color: "var(--danger-fg)" }
                    : { background: "var(--warn-bg)", color: "var(--warn-fg)" }
                }
              >
                {isError ? "error" : "warn"}
              </span>
              <span className="min-w-0">
                <span className="font-mono text-[10px]" style={{ color: "var(--fg-subtle)" }}>{issue.code}</span>
                <span className="mx-1" style={{ color: "var(--fg-subtle)" }}>·</span>
                <span style={{ color: "var(--fg)" }}>{issue.message}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
