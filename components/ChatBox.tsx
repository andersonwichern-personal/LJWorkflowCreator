"use client";

import { useState } from "react";
import { ParseAmbiguity, ParseOptions, UnresolvedSlot } from "@/lib/nlParser";
import { WorkflowRule } from "@/lib/vocabulary";

export interface ChatDraftMeta {
  unresolved: UnresolvedSlot[];
  uncovered: string[];
}

interface ChatBoxProps {
  onDraft: (rule: WorkflowRule, meta: ChatDraftMeta) => void;
  parserOptions?: Omit<ParseOptions, "forceEvent">;
}

const EXAMPLES: { label: string; text: string }[] = [
  { label: "System error → assign Wael", text: "If there is a system error and booking status is Error, assign to Wael" },
  { label: "Loan ≥ 250k → Underwriting", text: "When a loan is approved and loan amount is at least 250k, assign to Underwriting Team" },
  { label: "Booking error → notify + tag", text: "When a Fiserv loan booking status is Error, notify Booking Team and add tag booking-failed" },
  { label: "Rejected → close stage", text: "When a loan is rejected, change stage to Closed" },
];

export default function ChatBox({ onDraft }: ChatBoxProps) {
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [uncovered, setUncovered] = useState<string[]>([]);
  const [ambiguities, setAmbiguities] = useState<ParseAmbiguity[]>([]);
  const [lastText, setLastText] = useState("");
  const [engine, setEngine] = useState<"gemini" | "heuristic">("heuristic");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(text: string, forceEvent?: string) {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workflows/parse-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: text, forceEvent }),
      });
      if (!res.ok) throw new Error("Parsing failed");
      const data = await res.json();
      setLastText(text);
      setNotes(data.notes || []);
      setSuggestions(data.suggestions || []);
      setUncovered(data.uncovered || []);
      setAmbiguities(data.ambiguities || []);
      setEngine(data.engine || "heuristic");
      if (data.rule) {
        onDraft(data.rule, { unresolved: data.unresolved || [], uncovered: data.uncovered || [] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parsing error");
    } finally {
      setLoading(false);
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

      {/* Suggestion refinement chips */}
      {suggestions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 justify-center animate-fade-in">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setInput(s);
                run(s);
              }}
              className="ring-accent rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-150 hover:-translate-y-px hover:shadow-sm"
              style={{ background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent-soft)" }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Focal input pill */}
      <div className="command-bar flex items-center gap-3 rounded-full py-2.5 pl-6 pr-2.5 relative">
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
          disabled={loading}
          className="scroll-thin w-full resize-none bg-transparent py-2 text-base outline-none placeholder:text-[var(--fg-subtle)] sm:text-lg"
          style={{ color: "var(--fg)" }}
        />
        {loading && (
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-t-transparent mr-2" style={{ borderColor: "var(--accent)" }} />
        )}
        <button
          type="button"
          onClick={() => run(input)}
          disabled={!input.trim() || loading}
          aria-label="Draft workflow"
          className="ring-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all duration-150 hover:brightness-110 disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>

      {/* Engine and Status indicators */}
      <div className="mt-2 flex items-center justify-between px-4 text-xs">
        <div className="flex items-center gap-1.5 font-medium">
          {engine === "gemini" ? (
            <span
              className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"
              title="Smart context-aware Gemini LLM parsing is active"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              AI Engine: Gemini LLM
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 cursor-help"
              title="Add GEMINI_API_KEY to your .env.local file to enable dynamic LLM parsing."
            >
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              AI Engine: Heuristic Fallback
            </span>
          )}
        </div>
        {error && (
          <span className="text-red-500 font-medium">
            Error: {error}
          </span>
        )}
      </div>

      {/* N2: a partial parse must LOOK partial */}
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
