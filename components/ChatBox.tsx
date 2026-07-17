"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { AlertTriangle, ArrowDown, ArrowRight, Filter, Play, Zap } from "lucide-react";
import { ParseAmbiguity, ParseOptions, UnresolvedSlot } from "@sweet/rule-core";
import {
  WorkflowRule,
  getEvent,
  getAction,
  opLabel,
  paramKeyFor,
  condFieldLabel,
  condFieldKind,
  isValuelessOperator,
  scopeLabel,
  isGroup,
  walkLeaves,
} from "@sweet/rule-core";
import { loadLiveVocabulary, buildOverlay, type VocabOverlay } from "@/lib/liveVocabulary";
import {
  applyCompletion,
  buildCandidates,
  suggestCompletions,
  type AutocompleteMatch,
} from "@/lib/autocomplete";

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
  // Last drafted rule, rendered as a Trigger → Condition → Action flowchart card.
  const [draft, setDraft] = useState<WorkflowRule | null>(null);

  // Real-time Autocomplete States
  const [vocab, setVocab] = useState<VocabOverlay | null>(null);
  const [autocomplete, setAutocomplete] = useState<AutocompleteMatch[]>([]);
  const [activeSelectionIndex, setActiveSelectionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const refreshVocab = () => {
      loadLiveVocabulary().then((liveSource) => {
        const overlay = buildOverlay(liveSource);
        setVocab(overlay);
      });
    };
    refreshVocab();
    window.addEventListener("wf-custom-vocab-sync", refreshVocab);
    return () => {
      window.removeEventListener("wf-custom-vocab-sync", refreshVocab);
    };
  }, []);

  // Rebuilt only when the live vocabulary overlay changes, not per keystroke.
  const candidates = useMemo(() => buildCandidates(vocab), [vocab]);

  function handleInputChange(text: string) {
    setInput(text);
    setAutocomplete(text.trim() ? suggestCompletions(text, candidates) : []);
    setActiveSelectionIndex(0);
  }

  /** Each match carries the window it matched on, so accepting swaps exactly
   *  those 1–3 words — no re-deriving the window from the finished string. */
  function acceptSuggestion(match: AutocompleteMatch) {
    setInput(applyCompletion(input, match));
    setAutocomplete([]);
    textareaRef.current?.focus();
  }

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
        setDraft(data.rule);
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

      {/* Suggestion refinement chips — clicking APPENDS the refinement to the
          current instruction and re-parses instantly (spec §2). */}
      {suggestions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 justify-center animate-fade-in">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                const base = (input.trim() || lastText).replace(/[.?!\s]+$/, "");
                const refinement = s.replace(/\?+$/, "");
                const appended = base ? `${base}, and ${refinement.charAt(0).toLowerCase()}${refinement.slice(1)}` : refinement;
                setInput(appended);
                run(appended);
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
          ref={textareaRef}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (autocomplete.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveSelectionIndex((prev) => (prev + 1) % autocomplete.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveSelectionIndex((prev) => (prev - 1 + autocomplete.length) % autocomplete.length);
              } else if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                acceptSuggestion(autocomplete[activeSelectionIndex]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setAutocomplete([]);
              }
            } else if (e.key === "Enter" && !e.shiftKey) {
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
        {autocomplete.length > 0 && (
          <div
            className="absolute left-6 right-6 top-full mt-2 rounded-2xl p-1.5 z-50 shadow-xl flex flex-col gap-0.5"
            style={{ background: "var(--panel-solid)", border: "none", boxShadow: "0 10px 30px rgba(0, 0, 0, 0.15)" }}
          >
            {autocomplete.map((match, idx) => {
              const active = idx === activeSelectionIndex;
              return (
                <div
                  key={match.value}
                  onClick={() => acceptSuggestion(match)}
                  onMouseEnter={() => setActiveSelectionIndex(idx)}
                  className="flex items-center justify-between px-3 py-1.5 text-xs font-semibold rounded-xl cursor-pointer transition-colors"
                  style={{
                    background: active ? "var(--accent-soft)" : "transparent",
                    color: active ? "var(--accent)" : "var(--fg)",
                  }}
                >
                  <span>{match.value}</span>
                  {active && (
                    <span className="text-[9px] uppercase tracking-wider opacity-60">
                      Press Tab/Enter to autocomplete
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
          <AlertTriangle size={15} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
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

      {/* Drafted rule as a clean Trigger → Condition → Action flowchart card. */}
      {draft && <FlowchartCard rule={draft} notes={notes} />}

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

/* -------------------------------------------------------------------------- */
/* Flowchart card — the drafted rule as Trigger → Condition → Action.         */
/* -------------------------------------------------------------------------- */

function triggerText(rule: WorkflowRule): string {
  const labels = rule.triggers.map((t) => getEvent(t.event)?.label ?? t.event);
  return labels.length ? labels.join(" or ") : "Any event";
}

function leafText(c: ReturnType<typeof walkLeaves>[number]): string {
  const label = condFieldLabel(c.field);
  const op = opLabel(condFieldKind(c.field), c.operator);
  if (isValuelessOperator(c.operator)) return `${label} ${op}`;
  return `${label} ${op} ${scopeLabel(c.value) || "…"}`;
}

function conditionLines(rule: WorkflowRule): string[] {
  if (!rule.conditions.children.length) return [];
  return rule.conditions.children.map((child) =>
    isGroup(child) ? `(${walkLeaves(child).map(leafText).join(` ${child.logic.toLowerCase()} `)})` : leafText(child)
  );
}

function actionLines(rule: WorkflowRule): string[] {
  return rule.actions.map((o) => {
    const action = getAction(o.action);
    const label = action?.label ?? o.action;
    if (action?.paramKind === "none") return label;
    return `${label} ${scopeLabel(o.params[paramKeyFor(o.action)]) || "…"}`;
  });
}

function FlowchartCard({ rule, notes }: { rule: WorkflowRule; notes: string[] }) {
  const conditions = conditionLines(rule);
  const actions = actionLines(rule);
  const armed = rule.controls?.mode === "armed";

  const nodes: {
    stage: string;
    Icon: typeof Zap;
    tone: { bg: string; fg: string; br: string };
    lines: string[];
    empty: string;
  }[] = [
    {
      stage: "When",
      Icon: Zap,
      tone: { bg: "var(--tok-when-bg)", fg: "var(--tok-when-fg)", br: "var(--tok-when-br)" },
      lines: [triggerText(rule)],
      empty: "Any event",
    },
    {
      stage: "If",
      Icon: Filter,
      tone: { bg: "var(--tok-if-bg)", fg: "var(--tok-if-fg)", br: "var(--tok-if-br)" },
      lines: conditions,
      empty: "No conditions — always",
    },
    {
      stage: "Then",
      Icon: Play,
      tone: { bg: "var(--tok-then-bg)", fg: "var(--tok-then-fg)", br: "var(--tok-then-br)" },
      lines: actions,
      empty: armed ? "Add an action" : "Observing (shadow)",
    },
  ];

  return (
    <div
      className="animate-fade-in mt-4 rounded-2xl border p-4"
      style={{ borderColor: "var(--panel-border)", background: "var(--panel-solid)" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--fg-subtle)" }}>
          Drafted flow
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
          style={
            armed
              ? { background: "var(--tok-then-bg)", color: "var(--tok-then-fg)" }
              : { background: "var(--tok-op-bg)", color: "var(--fg-subtle)" }
          }
        >
          {armed ? "armed" : "shadow"}
        </span>
      </div>

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-stretch">
        {nodes.map((node, i) => (
          <div key={node.stage} className="flex flex-col items-stretch sm:flex-1 sm:flex-row sm:items-center">
            <div
              className="flex-1 rounded-xl border p-3"
              style={{ background: node.tone.bg, borderColor: node.tone.br }}
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <node.Icon size={14} strokeWidth={2.25} style={{ color: node.tone.fg }} />
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: node.tone.fg }}>
                  {node.stage}
                </span>
              </div>
              {node.lines.length ? (
                <ul className="space-y-0.5">
                  {node.lines.map((line, j) => (
                    <li key={j} className="text-xs font-medium leading-snug" style={{ color: "var(--fg)" }}>
                      {line}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs italic" style={{ color: "var(--fg-subtle)" }}>
                  {node.empty}
                </p>
              )}
            </div>
            {i < nodes.length - 1 && (
              <span className="flex shrink-0 items-center justify-center py-1 sm:px-1.5 sm:py-0" style={{ color: "var(--fg-subtle)" }}>
                <ArrowDown size={16} strokeWidth={2} className="sm:hidden" />
                <ArrowRight size={16} strokeWidth={2} className="hidden sm:block" />
              </span>
            )}
          </div>
        ))}
      </div>

      {notes.length > 0 && (
        <p className="mt-3 border-t pt-2.5 text-[11px]" style={{ borderColor: "var(--panel-border)", color: "var(--fg-subtle)" }}>
          {notes.join(" · ")}
        </p>
      )}
    </div>
  );
}
