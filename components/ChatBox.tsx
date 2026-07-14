"use client";

import { useState } from "react";
import {
  parseInstruction,
  ParseAmbiguity,
  ParseOptions,
  UnresolvedSlot,
} from "@/lib/nlParser";
import { WorkflowRule } from "@/lib/vocabulary";

/** Parser honesty sidecar handed to the canvas along with the draft. */
export interface ChatDraftMeta {
  unresolved: UnresolvedSlot[];
  uncovered: string[];
}

interface ChatBoxProps {
  onDraft: (rule: WorkflowRule, meta: ChatDraftMeta) => void;
  /** Live option lists so the parser resolves against real vocabulary. */
  parserOptions?: Omit<ParseOptions, "forceEvent">;
}

/** Full instruction fed to the parser, plus a short pill label for the UI. */
const EXAMPLES: { label: string; text: string }[] = [
  { label: "System error → assign Wael", text: "If there is a system error and booking status is Error, assign to Wael" },
  { label: "Loan ≥ 250k → Underwriting", text: "When a loan is approved and loan amount is at least 250k, assign to Underwriting Team" },
  { label: "Booking error → notify + tag", text: "When a Fiserv loan booking status is Error, notify Booking Team and add tag booking-failed" },
  { label: "Rejected → close stage", text: "When a loan is rejected, change stage to Closed" },
];

/**
 * Plain-language input that drafts the same WHEN/IF/THEN rule object the token
 * builder edits. Deterministic parse (no LLM) so the demo path never surprises.
 */
export default function ChatBox({ onDraft, parserOptions }: ChatBoxProps) {
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [uncovered, setUncovered] = useState<string[]>([]);
  const [ambiguities, setAmbiguities] = useState<ParseAmbiguity[]>([]);
  const [lastText, setLastText] = useState("");

  function run(text: string, forceEvent?: string) {
    const result = parseInstruction(text, { ...parserOptions, forceEvent });
    setLastText(text);
    setNotes(result.notes);
    setUncovered(result.uncovered);
    setAmbiguities(result.ambiguities);
    if (result.rule) {
      onDraft(result.rule, { unresolved: result.unresolved, uncovered: result.uncovered });
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl py-6">
      {/* Greeting */}
      <h2
        className="mb-5 text-center text-2xl font-medium tracking-tight sm:text-3xl"
        style={{ color: "var(--fg)" }}
      >
        How can I help, Anderson?
      </h2>

      {/* Focal input pill */}
      <div className="command-bar flex items-center gap-3 rounded-full py-2.5 pl-6 pr-2.5">
        <span aria-hidden style={{ color: "var(--fg-subtle)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              run(input);
            }
          }}
          rows={1}
          aria-label="Describe your rule in plain English"
          placeholder="Describe your rule in plain English…"
          className="scroll-thin w-full resize-none bg-transparent py-2 text-base outline-none placeholder:text-[var(--fg-subtle)] sm:text-lg"
          style={{ color: "var(--fg)" }}
        />
        <span aria-hidden className="shrink-0" style={{ color: "var(--fg-subtle)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </span>
        <button
          type="button"
          onClick={() => run(input)}
          disabled={!input.trim()}
          aria-label="Draft workflow"
          className="ring-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all duration-150 hover:brightness-110 disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>

      {/* N2: a partial parse must LOOK partial — amber, prominent, per fragment */}
      {uncovered.map((frag, i) => (
        <div
          key={i}
          className="mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm"
          style={{ background: "var(--warn-bg)", color: "var(--warn-fg)", borderColor: "var(--warn-br)" }}
          role="alert"
        >
          <span aria-hidden>⚠</span>
          <span>
            I didn&apos;t understand: <span className="font-semibold">&quot;{frag}&quot;</span> — the
            drafted rule does <span className="font-bold">not</span> include this.
          </span>
        </div>
      ))}

      {/* N3: competing readings become a question, never a silent guess */}
      {ambiguities.map((amb, i) => (
        <div
          key={i}
          className="mt-3 rounded-xl border px-3 py-2.5"
          style={{ borderColor: "var(--panel-border)", background: "var(--panel-solid)" }}
        >
          <p className="mb-2 text-sm font-medium" style={{ color: "var(--fg)" }}>{amb.question}</p>
          <div className="flex flex-wrap gap-1.5">
            {amb.options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => run(lastText, opt)}
                className="ring-accent rounded-full border px-3 py-1 text-xs font-semibold transition-colors hover:bg-[var(--accent-soft)]"
                style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      ))}

      {notes.length > 0 && (
        <ul className="mt-3 space-y-1 px-2 text-xs" style={{ color: "var(--fg-muted)" }}>
          {notes.map((n, i) => (
            <li key={i} className="flex gap-1.5">
              <span style={{ color: "var(--accent)" }}>·</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Subtle template suggestions */}
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => {
              setInput(ex.text);
              run(ex.text);
            }}
            className="ring-accent rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            style={{ borderColor: "var(--panel-border)", color: "var(--fg-muted)" }}
          >
            {ex.label}
          </button>
        ))}
      </div>
    </section>
  );
}
