"use client";

import { useState } from "react";
import { parseInstruction } from "@/lib/nlParser";
import { WorkflowRule } from "@/lib/vocabulary";

interface ChatBoxProps {
  onDraft: (rule: WorkflowRule) => void;
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
export default function ChatBox({ onDraft }: ChatBoxProps) {
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<string[]>([]);

  function run(text: string) {
    const result = parseInstruction(text);
    setNotes(result.notes);
    if (result.rule) onDraft(result.rule);
  }

  return (
    <div>
      {/* Prominent command-center input bar */}
      <div className="command-bar flex items-end gap-3 rounded-2xl px-6 py-4">
        <span
          className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          aria-hidden
        >
          ✦
        </span>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              run(input);
            }
          }}
          rows={1}
          aria-label="Describe a workflow in plain English"
          placeholder="Describe a workflow… e.g. when booking status is Error, assign to Wael"
          className="scroll-thin w-full resize-none bg-transparent py-2 text-lg leading-relaxed outline-none placeholder:text-[var(--fg-subtle)]"
          style={{ color: "var(--fg)" }}
        />
        <button
          type="button"
          onClick={() => run(input)}
          disabled={!input.trim()}
          className="ring-accent mb-0.5 shrink-0 rounded-xl px-6 py-3 text-base font-semibold text-white shadow-md transition-all duration-150 hover:brightness-110 disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          Draft →
        </button>
      </div>

      {notes.length > 0 && (
        <ul className="mt-3 space-y-1 px-1 text-xs" style={{ color: "var(--fg-muted)" }}>
          {notes.map((n, i) => (
            <li key={i} className="flex gap-1.5">
              <span style={{ color: "var(--accent)" }}>·</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Sleek minimal quick-prompt pills */}
      <div className="mt-3 flex flex-wrap gap-1.5 px-1">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => {
              setInput(ex.text);
              run(ex.text);
            }}
            className="ring-accent rounded-full px-3 py-1 text-xs font-medium transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            style={{ border: "1px solid var(--panel-border)", color: "var(--fg-muted)" }}
          >
            {ex.label}
          </button>
        ))}
      </div>
    </div>
  );
}
