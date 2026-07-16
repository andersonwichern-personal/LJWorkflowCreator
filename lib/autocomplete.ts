/**
 * Context-aware completion for the chat composer (Phase 8 §2).
 *
 * Kept pure and framework-free so it can be asserted in
 * scripts/assert-autocomplete.ts — ChatBox owns only the textarea and the
 * dropdown chrome. Three ideas, applied in this order:
 *
 * - CONTEXT (§2): the NEAREST keyword behind the caret decides which vocabulary
 *   the author is reaching for. Scanning backwards is the whole point — in
 *   "when a loan is approved notify wa" the author wants people, even though
 *   "when" opened the sentence.
 * - WINDOW (§2): the last 1, 2 and 3 words are each tried, so multi-word targets
 *   ("document approved") match. The widest window that hit wins: it is the most
 *   specific reading of what was actually typed.
 * - FUZZY (§2): fuzzyMatches, not substring, so typos still land.
 */

import { fuzzyMatches } from "./fuzzy";
import { ASSIGNEES, EVENTS, FIELDS } from "./vocabulary";
import type { VocabOverlay } from "./liveVocabulary";

/**
 * `value` covers instance operands (retailers, templates, stages). They are
 * field values, never triggers or people, so they are a bucket of their own and
 * always rank last — filing them under "assignee" would offer a stage name to
 * "notify …".
 */
export type CandidateKind = "event" | "field" | "assignee" | "value";

export interface AutocompleteCandidate {
  value: string;
  kind: CandidateKind;
}

export interface AutocompleteMatch {
  value: string;
  kind: CandidateKind;
  /** Trailing word count this match replaces when accepted (1–3). */
  windowSize: number;
}

/** Keyword → the vocabulary an author reaches for right after it (§2). */
const CONTEXT_KEYWORDS: Record<string, CandidateKind> = {
  when: "event",
  whenever: "event",
  if: "field",
  where: "field",
  and: "field",
  or: "field",
  assign: "assignee",
  route: "assignee",
  escalate: "assignee",
  notify: "assignee",
  to: "assignee",
};

/** Bucket order per detected context. */
const PRIORITY_ORDER: Record<CandidateKind | "none", CandidateKind[]> = {
  event: ["event", "field", "assignee", "value"],
  field: ["field", "event", "assignee", "value"],
  assignee: ["assignee", "field", "event", "value"],
  value: ["value", "field", "event", "assignee"],
  none: ["event", "field", "assignee", "value"],
};

const MAX_WINDOW = 3;
const MIN_QUERY = 2;

/** Word tokens, splitting on the same whitespace/comma runs the parser ignores. */
function words(text: string): string[] {
  return text.split(/[\s,]+/).filter(Boolean);
}

/** The nearest context keyword behind the caret, or null when there is none. */
export function contextKind(input: string): CandidateKind | null {
  const w = words(input.toLowerCase());
  for (let i = w.length - 1; i >= 0; i--) {
    const kind = CONTEXT_KEYWORDS[w[i]];
    if (kind) return kind;
  }
  return null;
}

function dedupeCandidates(list: AutocompleteCandidate[]): AutocompleteCandidate[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const key = c.value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Every option the composer can complete to, tagged by kind.
 *
 * Live users come from the platform overlay, with the static demo roster as the
 * fallback: buildOverlay() leaves `instances.users` empty whenever the platform
 * is unconfigured — i.e. every local/demo run — and without the fallback the
 * people the demo actually assigns to (Wael, Sara, …) never complete at all.
 */
export function buildCandidates(vocab: VocabOverlay | null): AutocompleteCandidate[] {
  const out: AutocompleteCandidate[] = [];
  const push = (value: string | undefined, kind: CandidateKind) => {
    const v = value?.trim();
    if (v) out.push({ value: v, kind });
  };

  for (const event of EVENTS) {
    push(event.label, "event");
    push(event.key, "event");
  }
  for (const field of Object.values(FIELDS)) push(field.label, "field");

  const isTeam = (a: string) => /team$/i.test(a);
  for (const team of ASSIGNEES.filter(isTeam)) push(team, "assignee");
  const people = vocab?.instances.users.length
    ? vocab.instances.users.map((u) => u.label)
    : ASSIGNEES.filter((a) => !isTeam(a));
  for (const person of people) push(person, "assignee");

  for (const retailer of vocab?.instances.retailers ?? []) push(retailer.label, "value");
  for (const template of vocab?.instances.templates ?? []) push(template.label, "value");
  for (const stage of vocab?.instances.stages ?? []) push(stage.label, "value");

  return dedupeCandidates(out);
}

/**
 * Rank completions for the text behind the caret. Sort key, in order:
 * context bucket → widest window → the fuzzy matcher's own ranking.
 * De-duplication happens after the sort, so an option found by both a 1- and a
 * 2-word window keeps the wider window and replaces both words on accept.
 */
export function suggestCompletions(
  input: string,
  candidates: AutocompleteCandidate[],
  max = 5
): AutocompleteMatch[] {
  const w = words(input);
  const lastWord = w[w.length - 1] ?? "";
  if (lastWord.length < MIN_QUERY) return [];

  const byKind = new Map<CandidateKind, string[]>();
  for (const candidate of candidates) {
    const list = byKind.get(candidate.kind);
    if (list) list.push(candidate.value);
    else byKind.set(candidate.kind, [candidate.value]);
  }

  const order = PRIORITY_ORDER[contextKind(input) ?? "none"];
  const scored: { match: AutocompleteMatch; rank: [number, number, number] }[] = [];

  for (const [bucketRank, kind] of order.entries()) {
    const options = byKind.get(kind);
    if (!options?.length) continue;
    for (let size = Math.min(MAX_WINDOW, w.length); size >= 1; size--) {
      const needle = w.slice(w.length - size).join(" ");
      fuzzyMatches(needle, options, max).forEach((value, fuzzyRank) => {
        scored.push({ match: { value, kind, windowSize: size }, rank: [bucketRank, -size, fuzzyRank] });
      });
    }
  }

  scored.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);

  const seen = new Set<string>();
  const out: AutocompleteMatch[] = [];
  for (const { match } of scored) {
    const key = match.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(match);
    if (out.length === max) break;
  }
  return out;
}

/**
 * Swap the matched trailing window for the completed option, leaving every
 * character before it byte-for-byte intact. Rebuilding the whole string from a
 * split would drop the author's commas, and the parser reads commas as clause
 * boundaries (nlParser matchEvent/matchOutputs) — so that edit would quietly
 * change how the finished instruction parses.
 */
export function applyCompletion(input: string, match: AutocompleteMatch): string {
  const tokens = [...input.matchAll(/[^\s,]+/g)];
  const size = Math.min(match.windowSize, tokens.length);
  if (size === 0) return `${match.value} `;
  const first = tokens[tokens.length - size];
  return `${input.slice(0, first.index ?? 0)}${match.value} `;
}
