"use client";

import { useState } from "react";
import { parseInstruction } from "@/lib/nlParser";
import { WorkflowRule } from "@/lib/vocabulary";

interface ChatBoxProps {
  onDraft: (rule: WorkflowRule) => void;
}

const EXAMPLES = [
  "If there is a system error and booking status is Error, assign to Wael",
  "When a loan is approved and loan amount is at least 250k, assign to Underwriting Team",
  "When a Fiserv loan booking status is Error, notify Booking Team and add tag booking-failed",
  "When a loan is rejected, change stage to Closed",
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
    <div className="glass rounded-2xl p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-lg text-sm"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          aria-hidden
        >
          ✦
        </span>
        <h3 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
          Draft with plain English
        </h3>
      </div>

      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              run(input);
            }
          }}
          rows={2}
          placeholder="e.g. If there is a system error and booking status is Error, assign to Wael"
          className="ring-accent scroll-thin w-full resize-none rounded-xl px-3 py-2 text-sm"
          style={{
            background: "var(--panel-solid)",
            border: "1px solid var(--panel-border)",
            color: "var(--fg)",
          }}
        />
        <button
          type="button"
          onClick={() => run(input)}
          disabled={!input.trim()}
          className="ring-accent shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          Draft →
        </button>
      </div>

      {notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs" style={{ color: "var(--fg-muted)" }}>
          {notes.map((n, i) => (
            <li key={i} className="flex gap-1.5">
              <span style={{ color: "var(--accent)" }}>·</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setInput(ex);
              run(ex);
            }}
            className="ring-accent rounded-full px-2.5 py-1 text-[11px] transition-colors hover:bg-[var(--accent-soft)]"
            style={{ border: "1px solid var(--panel-border)", color: "var(--fg-muted)" }}
          >
            {ex.length > 42 ? ex.slice(0, 42) + "…" : ex}
          </button>
        ))}
      </div>
    </div>
  );
}
