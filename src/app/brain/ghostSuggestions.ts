/**
 * GENERATED from packages/workflow-brain/src/ghostSuggestions.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/workflow-brain contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * ghostSuggestions — the Brain's ghost-autowriting engine.
 *
 * Deterministic completion + suppression policy + ranking + staleness keying +
 * hostile-candidate validation for the inline ghost overlay. This is the
 * grounded SUPERSET of the UI-layer predictor (src/app/features/workflows/ui/
 * ghost-prediction.ts, commit d329223): where that engine hardcodes demo names
 * ("Wael", "Underwriting Team") in curated CLAUSE_RULES, this one composes the
 * same moves from the LIVE BrainContextSnapshot — entities that are not in the
 * snapshot are never suggested, and silence is a feature.
 *
 * Purity: no clock reads, no randomness, no host globals. Ids are djb2 content
 * hashes; expiry is generation-based, so nothing here needs time at all. The
 * full behavior contract lives in docs/ghost-autowriting-spec.md.
 */

import type { BrainContextSnapshot } from "./context";
import type { BrainTelemetrySink } from "./ports";
import { ACTIONS, EVENTS, FIELDS, OPERATORS } from "../core/vocabulary";

/* -------------------------------------------------------------------------- */
/* Contract types (frozen)                                                    */
/* -------------------------------------------------------------------------- */

export type GhostKind =
  | "clause-completion"
  | "grounded-entity"
  | "missing-outcome"
  | "exception-path"
  | "consultant-refinement";

export type GhostSource = "deterministic" | "ai";

export interface GhostRequestState {
  text: string;
  /** Selection: start !== end suppresses all ghosting. */
  cursorStart: number;
  cursorEnd: number;
  generation: number;
  ruleVersion: number;
  contextSnapshotId: string;
  imeComposing: boolean;
  /** Host capability, fail closed: false means the AI path never runs. */
  aiCapability: boolean;
  recentRateLimit: boolean;
  offline: boolean;
}

export interface GhostSuggestion {
  /** Content hash of (prefixHash, insertText, snapshotId, ruleVersion). */
  suggestionId: string;
  /** djb2 of text.slice(0, cursorStart). */
  prefixHash: string;
  contextSnapshotId: string;
  ruleVersion: number;
  generation: number;
  cursorStart: number;
  cursorEnd: number;
  /** What acceptance inserts at the caret — begins exactly where the prefix ends. */
  insertText: string;
  /** Usually === insertText. */
  displayText: string;
  kind: GhostKind;
  source: GhostSource;
  /** Safe refs only: registry/source ids, never customer content. */
  evidence: string[];
  /** generation + 1 — any edit invalidates. */
  expiresAtGeneration: number;
}

export interface GhostPolicyDecision {
  allow: boolean;
  reason:
    | "ok"
    | "too-short"
    | "ime"
    | "selection"
    | "cursor-not-at-end"
    | "offline"
    | "rate-limited"
    | "no-capability"
    | "deterministic-sufficient";
  useAi: boolean;
}

export const GHOST_MIN_PREFIX_CHARS = 8;
export const GHOST_MIN_PREFIX_WORDS = 2;

/** In-memory, generation-scoped dismissal memory (see makeGhostDismissals). */
export interface GhostDismissals {
  has(prefixHash: string, insertText: string): boolean;
  add(prefixHash: string, insertText: string, generation: number): void;
  /** Drop every dismissal recorded at a generation BELOW the given one. */
  clearBefore(generation: number): void;
}

/** The AI port — HOST provides the implementation; the candidate is UNTRUSTED. */
export interface GhostSuggestTransport {
  suggest(
    req: { prefix: string; contextSnapshotId: string; requestId: string },
    signal?: AbortSignal
  ): Promise<unknown>;
}

export type GhostTelemetryEvent =
  | "offered"
  | "accepted"
  | "partially-accepted"
  | "dismissed"
  | "stale-discarded"
  | "suppressed";

/* -------------------------------------------------------------------------- */
/* Deterministic hashing                                                      */
/* -------------------------------------------------------------------------- */

/** djb2 over UTF-16 code units, base36 — stable across runs, no crypto needed. */
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function buildSuggestion(
  state: GhostRequestState,
  insertText: string,
  kind: GhostKind,
  source: GhostSource,
  evidence: string[]
): GhostSuggestion {
  const prefixHash = djb2(state.text.slice(0, state.cursorStart));
  const suggestionId = djb2(
    [prefixHash, insertText, state.contextSnapshotId, String(state.ruleVersion)].join("\u0000")
  );
  return {
    suggestionId,
    prefixHash,
    contextSnapshotId: state.contextSnapshotId,
    ruleVersion: state.ruleVersion,
    generation: state.generation,
    cursorStart: state.cursorStart,
    cursorEnd: state.cursorEnd,
    insertText,
    displayText: insertText,
    kind,
    source,
    evidence,
    expiresAtGeneration: state.generation + 1,
  };
}

/* -------------------------------------------------------------------------- */
/* Vocabulary derivations (static, public-vocabulary tier)                    */
/* -------------------------------------------------------------------------- */

interface BankEntry {
  phrase: string;
  kind: GhostKind;
  evidence: string;
}

/** Small connective set — clause glue the vocabulary cannot spell. */
const CONNECTIVES = ["assign to", "notify", "otherwise", "and", "if"];

/** Lowercased word tokens (len >= 4) drawn from event labels/aliases. */
const EVENT_TOKENS: readonly string[] = (() => {
  const out = new Set<string>();
  for (const event of EVENTS) {
    for (const source of [event.label, ...(event.aliases ?? [])]) {
      for (const token of source.toLowerCase().split(/[^a-z0-9]+/)) {
        if (token.length >= 4) out.add(token);
      }
    }
  }
  return [...out].sort();
})();
const EVENT_TOKEN_SET = new Set(EVENT_TOKENS);

/** Substrings whose presence means an action/outcome is already stated. */
const ACTION_MARKERS: readonly string[] = (() => {
  const out = new Set<string>(["assigned to", "notif"]);
  for (const action of ACTIONS) {
    out.add(action.label.toLowerCase());
    for (const alias of action.aliases ?? []) {
      const head = alias.split("{param}")[0].trim().toLowerCase();
      if (head.length >= 4) out.add(head);
    }
  }
  return [...out].sort();
})();

/** Multi-word operator labels = condition evidence ("is at least", "is below"…). */
const MULTI_WORD_OPERATOR_LABELS: readonly string[] = (() => {
  const out = new Set<string>();
  for (const ops of Object.values(OPERATORS)) {
    for (const op of ops) {
      const label = op.label.toLowerCase();
      if (label.includes(" ")) out.add(label);
    }
  }
  return [...out].sort();
})();

/** Static phrase-bank tier: canonical vocabulary labels, never tenant data. */
const STATIC_BANK: readonly BankEntry[] = (() => {
  const out: BankEntry[] = [];
  for (const field of Object.values(FIELDS)) {
    out.push({ phrase: field.label, kind: "clause-completion", evidence: "vocabulary:fields" });
  }
  for (const ops of Object.values(OPERATORS)) {
    for (const op of ops) {
      out.push({ phrase: op.label, kind: "clause-completion", evidence: "vocabulary:operators" });
    }
  }
  for (const action of ACTIONS) {
    out.push({ phrase: action.label, kind: "clause-completion", evidence: "vocabulary:actions" });
    for (const alias of action.aliases ?? []) {
      const head = alias.split("{param}")[0].trim();
      if (head.length >= 4) {
        out.push({ phrase: head, kind: "clause-completion", evidence: "vocabulary:actions" });
      }
    }
  }
  for (const event of EVENTS) {
    out.push({
      phrase: event.label.toLowerCase(),
      kind: "clause-completion",
      evidence: "vocabulary:events",
    });
    for (const alias of event.aliases ?? []) {
      out.push({ phrase: alias.toLowerCase(), kind: "clause-completion", evidence: "vocabulary:events" });
    }
  }
  for (const token of EVENT_TOKENS) {
    out.push({ phrase: token, kind: "clause-completion", evidence: "vocabulary:events" });
  }
  for (const connective of CONNECTIVES) {
    out.push({ phrase: connective, kind: "clause-completion", evidence: "connective" });
  }
  return out;
})();

/* -------------------------------------------------------------------------- */
/* Snapshot-derived phrase bank (grounded tier)                               */
/* -------------------------------------------------------------------------- */

/** Grounded entity labels from the snapshot — the ONLY source of entity text. */
function snapshotBank(snapshot: BrainContextSnapshot): BankEntry[] {
  const out: BankEntry[] = [];
  for (const assignee of snapshot.assignees) {
    out.push({ phrase: assignee, kind: "grounded-entity", evidence: "snapshot:assignees" });
  }
  for (const key of Object.keys(snapshot.instanceOptions).sort()) {
    for (const option of snapshot.instanceOptions[key]) {
      out.push({ phrase: option, kind: "grounded-entity", evidence: `options:${key}` });
    }
  }
  for (const key of Object.keys(snapshot.instanceRegistry).sort()) {
    for (const entry of snapshot.instanceRegistry[key]) {
      out.push({ phrase: entry.label, kind: "grounded-entity", evidence: `registry:${key}:${entry.id}` });
    }
  }
  return out;
}

/** Snapshot entries first (they win dedupe), then static vocabulary + connectives. */
function buildBank(snapshot: BrainContextSnapshot): BankEntry[] {
  const seen = new Set<string>();
  const out: BankEntry[] = [];
  for (const entry of [...snapshotBank(snapshot), ...STATIC_BANK]) {
    if (!entry.phrase) continue;
    const key = entry.phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** Total deterministic order for bank candidates: lexicographic, then evidence. */
function bankOrder(a: BankEntry, b: BankEntry): number {
  const al = a.phrase.toLowerCase();
  const bl = b.phrase.toLowerCase();
  if (al !== bl) return al < bl ? -1 : 1;
  if (a.phrase !== b.phrase) return a.phrase < b.phrase ? -1 : 1;
  return a.evidence < b.evidence ? -1 : a.evidence > b.evidence ? 1 : 0;
}

/* -------------------------------------------------------------------------- */
/* Deterministic completion engine                                            */
/* -------------------------------------------------------------------------- */

/** "assign to Wa" / "notify Om" — a verb that expects a grounded entity argument. */
const ENTITY_ARGUMENT_RE = /\b(?:assign(?:ed)?\s+to|notify)\s+([^\s,][^,]*)$/i;

interface Completion {
  insertText: string;
  kind: GhostKind;
  evidence: string[];
}

/** Complete a partial entity after assign/notify against the snapshot only. */
function completeEntityArgument(prefix: string, snapshot: BrainContextSnapshot): Completion | null {
  const match = ENTITY_ARGUMENT_RE.exec(prefix);
  if (!match) return null;
  const partial = match[1];
  if (partial.length < 2) return null;
  const partialLower = partial.toLowerCase();
  let best: BankEntry | null = null;
  for (const entry of snapshotBank(snapshot)) {
    if (entry.phrase.length <= partial.length) continue;
    if (!entry.phrase.toLowerCase().startsWith(partialLower)) continue;
    if (best === null || bankOrder(entry, best) < 0) best = entry;
  }
  if (best === null) return null;
  return {
    insertText: best.phrase.slice(partial.length),
    kind: "grounded-entity",
    evidence: [best.evidence],
  };
}

/**
 * Longest-match word completion: trailing windows of 4 → 1 words (window must
 * be >= 3 chars), first window with a bank hit wins; among hits the
 * lexicographically smallest phrase wins. The remainder carries the phrase's
 * own casing — the typed prefix keeps the author's.
 */
function completeWindow(prefix: string, bank: BankEntry[]): Completion | null {
  for (let words = 4; words >= 1; words--) {
    const span = new RegExp(`(\\S+(?:\\s+\\S+){${words - 1}})$`).exec(prefix)?.[1];
    if (!span || span.length < 3) continue;
    const spanLower = span.toLowerCase();
    let best: BankEntry | null = null;
    for (const entry of bank) {
      if (entry.phrase.length <= span.length) continue;
      if (!entry.phrase.toLowerCase().startsWith(spanLower)) continue;
      if (best === null || bankOrder(entry, best) < 0) best = entry;
    }
    if (best !== null) {
      return {
        insertText: best.phrase.slice(span.length),
        kind: best.kind,
        evidence: [best.evidence],
      };
    }
  }
  return null;
}

/** How a suggested clause joins the prefix: after a word, a comma, or "comma space". */
function clauseJoint(prefix: string): string | null {
  if (/,\s+$/.test(prefix)) return "";
  if (/,$/.test(prefix)) return " ";
  if (/[a-z0-9)]$/i.test(prefix)) return ", ";
  return null;
}

function hasActionEvidence(lower: string): boolean {
  return ACTION_MARKERS.some((marker) => lower.includes(marker));
}

function hasConditionEvidence(lower: string): boolean {
  if (/(^|[^a-z])(if|unless)([^a-z]|$)/.test(lower)) return true;
  return MULTI_WORD_OPERATOR_LABELS.some((label) => lower.includes(label));
}

function hasEventEvidence(lower: string): boolean {
  for (const token of lower.split(/[^a-z0-9'-]+/)) {
    if (EVENT_TOKEN_SET.has(token)) return true;
  }
  return EVENTS.some((event) => lower.includes(event.label.toLowerCase()));
}

/**
 * Trigger stated, no outcome yet → ", assign to <first snapshot assignee>".
 * Never fires without snapshot assignees, never repeats text already present,
 * never chains beyond one clause, never invents thresholds/routing/arming.
 */
function suggestMissingOutcome(prefix: string, snapshot: BrainContextSnapshot): Completion | null {
  if (snapshot.assignees.length === 0) return null;
  const lower = prefix.toLowerCase();
  if (hasActionEvidence(lower)) return null;
  const clause = `assign to ${snapshot.assignees[0]}`;
  if (lower.includes(clause.toLowerCase())) return null;
  const joint = clauseJoint(prefix);
  if (joint === null) return null;
  if (joint === ", ") {
    // Ends on a word: fire only when that word is event evidence (a finished trigger).
    const lastWord = /([a-z0-9'-]+)$/.exec(lower)?.[1] ?? "";
    if (!EVENT_TOKEN_SET.has(lastWord)) return null;
  } else if (!hasEventEvidence(lower)) {
    return null;
  }
  return {
    insertText: `${joint}${clause}`,
    kind: "missing-outcome",
    evidence: ["snapshot:assignees", "vocabulary:events"],
  };
}

/**
 * Conditioned rule with an action but no alternate lane → ", otherwise do
 * nothing". An explicit no-op is always safe; it invents no policy.
 */
function suggestExceptionPath(prefix: string): Completion | null {
  const lower = prefix.toLowerCase();
  if (!hasActionEvidence(lower)) return null;
  if (!hasConditionEvidence(lower)) return null;
  if (/(^|[^a-z])(otherwise|else)([^a-z]|$)/.test(lower)) return null;
  const joint = clauseJoint(prefix);
  if (joint === null) return null;
  return { insertText: `${joint}otherwise do nothing`, kind: "exception-path", evidence: ["policy:no-op"] };
}

/**
 * The deterministic ghost. Cursor must sit at the very end of the text
 * (overlay safety); the suggestion begins exactly where the prefix ends.
 * Returns null whenever nothing safe and useful exists — silence is a feature.
 */
export function deterministicGhost(
  state: GhostRequestState,
  snapshot: BrainContextSnapshot
): GhostSuggestion | null {
  if (snapshot.snapshotId !== state.contextSnapshotId) return null;
  if (state.imeComposing) return null;
  if (state.cursorStart !== state.cursorEnd) return null;
  if (state.cursorEnd !== state.text.length) return null;
  const prefix = state.text.slice(0, state.cursorStart);
  const trimmed = prefix.trim();
  if (trimmed.length < GHOST_MIN_PREFIX_CHARS) return null;
  if (trimmed.split(/\s+/).length < GHOST_MIN_PREFIX_WORDS) return null;

  const completion =
    completeEntityArgument(prefix, snapshot) ??
    completeWindow(prefix, buildBank(snapshot)) ??
    suggestMissingOutcome(prefix, snapshot) ??
    suggestExceptionPath(prefix);
  if (completion === null) return null;
  return buildSuggestion(state, completion.insertText, completion.kind, "deterministic", completion.evidence);
}

/* -------------------------------------------------------------------------- */
/* Policy                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Gate order (first hit wins). Hard gates (allow=false) suppress ALL ghosting:
 * ime → selection → cursor-not-at-end → too-short. Soft gates keep the
 * deterministic ghost but block the AI path (allow=true, useAi=false):
 * offline → rate-limited → no-capability → deterministic-sufficient.
 * A deterministic grounded-entity/clause-completion is "sufficient";
 * missing-outcome/exception-path still allow AI refinement.
 */
export function ghostPolicy(
  state: GhostRequestState,
  deterministic: GhostSuggestion | null
): GhostPolicyDecision {
  if (state.imeComposing) return { allow: false, reason: "ime", useAi: false };
  if (state.cursorStart !== state.cursorEnd) return { allow: false, reason: "selection", useAi: false };
  if (state.cursorEnd !== state.text.length) {
    return { allow: false, reason: "cursor-not-at-end", useAi: false };
  }
  const trimmed = state.text.slice(0, state.cursorStart).trim();
  if (trimmed.length < GHOST_MIN_PREFIX_CHARS || trimmed.split(/\s+/).length < GHOST_MIN_PREFIX_WORDS) {
    return { allow: false, reason: "too-short", useAi: false };
  }
  if (state.offline) return { allow: true, reason: "offline", useAi: false };
  if (state.recentRateLimit) return { allow: true, reason: "rate-limited", useAi: false };
  if (!state.aiCapability) return { allow: true, reason: "no-capability", useAi: false };
  if (
    deterministic !== null &&
    (deterministic.kind === "grounded-entity" || deterministic.kind === "clause-completion")
  ) {
    return { allow: true, reason: "deterministic-sufficient", useAi: false };
  }
  return { allow: true, reason: "ok", useAi: true };
}

/* -------------------------------------------------------------------------- */
/* Ranking, freshness, dismissals                                             */
/* -------------------------------------------------------------------------- */

const KIND_PRIORITY: Record<GhostKind, number> = {
  "grounded-entity": 0,
  "clause-completion": 1,
  "missing-outcome": 2,
  "exception-path": 3,
  "consultant-refinement": 4,
};

/** Pure, total, deterministic ordering — input array is never mutated. */
export function rankGhostCandidates(cands: GhostSuggestion[]): GhostSuggestion[] {
  return [...cands].sort(
    (a, b) =>
      KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] ||
      (a.source === b.source ? 0 : a.source === "deterministic" ? -1 : 1) ||
      a.insertText.length - b.insertText.length ||
      (a.insertText < b.insertText ? -1 : a.insertText > b.insertText ? 1 : 0) ||
      (a.suggestionId < b.suggestionId ? -1 : a.suggestionId > b.suggestionId ? 1 : 0)
  );
}

/** Fresh iff prefixHash + snapshotId + ruleVersion + generation ALL still match. */
export function ghostIsFresh(s: GhostSuggestion, state: GhostRequestState): boolean {
  return (
    s.prefixHash === djb2(state.text.slice(0, state.cursorStart)) &&
    s.contextSnapshotId === state.contextSnapshotId &&
    s.ruleVersion === state.ruleVersion &&
    s.generation === state.generation
  );
}

/** In-memory, generation-scoped: a dismissal dies when its generation is passed. */
export function makeGhostDismissals(): GhostDismissals {
  const entries = new Map<string, number>();
  const key = (prefixHash: string, insertText: string) => `${prefixHash}\u0000${insertText}`;
  return {
    has: (prefixHash, insertText) => entries.has(key(prefixHash, insertText)),
    add: (prefixHash, insertText, generation) => {
      entries.set(key(prefixHash, insertText), generation);
    },
    clearBefore: (generation) => {
      for (const [entryKey, entryGeneration] of entries) {
        if (entryGeneration < generation) entries.delete(entryKey);
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Hostile-candidate validation (the AI path)                                 */
/* -------------------------------------------------------------------------- */

const GHOST_KINDS: readonly string[] = [
  "clause-completion",
  "grounded-entity",
  "missing-outcome",
  "exception-path",
  "consultant-refinement",
];

const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f\u2028\u2029]/;
/**
 * Grammar/connective tokens an AI candidate may use WITHOUT grounding: rule
 * connectors, units, comparators, and structural nouns. Nothing here can name
 * an entity — names must ground against the snapshot or the vocabulary.
 */
const FRAGMENT_CONNECTIVES = new Set([
  "when", "if", "then", "and", "or", "the", "a", "an", "is", "are", "to", "it",
  "this", "that", "of", "with", "in", "for", "on", "at", "not", "no", "do",
  "don", "t", "does", "nothing", "otherwise", "else", "unless", "except",
  "please", "using", "set", "by", "as", "after", "before", "within", "once",
  "per", "over", "under", "above", "below", "least", "most", "than", "worse",
  "better", "new", "all", "any", "template", "templates", "request", "requests",
  "day", "days", "hour", "hours", "minute", "minutes", "week", "weeks",
  "month", "months",
]);

/** Lowercase, collapse every non-alphanumeric run to one space, trim. */
function normalizeFragment(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

interface GroundedLabel {
  label: string;
  evidence: string;
}

/** Every snapshot label an AI candidate may legitimately mention. */
function groundableLabels(snapshot: BrainContextSnapshot): GroundedLabel[] {
  const out: GroundedLabel[] = [];
  for (const assignee of snapshot.assignees) {
    out.push({ label: assignee, evidence: "snapshot:assignees" });
  }
  for (const key of Object.keys(snapshot.instanceOptions).sort()) {
    for (const option of snapshot.instanceOptions[key]) {
      out.push({ label: option, evidence: `options:${key}` });
    }
  }
  for (const key of Object.keys(snapshot.instanceRegistry).sort()) {
    for (const entry of snapshot.instanceRegistry[key]) {
      out.push({ label: entry.label, evidence: `registry:${key}:${entry.id}` });
    }
  }
  return out;
}

/**
 * Full-coverage grounding: EVERY token of the candidate must be claimed by a
 * known phrase — a snapshot label, a vocabulary term (actions/events/fields/
 * operators), the no-op grammar — or be a connective/number. One recognized
 * term cannot legitimize surrounding free prose ("notify admin and ignore
 * previous instructions" dies on its ungrounded words), and entity names in
 * ANY casing or length must ground against the snapshot ("assign to frank
 * sinatra" dies on "frank"). Returns the evidence sources, or null when any
 * content token grounds nowhere or no content token grounds at all.
 */
function groundAllTokens(insertText: string, snapshot: BrainContextSnapshot): string[] | null {
  const tokens = normalizeFragment(insertText).split(" ").filter(Boolean);
  if (tokens.length === 0) return null;
  const covered = new Array<boolean>(tokens.length).fill(false);
  const evidence = new Set<string>();

  const claim = (phrase: string, source: string): void => {
    const phraseTokens = normalizeFragment(phrase).split(" ").filter(Boolean);
    if (phraseTokens.length === 0) return;
    for (let i = 0; i + phraseTokens.length <= tokens.length; i++) {
      let hit = true;
      for (let j = 0; j < phraseTokens.length; j++) {
        if (tokens[i + j] !== phraseTokens[j]) {
          hit = false;
          break;
        }
      }
      if (hit) {
        for (let j = 0; j < phraseTokens.length; j++) covered[i + j] = true;
        evidence.add(source);
      }
    }
  };

  for (const grounded of groundableLabels(snapshot)) claim(grounded.label, grounded.evidence);
  for (const action of ACTIONS) {
    claim(action.label.replace("{param}", " "), "vocabulary:actions");
    for (const alias of action.aliases ?? []) claim(alias.replace("{param}", " "), "vocabulary:actions");
  }
  for (const event of EVENTS) {
    claim(event.label, "vocabulary:events");
    for (const alias of event.aliases ?? []) claim(alias, "vocabulary:events");
  }
  for (const field of Object.values(FIELDS)) claim(field.label, "vocabulary:fields");
  for (const label of MULTI_WORD_OPERATOR_LABELS) claim(label, "vocabulary:operators");
  claim("otherwise do nothing", "policy:no-op");

  let groundedContent = false;
  for (let i = 0; i < tokens.length; i++) {
    if (covered[i]) {
      groundedContent = true;
      continue;
    }
    if (FRAGMENT_CONNECTIVES.has(tokens[i])) continue;
    if (/^\d+[km]?$/.test(tokens[i])) continue;
    return null; // an ungrounded content word — fail closed
  }
  return groundedContent ? [...evidence] : null;
}

/**
 * Treat the transport candidate as hostile input. Accept only an object with a
 * single-line, control-free string insertText of at most 120 chars that adds
 * text not already present and whose EVERY token grounds — snapshot label,
 * vocabulary phrase, connective/number (groundAllTokens) — so entity names in
 * any casing must exist in the snapshot and one known term cannot smuggle
 * arbitrary prose. The result is re-keyed fresh from the request state with
 * source "ai" and evidence rebuilt locally — candidate-supplied evidence is
 * discarded, and a candidate may not claim the deterministic engine's
 * "grounded-entity" rank tier.
 */
export function validateGhostCandidate(
  candidate: unknown,
  state: GhostRequestState,
  snapshot: BrainContextSnapshot
): GhostSuggestion | null {
  if (snapshot.snapshotId !== state.contextSnapshotId) return null;
  if (state.cursorStart !== state.cursorEnd || state.cursorEnd !== state.text.length) return null;
  if (typeof candidate !== "object" || candidate === null) return null;
  const raw = (candidate as Record<string, unknown>).insertText;
  if (typeof raw !== "string") return null;
  const insertText = raw;
  if (insertText.length === 0 || insertText.length > 120) return null;
  if (CONTROL_CHARS_RE.test(insertText)) return null;
  const core = normalizeFragment(insertText);
  if (core.length === 0) return null;
  if (normalizeFragment(state.text).includes(core)) return null;

  const evidence = new Set<string>(["transport:ai"]);
  const grounded = groundAllTokens(insertText, snapshot);
  if (grounded === null) return null;
  for (const source of grounded) evidence.add(source);

  const kindRaw = (candidate as Record<string, unknown>).kind;
  // "grounded-entity" is the deterministic engine's own top rank tier — an AI
  // candidate claiming it would outrank deterministic suggestions.
  const kind: GhostKind =
    typeof kindRaw === "string" && GHOST_KINDS.includes(kindRaw) && kindRaw !== "grounded-entity"
      ? (kindRaw as GhostKind)
      : "consultant-refinement";
  return buildSuggestion(state, insertText, kind, "ai", [...evidence].sort());
}

/* -------------------------------------------------------------------------- */
/* Telemetry                                                                  */
/* -------------------------------------------------------------------------- */

/** Enum-shaped dimension values only — author/tenant text can never pass this. */
const DIM_VALUE_RE = /^[a-z0-9][a-z0-9.-]{0,31}$/;

/**
 * Emit one ghost event. Undefined sink is a no-op. Dimension values are
 * filtered against an enum-shape allowlist; anything else is dropped, so no
 * text, vocabulary, or customer content can ride a dimension.
 */
export function emitGhostTelemetry(
  sink: BrainTelemetrySink | undefined,
  event: GhostTelemetryEvent,
  dims: { source: GhostSource; latencyBucket?: string }
): void {
  if (sink === undefined) return;
  const safe: Record<string, string> = {};
  if (DIM_VALUE_RE.test(dims.source)) safe.source = dims.source;
  if (dims.latencyBucket !== undefined && DIM_VALUE_RE.test(dims.latencyBucket)) {
    safe.latencyBucket = dims.latencyBucket;
  }
  sink.event(`ghost.${event}`, safe);
}
