/**
 * GENERATED from packages/rule-core/src/nlParser.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/rule-core contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * Deterministic client-side parser: natural-language instruction → WorkflowRule.
 *
 * Fully deterministic on purpose (Foundation Brief §6): the demo chat path must
 * never do anything non-deterministic on stage. It can graduate to a real LLM
 * later, but the structured target stays the same.
 *
 * Hardening Phase 0 (plan §2): the parser is honest —
 * - REJECT, DON'T COERCE (N1): unknown assignees/values become UnresolvedSlots
 *   with fuzzy suggestions, never fabricated params.
 * - COVERAGE (N2): consumed character spans are tracked; leftover fragments the
 *   parser did not understand are surfaced in `uncovered`.
 * - AMBIGUITY (N3): generic keywords with competing readings return a question,
 *   not a guess (`forceEvent` re-runs with the user's pick).
 * - NEGATION (N4): "don't assign…" clauses are excluded and noted.
 */

import {
  ACTIONS,
  ActionDef,
  EVENTS,
  FIELDS,
  getAction,
  FieldDef,
  allowedFieldsForEvent,
  ASSIGNEES,
  WorkflowRule,
  RuleCondition,
  RuleOutput,
  ConditionGroup,
  ScopeValue,
  scopeLabel,
  CondLogic,
  opLabel,
  paramKeyFor,
  RULE_SCHEMA_VERSION,
  defaultControls,
  condFieldLabel,
  condFieldKind,
  isValuelessOperator,
} from "./vocabulary";
import { fuzzyMatches } from "./fuzzy";

/* -------------------------------------------------------------------------- */
/* Result contract (hardening plan §1d)                                       */
/* -------------------------------------------------------------------------- */

export interface UnresolvedSlot {
  where: "action-param" | "condition-value" | "event";
  /** Action lane; omitted by legacy/parser slots where "then" is implied. */
  lane?: "then" | "else";
  actionIndex?: number;
  conditionIndex?: number;
  param?: string;
  /** Raw captured text the author wrote. */
  heard: string;
  /** Fuzzy matches from the (live) option list. */
  suggestions: string[];
}

export interface ParseAmbiguity {
  question: string;
  options: string[];
}

export interface ParseOptions {
  /** Resolve an ambiguity by forcing the trigger event. */
  forceEvent?: string;
  /** Live assignee names (falls back to the static ASSIGNEES). */
  assignees?: string[];
  /** Live option lists per field key (from the demo-bridge overlay). */
  instanceOptions?: Record<string, string[]>;
  /** ID-bearing registries per field/action key (Phase 2 §4.6) — when a name
   *  resolves exactly AND has a registry entry, the parser emits an instance
   *  ScopeRef instead of a bare string. */
  instanceRegistry?: Record<string, { id: string; label: string }[]>;
  /**
   * Permissive authoring (Phase 1.9.5): accept a mentioned condition/action
   * value even when it matches no vocabulary option or live registry, coercing
   * it to its literal instead of rejecting it as an UnresolvedSlot. The literal
   * still lands in the rule (so the field "works"), and every such value is
   * reported in `ParseResult.unbacked` so the UI can flag it as "not backed by
   * real data". OFF by default — the default parser stays reject-don't-coerce
   * (N1), which the assertion suite pins.
   */
  allowUnbackedValues?: boolean;
}

export interface ParseResult {
  rule: WorkflowRule | null;
  notes: string[];
  /** Sidecar only — NEVER persisted into rule JSON. */
  unresolved: UnresolvedSlot[];
  /** Input fragments the parser did not consume (N2). */
  uncovered: string[];
  ambiguities: ParseAmbiguity[];
  /**
   * Values accepted under `allowUnbackedValues` that matched no vocabulary
   * option / live registry — the rule works with the literal, but the UI should
   * flag each as "not backed by real data". Empty unless permissive mode is on.
   */
  unbacked?: string[];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Permissive authoring (Phase 1.9.5): record a mentioned value that matched no
 * vocabulary option in `unbacked` and return its literal, so the field works
 * even though it is not backed by real data. Callers use this in the else-branch
 * of a match ONLY when `opts.allowUnbackedValues` is set; otherwise the value
 * still becomes an UnresolvedSlot (reject-don't-coerce, N1).
 */
function acceptUnbackedValue(unbacked: string[], heard: string): string {
  const literal = titleCase(heard);
  unbacked.push(literal);
  return literal;
}

/** Strip trailing punctuation that leaks into regex captures (e.g. \"Wael.\" → \"Wael\"). */
function stripTrailingPunct(s: string): string {
  return s.trim().replace(/[.,;:!?]+$/, "").trim();
}

/** Parse a delay phrase like \"2 days\" or \"24 hours\" into minutes. */
function parseDelayText(text: string): number | null {
  const m = /(\d+)\s*(day|days|hour|hours|minute|minutes|min|mins|week|weeks)/i.exec(text);
  if (!m) return null;
  const qty = Number(m[1]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const unit = m[2].toLowerCase();
  if (unit.startsWith("day")) return qty * 24 * 60;
  if (unit.startsWith("hour") || unit === "hr" || unit === "hrs") return qty * 60;
  if (unit.startsWith("min")) return qty;
  if (unit.startsWith("week")) return qty * 7 * 24 * 60;
  return null;
}

/** Consumed [start, end) spans over the normalized text (N2 coverage). */
type Spans = Array<[number, number]>;

function consume(spans: Spans, start: number, length: number) {
  if (length > 0) spans.push([start, start + length]);
}

/** Replace consumed spans with spaces — the text the parser has NOT claimed.
 *  Used so already-consumed trigger words (e.g. the dual-trigger "or") can't
 *  influence downstream text scans like AND/OR logic detection. */
function maskConsumed(text: string, spans: Spans): string {
  const chars = text.split("");
  for (const [s, e] of spans) {
    for (let i = Math.max(0, s); i < Math.min(chars.length, e); i++) chars[i] = " ";
  }
  return chars.join("");
}

/** Words that don't count toward an "uncovered fragment" (connectors/noise). */
const STOPWORDS = new Set([
  "when", "if", "then", "and", "or", "the", "a", "an", "is", "are", "to", "it",
  "this", "that", "there", "on", "for", "of", "with", "in", "fires", "please",
]);

/** Merge spans and return ≥3-content-word gaps the parser never consumed. */
function uncoveredFragments(text: string, spans: Spans): string[] {
  const merged: Spans = [];
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const gaps: string[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) gaps.push(text.slice(cursor, s));
    cursor = Math.max(cursor, e);
  }
  if (cursor < text.length) gaps.push(text.slice(cursor));

  return gaps
    .map((g) => g.replace(/^[\s,.;]+|[\s,.;]+$/g, ""))
    .filter((g) => {
      const words = g.split(/[^a-z0-9$-]+/).filter((w) => w && !STOPWORDS.has(w));
      // Two content words is already a material clause ("moon full", "risk
      // high") — the old ≥3 floor silently dropped them (MVP 1: nothing
      // material may vanish). One lone word stays noise UNLESS it carries a
      // number/amount, which is always material.
      return words.length >= 2 || words.some((w) => /\d|\$/.test(w));
    });
}

/* -------------------------------------------------------------------------- */
/* Event matching (N3: ambiguity → question, not guess)                        */
/* -------------------------------------------------------------------------- */

/** Keywords that drive event inference; consumed for coverage accounting. */
const EVENT_KEYWORD_RE =
  /\b(error|failed|failure|approved|approval|rejected|denied|declined|offer|accepts?|accepted|fiserv|fmac|document|signature)\b/g;

function consumeEventKeywords(text: string, spans: Spans) {
  for (const m of text.matchAll(EVENT_KEYWORD_RE)) {
    consume(spans, m.index ?? 0, m[0].length);
  }
}

function matchEvent(
  text: string,
  spans: Spans,
  forceEvent?: string
): { event: string | null; ambiguity: ParseAmbiguity | null; extraEvents?: string[] } {
  if (forceEvent) {
    consumeEventKeywords(text, spans);
    return { event: forceEvent, ambiguity: null };
  }

  // Trigger detection is scoped to the TRIGGER CLAUSE (the text before the
  // first comma/"and"/"then"): an event key or subject word inside a condition
  // or action clause ("…, request document w9") must never define the trigger —
  // the same cross-clause contamination class as the dual-trigger hijack.
  const clauseBreak = /,|\band\b|\bthen\b/.exec(text);
  const triggerClause = clauseBreak ? text.slice(0, clauseBreak.index) : text;

  // Direct event-key mention wins outright (longest first). A key NAMED in the
  // trigger clause beats a longer key that only appears later — otherwise
  // "when a fmac loan is booked, notify omar that the loan approved" flips the
  // trigger to LOAN APPROVED (buried in the action clause) and dumps the real
  // trigger into `uncovered`. Fall back to a whole-text scan only when the
  // trigger clause names no event key (single-clause inputs, trailing key).
  const allHits = EVENTS.map((e) => e.key).filter((k) => text.includes(norm(k)));
  const clauseHits = allHits.filter((k) => triggerClause.includes(norm(k)));
  const hits = clauseHits.length ? clauseHits : allHits;
  if (hits.length) {
    const key = hits.sort((a, b) => b.length - a.length)[0];
    consume(spans, text.indexOf(norm(key)), norm(key).length);
    return { event: key, ambiguity: null };
  }

  const dualTriggerMatch = /\b(approved|rejected|denied|declined|accepted)\b\s+or\s+\b(approved|rejected|denied|declined|accepted)\b/.exec(text);
  if (dualTriggerMatch) {
    const [full, firstRaw, secondRaw] = dualTriggerMatch;
    // Anchor to the trigger clause: a verb pair appearing after the first
    // "and"/comma belongs to a condition ("… and status is rejected or
    // denied"), not the trigger — matching there replaced the user's real
    // trigger (review finding).
    const clauseSep = /,|\band\b/.exec(text);
    const inTriggerClause = !clauseSep || dualTriggerMatch.index < clauseSep.index;
    const subjects = [
      /\bdocument\b/.test(triggerClause) ? "DOCUMENT" : null,
      /\boffer\b/.test(triggerClause) ? "OFFER" : null,
      /\bloan\b/.test(triggerClause) || /\brequest\b/.test(triggerClause) || /\bapplication\b/.test(triggerClause) ? "LOAN" : null,
    ].filter((s): s is "DOCUMENT" | "OFFER" | "LOAN" => s !== null);
    // N3: exactly one subject may be auto-picked. Several subjects ("a loan or
    // document is approved…") fall through to the single-event branches below,
    // which ask instead of precedence-guessing (review finding).
    if (inTriggerClause && subjects.length === 1) {
      const subject = subjects[0];
      // Subject-aware mapping onto REAL vocabulary keys only — offers have no
      // "OFFER APPROVED" event (approved/accepted → OFFER ACCEPTED), and
      // "accepted" never crosses subjects (review findings).
      const mapTok = (tok: string): string =>
        subject === "OFFER"
          ? tok === "approved" || tok === "accepted"
            ? "OFFER ACCEPTED"
            : "OFFER REJECTED"
          : tok === "approved" || tok === "accepted"
            ? `${subject} APPROVED`
            : `${subject} REJECTED`;
      const first = mapTok(firstRaw);
      const second = mapTok(secondRaw);
      if (EVENTS.some((e) => e.key === first) && EVENTS.some((e) => e.key === second)) {
        consume(spans, dualTriggerMatch.index, full.length);
        return { event: first, extraEvents: first === second ? [] : [second], ambiguity: null };
      }
    }
  }

  // Multi-word phrase matches for unambiguous triggers.
  if (/\bdocument\s+checklist\s+is\s+complete\b/.test(text) || /\bdocument\s+checklist\s+complete\b/.test(text)) {
    const m = /\bdocument\s+checklist\s+is\s+complete\b/.exec(text) ?? /\bdocument\s+checklist\s+complete\b/.exec(text);
    if (m) {
      consume(spans, m.index, m[0].length);
      return { event: "CHECKLIST COMPLETED", ambiguity: null };
    }
  }

  if (/\bdocument\s+upload\s+is\s+(?:approved|approval)\b/.test(text) || /\bdocument\s+upload\s+(?:approved|approval)\b/.test(text)) {
    const m = /\bdocument\s+upload\s+is\s+(?:approved|approval)\b/.exec(text) ?? /\bdocument\s+upload\s+(?:approved|approval)\b/.exec(text);
    if (m) {
      consume(spans, m.index, m[0].length);
      return { event: "DOCUMENT APPROVED", ambiguity: null };
    }
  }

  if (/\bdocument\s+upload\s+is\s+(?:rejected|denied|declined)\b/.test(text) || /\bdocument\s+upload\s+(?:rejected|denied|declined)\b/.test(text)) {
    const m = /\bdocument\s+upload\s+is\s+(?:rejected|denied|declined)\b/.exec(text) ?? /\bdocument\s+upload\s+(?:rejected|denied|declined)\b/.exec(text);
    if (m) {
      consume(spans, m.index, m[0].length);
      return { event: "DOCUMENT REJECTED", ambiguity: null };
    }
  }

  if (/\bloan\s+application\s+is\s+(?:approved|approval)\b/.test(text) || /\bloan\s+application\s+(?:approved|approval)\b/.test(text)) {
    const m = /\bloan\s+application\s+is\s+(?:approved|approval)\b/.exec(text) ?? /\bloan\s+application\s+(?:approved|approval)\b/.exec(text);
    if (m) {
      consume(spans, m.index, m[0].length);
      return { event: "LOAN APPROVED", ambiguity: null };
    }
  }

  if (/\bloan\s+application\s+is\s+(?:rejected|denied|declined)\b/.test(text) || /\bloan\s+application\s+(?:rejected|denied|declined)\b/.test(text)) {
    const m = /\bloan\s+application\s+is\s+(?:rejected|denied|declined)\b/.exec(text) ?? /\bloan\s+application\s+(?:rejected|denied|declined)\b/.exec(text);
    if (m) {
      consume(spans, m.index, m[0].length);
      return { event: "LOAN REJECTED", ambiguity: null };
    }
  }

  // Keep offer rejected to fallback to default ambiguity checks

  const hasDocument = /\bdocument\b/.test(triggerClause);
  const hasOffer = /\boffer\b/.test(triggerClause);

  const err = /\b(error|failed|failure|booking error)\b/.exec(text);
  if (err) {
    consume(spans, err.index, err[0].length);
    return { event: "SYSTEM ERROR", ambiguity: null };
  }

  const approved = /\b(approved|approval)\b/.exec(text);
  if (approved) {
    const hasRequestish = /\b(request|template|origination|covenant|loan application)\b/.test(triggerClause);
    if (hasDocument) {
      return {
        event: null,
        ambiguity: {
          question: "Did you mean loan approval or document approval?",
          options: ["LOAN APPROVED", "DOCUMENT APPROVED"],
        },
      };
    }
    if (!/\bloan\b/.test(triggerClause) && !/\bdocument\b/.test(triggerClause) && !hasRequestish) {
      return {
        event: null,
        ambiguity: {
          question: "Did you mean loan approval or document approval?",
          options: ["LOAN APPROVED", "DOCUMENT APPROVED"],
        },
      };
    }
    consume(spans, approved.index, approved[0].length);
    return { event: "LOAN APPROVED", ambiguity: null };
  }

  const rejected = /\b(rejected|denied|declined)\b/.exec(text);
  if (rejected) {
    if (hasDocument) {
      return {
        event: null,
        ambiguity: {
          question: "Did you mean loan rejection or document rejection?",
          options: ["LOAN REJECTED", "DOCUMENT REJECTED"],
        },
      };
    }
    if (hasOffer) {
      return {
        event: null,
        ambiguity: {
          question: "Did you mean the loan being rejected or the offer being declined?",
          options: ["LOAN REJECTED", "OFFER REJECTED"],
        },
      };
    }
    consume(spans, rejected.index, rejected[0].length);
    return { event: "LOAN REJECTED", ambiguity: null };
  }

  const offerAccept = /\boffer\b.*\baccept/.exec(text) ?? /\baccept.*\boffer\b/.exec(text);
  if (offerAccept) {
    consume(spans, offerAccept.index, offerAccept[0].length);
    return { event: "OFFER ACCEPTED", ambiguity: null };
  }

  const core = /\b(fiserv|fmac)\b/.exec(text);
  if (core) {
    consume(spans, core.index, core[0].length);
    return { event: core[1] === "fiserv" ? "FISERV LOAN" : "FMAC LOAN", ambiguity: null };
  }

  // Every content-specific heuristic above has passed. The generic
  // vocabulary scorer is the last resort — it derives trigger recognition
  // from EVENTS itself, so new client events become parseable without
  // touching this file (process over content).
  return matchEventGeneric(text, spans);
}

/* -------------------------------------------------------------------------- */
/* Generic vocabulary-driven trigger fallback (process over content)          */
/* -------------------------------------------------------------------------- */

/** Levenshtein distance ≤ max, with row-minimum early exit. Small words only. */
function editDistanceAtMost(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** Word equality tolerating one edit (typos, inflections) on words ≥5 chars. */
function fuzzyWordEq(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  return editDistanceAtMost(a, b, 1);
}

/**
 * Score every EventDef (key + aliases) against the words of the instruction.
 * Deterministic and conservative (N3): a unique perfect token match is taken;
 * perfect ties or all-but-one near-misses become a question, never a guess;
 * anything weaker stays unrecognized. One-word phrases are ignored — too
 * hijackable by ordinary prose.
 */
function matchEventGeneric(
  text: string,
  spans: Spans
): { event: string | null; ambiguity: ParseAmbiguity | null } {
  const words: { w: string; idx: number }[] = [];
  for (const m of text.matchAll(/[a-z0-9][a-z0-9-]*/g)) {
    words.push({ w: m[0], idx: m.index ?? 0 });
  }
  interface Candidate {
    key: string;
    count: number;
    total: number;
    hits: { idx: number; len: number }[];
  }
  const candidates: Candidate[] = [];
  for (const event of EVENTS) {
    let best: Candidate | null = null;
    for (const phrase of [event.key, ...(event.aliases ?? [])]) {
      const tokens = norm(phrase).split(" ").filter(Boolean);
      if (tokens.length < 2) continue;
      const hits: { idx: number; len: number }[] = [];
      let count = 0;
      for (const token of tokens) {
        const hit = words.find((word) => fuzzyWordEq(word.w, token));
        if (hit) {
          count++;
          hits.push({ idx: hit.idx, len: hit.w.length });
        }
      }
      const candidate: Candidate = { key: event.key, count, total: tokens.length, hits };
      if (!best || candidate.count / candidate.total > best.count / best.total) best = candidate;
    }
    if (best && best.count >= 2) candidates.push(best);
  }
  const perfect = candidates.filter((c) => c.count === c.total);
  if (perfect.length === 1) {
    for (const hit of perfect[0].hits) consume(spans, hit.idx, hit.len);
    return { event: perfect[0].key, ambiguity: null };
  }
  const near = perfect.length > 1 ? perfect : candidates.filter((c) => c.count === c.total - 1);
  if (near.length) {
    const options = near
      .sort((a, b) => b.count / b.total - a.count / a.total || b.total - a.total)
      .slice(0, 3)
      .map((c) => c.key);
    return { event: null, ambiguity: { question: "Which trigger event did you mean?", options } };
  }
  return { event: null, ambiguity: null };
}

function matchLogic(text: string): CondLogic {
  return /\bor\b/.test(text) && !/\bother\b/.test(text) ? "OR" : "AND";
}

/* -------------------------------------------------------------------------- */
/* Conditions                                                                 */
/* -------------------------------------------------------------------------- */

/** Enum options distinctive enough to imply their field without naming it. */
function isDistinctive(opt: string): boolean {
  const generic = ["approved", "rejected", "assigned", "unassigned", "sent", "all", "done"];
  return opt.length > 3 && !generic.includes(opt.toLowerCase());
}

/** Parse "250k", "$1.2 million", "250,000" → integer string. */
function parseAmount(raw: string): string | null {
  const m = /\$?\s*([\d.,]+)\s*(k|m|thousand|million)?/i.exec(raw);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (isNaN(n)) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix === "k" || suffix === "thousand") n *= 1000;
  if (suffix === "m" || suffix === "million") n *= 1000000;
  return String(Math.round(n));
}

/** Fields whose text values name platform instances → must resolve or slot. */
const INSTANCE_FIELDS = new Set([
  "retailer",
  "customer_name",
  "template",
  "team_member",
  "main_borrower",
  "program",
]);

/** Option list for an instance-shaped field: live overlay first, then static. */
function instanceListFor(field: FieldDef, opts?: ParseOptions): string[] | null {
  const live = opts?.instanceOptions?.[field.key];
  if (live?.length) return live;
  if (field.options?.length) return field.options;
  return null;
}

/** Upgrade a resolved label to an instance ScopeRef when a registry id exists. */
function toInstanceRef(key: string, label: string, opts?: ParseOptions): ScopeValue {
  const hit = opts?.instanceRegistry?.[key]?.find((o) => norm(o.label) === norm(label));
  return hit ? { level: "instance", id: hit.id, label: hit.label } : label;
}

function matchConditions(
  text: string,
  eventKey: string,
  spans: Spans,
  opts: ParseOptions | undefined,
  unresolved: UnresolvedSlot[],
  unbacked: string[]
): RuleCondition[] {
  const conds: RuleCondition[] = [];
  const allowed = allowedFieldsForEvent(eventKey);
  // Fields bound in pass 1 (by their own name) — pass 2's rough scan skips them
  // and can't reuse their words.
  const named = new Set<string>();

  /* ---- Pass 1: label-NAMED conditions ("<field label> is <value>") --------
   * Every canonical serialized condition names its field, so this pass binds
   * all of them and consumes their spans. Running BEFORE the rough scan is what
   * keeps a bare distinctive option in one clause ("Error") from being claimed
   * by a sibling field whose real value lives in a DIFFERENT clause — the
   * non-idempotency that made the text/builder/canvas surfaces drift. */
  for (const field of allowed) {
    const labelN = norm(field.label);
    const labelIdx = text.indexOf(labelN);

    if (field.kind === "orderedEnum" && field.options) {
      // "risk grade worse than B" / "grade better than C"
      const re = new RegExp(
        `${escapeRe(labelN)}\\s+(?:is\\s+)?(worse than|better than)\\s+(${field.options.map(escapeRe).join("|")})\\b`,
        "i"
      );
      const m = re.exec(text);
      if (m) {
        consume(spans, m.index, m[0].length);
        conds.push({
          field: field.key,
          operator: m[1] === "worse than" ? "worse_than" : "better_than",
          value: m[2].toUpperCase(),
        });
        named.add(field.key);
        continue;
      }
    }

    if ((field.kind === "enum" || field.kind === "orderedEnum") && field.options && labelIdx >= 0) {
      // Label-adjacent binding: when the field is named outright ("request
      // stage is not Closed"), the option that directly follows the label wins.
      const optAlt = [...field.options]
        .sort((a, b) => b.length - a.length)
        .map((o) => escapeRe(norm(o)))
        .join("|");
      const adjacent = new RegExp(
        `${escapeRe(labelN)}\\s+(?:(is\\s+not|isn't|is|not)\\s+)?(${optAlt})\\b`
      ).exec(text);
      if (adjacent) {
        const opt = field.options.find((o) => norm(o) === adjacent[2]);
        if (opt) {
          consume(spans, adjacent.index, adjacent[0].length);
          conds.push({
            field: field.key,
            operator: adjacent[1] && /not/.test(adjacent[1]) ? "is_not" : "is",
            value: opt,
          });
          named.add(field.key);
        }
      }
    } else if (field.kind === "numeric") {
      // e.g. "loan amount over 250k", "amount is at least $1 million"
      const re = new RegExp(
        `${escapeRe(labelN)}\\s+((?:is\\s+)?(?:over|above|greater than|more than|at least|under|below|less than|at most)|>=|>|<=|<|is|of|=)?\\s*\\$?([\\d.,]+\\s*(?:k|m|thousand|million)?)`
      );
      const m = re.exec(text);
      if (m) {
        const amount = parseAmount(m[2]);
        if (amount) {
          consume(spans, m.index, m[0].length);
          const opWord = (m[1] ?? "").trim();
          let operator = "is";
          if (/over|above|greater than|more than|>/.test(opWord)) operator = "gt";
          else if (/at least|>=/.test(opWord)) operator = "gte";
          else if (/under|below|less than|</.test(opWord)) operator = "lt";
          else if (/at most|<=/.test(opWord)) operator = "lte";
          conds.push({ field: field.key, operator, value: amount });
          named.add(field.key);
        }
      }
    } else if (field.kind === "text") {
      const re = new RegExp(
        `${escapeRe(labelN)}\\s+(?:is|=|:|of)\\s+([a-z0-9 &._-]{2,40}?)(?:\\s+(?:and|or|then)\\b|\\s*[,.;]|$)`
      );
      const m = re.exec(text);
      if (m) {
        const heard = m[1].trim();
        consume(spans, m.index, m[0].length);
        named.add(field.key);
        // N1 for instance-shaped fields: resolve against the registry or slot.
        const list = INSTANCE_FIELDS.has(field.key) ? instanceListFor(field, opts) : null;
        if (list) {
          const exact = list.find((o) => norm(o) === heard);
          if (exact) {
            conds.push({ field: field.key, operator: "is", value: toInstanceRef(field.key, exact, opts) });
          } else if (opts?.allowUnbackedValues) {
            conds.push({ field: field.key, operator: "is", value: acceptUnbackedValue(unbacked, heard) });
          } else {
            conds.push({ field: field.key, operator: "is", value: "" });
            unresolved.push({
              where: "condition-value",
              conditionIndex: conds.length - 1,
              heard,
              suggestions: fuzzyMatches(heard, list),
            });
          }
        } else {
          conds.push({ field: field.key, operator: "is", value: titleCase(heard) });
        }
      }
    }
  }

  /* ---- Pass 2: rough distinctive-option scan for UNNAMED enum fields -------
   * Catches an option mentioned WITHOUT its field label ("… is Confirmed").
   * Runs on text with every pass-1 span masked out, so it can only claim words
   * no named condition already took — the guarantee that canonical serialized
   * text (all conditions named) round-trips to an exact, stable fixpoint. */
  for (const field of allowed) {
    if (named.has(field.key)) continue;
    if (!((field.kind === "enum" || field.kind === "orderedEnum") && field.options)) continue;
    const labelN = norm(field.label);
    const labelIdx = text.indexOf(labelN);
    const fieldMentioned = labelIdx >= 0 || text.includes(field.key);
    const scanText = maskConsumed(text, spans);
    for (const opt of field.options) {
      const optN = norm(opt);
      // Short options (grades "A"–"E") need word boundaries + the field named;
      // plain includes() would match single letters anywhere.
      const optRe = new RegExp(`\\b${escapeRe(optN)}\\b`);
      const optIdx =
        optN.length <= 3 ? (optRe.exec(scanText)?.index ?? -1) : scanText.indexOf(optN);
      if (optIdx === -1) continue;
      const negated = new RegExp(`(is not|isn't|not)\\s+${escapeRe(optN)}`).test(scanText);
      const applies =
        optN.length <= 3
          ? fieldMentioned
          : (fieldMentioned && scanText.includes(optN)) || isDistinctive(opt);
      if (applies) {
        if (labelIdx >= 0) consume(spans, labelIdx, labelN.length);
        consume(spans, optIdx, optN.length);
        conds.push({ field: field.key, operator: negated ? "is_not" : "is", value: opt });
        break;
      }
    }
  }

  // Fallback numeric phrasing: "loan over 500k" / "loan under 100k".
  if (!conds.some((c) => c.field === "loan_amount")) {
    const loanAmountRe =
      /\bloan\b(?:\s+amount)?\s+(?:is\s+)?(over|above|greater than|more than|at least|under|below|less than|at most|>=|>|<=|<|=)\s+\$?([\d.,]+(?:\s*(?:k|m|thousand|million))?)\b/;
    const m = loanAmountRe.exec(text);
    if (m) {
      const amount = parseAmount(m[2]);
      if (amount) {
        consume(spans, m.index, m[0].length);
        const opWord = m[1].trim();
        let operator = "is";
        if (/over|above|greater than|more than|>/.test(opWord)) operator = "gt";
        else if (/at least|>=/.test(opWord)) operator = "gte";
        else if (/under|below|less than|</.test(opWord)) operator = "lt";
        else if (/at most|<=/.test(opWord)) operator = "lte";
        conds.push({ field: "loan_amount", operator, value: amount });
      }
    }
  }
  return conds;
}

/** Parse an action-local gate clause into a v3 condition group. */
function parseActionGate(
  clause: string,
  eventKey: string,
  opts: ParseOptions | undefined,
  unresolved: UnresolvedSlot[],
  unbacked: string[]
): ConditionGroup | undefined {
  const text = norm(clause).replace(/^(?:if|when)\s+/, "");
  if (!text) return undefined;
  const gateConds = matchConditions(text, eventKey, [], opts, unresolved, unbacked);
  if (!gateConds.length) return undefined;
  return { logic: "AND", children: gateConds };
}

/* -------------------------------------------------------------------------- */
/* Outputs (N1 reject-don't-coerce, N4 negation)                              */
/* -------------------------------------------------------------------------- */

function matchOutputs(
  text: string,
  eventKey: string,
  spans: Spans,
  opts: ParseOptions | undefined,
  unresolved: UnresolvedSlot[],
  notes: string[],
  unbacked: string[]
): RuleOutput[] {
  const outputs: RuleOutput[] = [];
  const assigneeList = opts?.assignees?.length ? opts.assignees : ASSIGNEES;

  // N4: exclude negated instructions before matching, and note each one.
  const excluded = new Set<string>();
  const negRe =
    /(?:don't|do not|never|without)\s+((assign|route|escalate|notify|close|tag|change)\b[a-z0-9 ._-]*?)(?=\s*(?:,|\.|;|$|\band\b|\bthen\b))/g;
  for (const m of text.matchAll(negRe)) {
    const verb = m[2] === "route" || m[2] === "escalate" ? "assign" : m[2];
    excluded.add(verb);
    excluded.add(m[2]); // raw verb too — the generic pass matches labels by first word
    consume(spans, m.index ?? 0, m[0].length);
    notes.push(`Ignored negated instruction: "${m[1].trim()}".`);
  }

  /** Resolve a captured name against a registry; slot it when unknown (N1). */
  function pushResolved(action: "assign_user" | "notify", heard: string) {
    const param = paramKeyFor(action);
    const exact = assigneeList.find((a) => norm(a) === norm(heard));
    if (exact) {
      outputs.push({ action, params: { [param]: toInstanceRef(action, exact, opts) } });
    } else if (opts?.allowUnbackedValues) {
      outputs.push({ action, params: { [param]: acceptUnbackedValue(unbacked, heard) } });
    } else {
      outputs.push({ action, params: {} });
      unresolved.push({
        where: "action-param",
        actionIndex: outputs.length - 1,
        param,
        heard,
        suggestions: fuzzyMatches(heard, assigneeList),
      });
    }
  }

  function attachActionGate(actionIndex: number, clause?: string) {
    if (!clause) return;
    const gate = parseActionGate(clause, eventKey, opts, unresolved, unbacked);
    if (gate) outputs[actionIndex].when = gate;
  }

  function pushAuthority(heard: string) {
    const param = paramKeyFor("assign_authority");
    const options = opts?.instanceOptions?.assign_authority?.length
      ? opts.instanceOptions.assign_authority
      : getAction("assign_authority")?.paramOptions ?? ["Loan Officer", "Credit Committee"];
    const exact = options.find((a) => norm(a) === norm(heard));
    if (exact) {
      outputs.push({ action: "assign_authority", params: { [param]: exact } });
    } else if (opts?.allowUnbackedValues) {
      outputs.push({ action: "assign_authority", params: { [param]: acceptUnbackedValue(unbacked, heard) } });
    } else {
      outputs.push({ action: "assign_authority", params: {} });
      unresolved.push({
        where: "action-param",
        actionIndex: outputs.length - 1,
        param,
        heard,
        suggestions: fuzzyMatches(heard, options),
      });
    }
  }

  function pushGenericAuthority() {
    const param = paramKeyFor("assign_authority");
    const options = opts?.instanceOptions?.assign_authority?.length
      ? opts.instanceOptions.assign_authority
      : getAction("assign_authority")?.paramOptions ?? ["Loan Officer", "Credit Committee"];
    if (options.length === 1) {
      outputs.push({ action: "assign_authority", params: { [param]: options[0] } });
      return;
    }
    outputs.push({ action: "assign_authority", params: {} });
    unresolved.push({
      where: "action-param",
      actionIndex: outputs.length - 1,
      param,
      heard: "authority",
      suggestions: options.slice(0, 3),
    });
  }

  // assign / route / escalate to <name>
  if (!excluded.has("assign")) {
    const genericAuthority =
      /\b(?:assign|route|escalate|send it|send this)\s+(?:this\s+|it\s+)?to\s+(?:the\s+)?(?:approval\s+)?authority(?:\s+level)?(?:\s+(?:if|when)\s+(.+?))?(?=\s*(?:,|\.|;|$|\band\b|\bthen\b))/.
        exec(text);
    if (genericAuthority) {
      consume(spans, genericAuthority.index, genericAuthority[0].length);
      pushGenericAuthority();
      attachActionGate(outputs.length - 1, genericAuthority[1]);
    } else {
      const authority =
        /\b(?:assign|route|escalate|send it|send this)\s+(?:this\s+|it\s+)?to\s+(?:the\s+)?(credit committee|loan officer)(?:\s+(?:if|when)\s+(.+?))?(?=\s*(?:,|\.|;|$|\band\b|\bthen\b))/.
          exec(text) ??
        /\b(?:assign|route|escalate|send it|send this)\s+to\s+(?:the\s+)?(credit committee|loan officer)(?:\s+(?:if|when)\s+(.+?))?(?=\s*(?:,|\.|;|$|\band\b|\bthen\b))/.
          exec(text);
      if (authority) {
        consume(spans, authority.index, authority[0].length);
        pushAuthority(authority[1].trim().replace(/\b\w/g, (c) => c.toUpperCase()));
        attachActionGate(outputs.length - 1, authority[2]);
      } else {
        const assign =
          /(?:assign|route|escalate|send it|send this)\s+(?:it\s+|this\s+)?to\s+([a-z0-9 ._-]{2,40}?)(?:\s+(?:if|when)\s+(.+?))?(?=\s*(?:and|then|unless|otherwise|except|,|\.|;|$))/.exec(
            text
          );
        if (assign) {
          consume(spans, assign.index, assign[0].length);
          pushResolved("assign_user", stripTrailingPunct(assign[1]));
          attachActionGate(outputs.length - 1, assign[2]);
        }
      }
    }
  }

  // notify <name>
  if (!excluded.has("notify")) {
    const remindWithDelay =
      /\bremind\s+([a-z0-9 ._-]{2,40}?)\s+(\d{1,3})\s+days?\s+(before|after)\s+(?:the\s+)?([a-z0-9 _-]{3,40}?)(?:\s+(?:if|when)\s+(.+?))?(?=\s*(?:and|then|unless|otherwise|except|,|\.|;|$))/.
        exec(
        text
      );
    if (remindWithDelay) {
      consume(spans, remindWithDelay.index, remindWithDelay[0].length);
      pushResolved("notify", stripTrailingPunct(remindWithDelay[1]));
      const days = Number(remindWithDelay[2]);
      if (Number.isFinite(days) && days > 0 && outputs.length) {
        outputs[outputs.length - 1].delayMinutes = remindWithDelay[3] === "before" ? -(days * 24 * 60) : days * 24 * 60;
      }
      attachActionGate(outputs.length - 1, remindWithDelay[5]);
    } else {
      const notify =
        /(?:notify|remind)\s+([a-z0-9 ._-]{2,40}?)(?:\s+(?:if|when)\s+(.+?))?(?=\s*(?:and|then|unless|otherwise|except|,|\.|;|$))/.exec(text);
      if (notify) {
        consume(spans, notify.index, notify[0].length);
        pushResolved("notify", stripTrailingPunct(notify[1]));
        attachActionGate(outputs.length - 1, notify[2]);
      }
    }
  }

  // change / set / move stage to <stage>
  if (!excluded.has("change")) {
    const stage =
      /(?:change|set|move)\s+(?:the\s+)?stage\s+to\s+([a-z ]{3,20}?)(?:\s+(?:after|in)\s+(\d{1,3})\s+(day|days|hour|hours|minute|minutes|min|mins|week|weeks))?(?:\s+(?:if|when)\s+(.+?))?(?=\s*(?:and|then|unless|otherwise|except|,|\.|;|$))/.exec(
        text
      );
    if (stage) {
      consume(spans, stage.index, stage[0].length);
      const heard = stripTrailingPunct(stage[1]);
      const options = FIELDS.stage.options ?? [];
      const exact = options.find((o) => norm(o) === norm(heard));
      if (exact) {
        outputs.push({ action: "change_stage", params: { value: exact } });
      } else if (opts?.allowUnbackedValues) {
        outputs.push({ action: "change_stage", params: { value: acceptUnbackedValue(unbacked, heard) } });
      } else {
        outputs.push({ action: "change_stage", params: {} });
        unresolved.push({
          where: "action-param",
          actionIndex: outputs.length - 1,
          param: paramKeyFor("change_stage"),
          heard,
          suggestions: fuzzyMatches(heard, options),
        });
      }
      // Delay suffix: "after 2 days", "in 24 hours". Quantity AND unit both come
      // from the regex captures — re-scanning stage[0] for a unit word would find
      // one embedded in the stage name first ("monday review in 3 weeks" → "day").
      if (stage[2] && stage[3]) {
        const delayMinutes = parseDelayText(`${stage[2]} ${stage[3]}`);
        if (delayMinutes != null && outputs.length) {
          outputs[outputs.length - 1].delayMinutes = delayMinutes;
        }
      }
      attachActionGate(outputs.length - 1, stage[4]);
    }
  }

  // add tag <tag> — tags are self-identifying free text (hardening §4); normalize only.
  if (!excluded.has("tag")) {
    const tag = /add\s+(?:a\s+)?tag\s+([a-z0-9 _-]{2,30}?)(?:\s+(?:if|when)\s+(.+?))?(?=\s*(?:and|then|unless|otherwise|except|,|\.|;|$))/.exec(text);
    if (tag) {
      consume(spans, tag.index, tag[0].length);
      outputs.push({ action: "add_tag", params: { value: stripTrailingPunct(tag[1]).replace(/\s+/g, " ") } });
      attachActionGate(outputs.length - 1, tag[2]);
    }
  }

  // close the request
  if (!excluded.has("close")) {
    const close = /close\s+(?:the\s+)?request/.exec(text);
    if (close) {
      consume(spans, close.index, close[0].length);
      outputs.push({ action: "close_request", params: {} });
    }
  }

  // Generic vocabulary pass over whatever the legacy matchers did not consume:
  // grammar is derived from each ActionDef's label/aliases, so every other
  // action in the vocabulary — including future client actions — parses with
  // zero changes to this file (process over content).
  matchOutputsGeneric(maskConsumed(text, spans), eventKey, spans, opts, unresolved, excluded, outputs, unbacked);

  return outputs;
}

/* -------------------------------------------------------------------------- */
/* Generic vocabulary-driven action grammar (process over content)            */
/* -------------------------------------------------------------------------- */

/**
 * Actions with dedicated legacy grammar above. The generic pass skips them so
 * every pinned behavior (capture shapes, output order, the special authority
 * and remind forms) stays byte-for-byte identical.
 */
const LEGACY_ACTION_KEYS = new Set([
  "assign_user",
  "assign_authority",
  "notify",
  "change_stage",
  "add_tag",
  "close_request",
]);

const GENERIC_DELAY =
  "(?:\\s+(?:after|in)\\s+(\\d{1,3})\\s*(day|days|hour|hours|minute|minutes|min|mins|week|weeks))?";
const GENERIC_GATE = "(?:\\s+(?:if|when)\\s+(.+?))?";
// A "." only terminates at end of clause (followed by whitespace or the end),
// so dots inside URLs/filenames never truncate a parameter capture.
const GENERIC_END =
  "(?=\\s*(?:,|;|$|\\.\\s|\\.$|\\band\\b|\\bthen\\b|\\bunless\\b|\\botherwise\\b|\\bexcept\\b))";
/** Free-text param charset — URL-ish characters allowed; must not start with whitespace. */
const GENERIC_PARAM = "([a-z0-9./:_?#=&%-][a-z0-9 ./:_?#=&%-]{1,59}?)";

interface GenericActionMatch {
  index: number;
  length: number;
  action: ActionDef;
  paramRaw: string | null;
  delayQty?: string;
  delayUnit?: string;
  gate?: string;
}

/**
 * Try one action's label + aliases (longest phrase first) against the text.
 * A `{param}` placeholder positions the parameter mid-phrase; otherwise the
 * parameter follows the phrase. Enum params try the option list before the
 * free capture (a free capture becomes an unresolved slot — N1).
 */
function matchGenericAction(text: string, action: ActionDef): GenericActionMatch | null {
  const phrases = [action.label, ...(action.aliases ?? [])]
    .map((phrase) => norm(phrase))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    const hasSlot = phrase.includes("{param}");
    const [preRaw, postRaw = ""] = hasSlot ? phrase.split("{param}") : [phrase, ""];
    const pre = escapeRe(preRaw.trim());
    const post = postRaw.trim() ? `\\s+${escapeRe(postRaw.trim())}` : "";
    const sources: string[] = [];
    if (action.paramKind === "none") {
      sources.push(`\\b${pre}${GENERIC_DELAY}${GENERIC_GATE}${GENERIC_END}`);
    } else {
      if (action.paramKind === "enum" && action.paramOptions?.length) {
        const optionAlt = [...action.paramOptions]
          .sort((a, b) => b.length - a.length)
          .map((option) => escapeRe(norm(option)))
          .join("|");
        sources.push(`\\b${pre}\\s+(${optionAlt})\\b${post}${GENERIC_DELAY}${GENERIC_GATE}${GENERIC_END}`);
      }
      sources.push(`\\b${pre}\\s+${GENERIC_PARAM}${post}${GENERIC_DELAY}${GENERIC_GATE}${GENERIC_END}`);
    }
    for (const source of sources) {
      const m = new RegExp(source).exec(text);
      if (!m) continue;
      const tail = action.paramKind === "none" ? 1 : 2;
      return {
        index: m.index,
        length: m[0].length,
        action,
        paramRaw: action.paramKind === "none" ? null : (m[1] ?? null),
        delayQty: m[tail],
        delayUnit: m[tail + 1],
        gate: m[tail + 2],
      };
    }
  }
  return null;
}

function matchOutputsGeneric(
  maskedText: string,
  eventKey: string,
  spans: Spans,
  opts: ParseOptions | undefined,
  unresolved: UnresolvedSlot[],
  excludedVerbs: Set<string>,
  outputs: RuleOutput[],
  unbacked: string[]
) {
  const matches: GenericActionMatch[] = [];
  for (const action of ACTIONS) {
    if (LEGACY_ACTION_KEYS.has(action.key)) continue;
    if (excludedVerbs.has(norm(action.label).split(" ")[0])) continue;
    const match = matchGenericAction(maskedText, action);
    if (match) matches.push(match);
  }
  // Reading order, so multi-action sentences keep their written sequence.
  matches.sort((a, b) => a.index - b.index);
  for (const match of matches) {
    consume(spans, match.index, match.length);
    const def = match.action;
    const output: RuleOutput = { action: def.key, params: {} };
    let slot: UnresolvedSlot | null = null;
    if (def.paramKind !== "none" && match.paramRaw != null) {
      const heard = stripTrailingPunct(match.paramRaw).replace(/\s+/g, " ");
      const param = paramKeyFor(def.key);
      const options = def.paramOptions ?? [];
      const exact = options.find((option) => norm(option) === norm(heard));
      if (exact) {
        output.params[param] = def.paramKind === "text" ? toInstanceRef(def.key, exact, opts) : exact;
      } else if (options.length && !opts?.allowUnbackedValues) {
        // Reject-don't-coerce: an unknown value never lands in the rule.
        slot = { where: "action-param", actionIndex: 0, param, heard, suggestions: fuzzyMatches(heard, options) };
      } else if (options.length) {
        // Permissive (1.9.5): accept the literal, flagged as not backed by data.
        output.params[param] = acceptUnbackedValue(unbacked, heard);
      } else {
        output.params[param] = heard;
      }
    }
    if (match.delayQty && match.delayUnit) {
      const delayMinutes = parseDelayText(`${match.delayQty} ${match.delayUnit}`);
      if (delayMinutes != null) output.delayMinutes = delayMinutes;
    }
    if (match.gate) {
      const gate = parseActionGate(match.gate, eventKey, opts, unresolved, unbacked);
      if (gate) output.when = gate;
    }
    outputs.push(output);
    if (slot) {
      slot.actionIndex = outputs.length - 1;
      unresolved.push(slot);
    }
  }
}

function matchControls(text: string): Partial<WorkflowRule["controls"]> {
  const controls: Partial<WorkflowRule["controls"]> = {};

  if (/\bshadow\s+mode\b/.test(text)) {
    controls.mode = "shadow";
  }
  if (/\blive\s+mode\b/.test(text)) {
    controls.mode = "armed";
  }
  if (/\bonce\s+per\s+request\b/.test(text)) {
    controls.oncePerRequest = true;
  }
  if (/\bone\s+per\s+request\b/.test(text) || /\bper\s+request\b/.test(text)) {
    controls.oncePerRequest = true;
  }

  const armed =
    /\b(?:arm|activate|enable)\b(?:\s+live\s+actions|\s+this\s+rule|\s+the\s+rule|\s+rule)?\b/.test(text) ||
    /\blive\s+actions\b/.test(text);
  if (!controls.mode) controls.mode = armed ? "armed" : "shadow";

  const rate =
    /\b(?:cap|limit|at most)\s+(?:at\s+)?(\d{1,3})\s+(?:fires?|runs?|executions?)\s+per\s+hour\b/.exec(text) ??
    /\b(?:cap|limit|at most)\s+(?:at\s+)?(\d{1,3})\s*\/\s*hour\b/.exec(text) ??
    /\b(\d{1,3})\s+(?:fires?|runs?|executions?)\s+per\s+hour\b/.exec(text) ??
    /\b(\d{1,3})\s*\/\s*hour\b/.exec(text);
  if (rate) {
    const n = Number(rate[1]);
    if (Number.isFinite(n) && n > 0) controls.maxFiresPerHour = Math.max(1, Math.min(999, Math.round(n)));
  }

  return controls;
}

/* -------------------------------------------------------------------------- */
/* Category words (Phase 2 §4.6): "business customers", "any origination"     */
/* -------------------------------------------------------------------------- */

const CATEGORY_PATTERNS: Array<{ re: RegExp; field: string; category: (m: RegExpExecArray) => string }> = [
  {
    re: /\b(?:any\s+)?(business|individual)\s+customers?\b/,
    field: "customer_name",
    category: (m) => titleCase(m[1]),
  },
  {
    re: /\b(?:any\s+)?(origination|covenant|loan application)\s+(?:requests?|templates?)\b/,
    field: "template",
    category: (m) => titleCase(m[1]),
  },
];

/** Map category keywords to category-scoped conditions (skips duplicated fields). */
function matchCategoryConditions(text: string, spans: Spans, existing: RuleCondition[]): RuleCondition[] {
  const out: RuleCondition[] = [];
  for (const pat of CATEGORY_PATTERNS) {
    const m = pat.re.exec(text);
    if (!m) continue;
    if (existing.some((c) => c.field === pat.field) || out.some((c) => c.field === pat.field)) continue;
    consume(spans, m.index, m[0].length);
    out.push({ field: pat.field, operator: "is", value: { level: "category", category: pat.category(m) } });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function parseInstruction(input: string, opts?: ParseOptions): ParseResult {
  const notes: string[] = [];
  const unresolved: UnresolvedSlot[] = [];
  const unbacked: string[] = [];
  const spans: Spans = [];
  const text = norm(input);
  if (!text) {
    return {
      rule: null,
      notes: ["Type an instruction to draft a rule."],
      unresolved: [],
      uncovered: [],
      ambiguities: [],
    };
  }

  const { event: eventKey, ambiguity, extraEvents } = matchEvent(text, spans, opts?.forceEvent);
  if (ambiguity) {
    // N3: never guess between competing readings — ask.
    return { rule: null, notes: [ambiguity.question], unresolved: [], uncovered: [], ambiguities: [ambiguity] };
  }
  if (!eventKey) {
    return {
      rule: null,
      notes: [
        "Couldn't identify a trigger event. Try one of: " +
          EVENTS.filter((e) => e.confidence === "verified")
            .map((e) => e.label)
            .join(", ") +
          ".",
      ],
      unresolved: [],
      uncovered: [],
      ambiguities: [],
    };
  }

  // The main action lane must never read the otherwise/else clause: an action
  // type that appears only there ("… otherwise notify Omar") would leak into
  // the primary lane. Mask the else region (space-padded so span indices stay
  // valid) before matching main outputs; the else lane parses its own text.
  const elseMatch = /\b(?:otherwise|else)\b[\s,]*(.+)$/.exec(text);
  const mainText = elseMatch
    ? text.slice(0, elseMatch.index) + " ".repeat(text.length - elseMatch.index)
    : text;
  // Outputs BEFORE conditions: generic action phrases legitimately embed
  // field labels and option words ("set underwriting result to Auto
  // Approved"), and the action must be able to claim them first. The
  // condition scan reads the raw text and never consults spans, so its own
  // results are order-independent.
  const outputs = matchOutputs(mainText, eventKey, spans, opts, unresolved, notes, unbacked);
  const conds = matchConditions(text, eventKey, spans, opts, unresolved, unbacked);
  conds.push(...matchCategoryConditions(text, spans, conds));
  const controlPatch = matchControls(text);
  // AND/OR is decided on the UNCONSUMED text only: the trigger's own "or"
  // ("approved or rejected") is already consumed and must not flip AND-joined
  // conditions to OR (review finding).
  const condLogic = matchLogic(maskConsumed(text, spans));
  const elseText = elseMatch ? stripTrailingPunct(elseMatch[1]) : "";
  /**
   * "Otherwise, do nothing" (and variants) is an INTENTIONAL no-op — an
   * explicit statement of what happens to non-matching requests, not an
   * instruction the parser failed to understand (composer roadmap Phase 1).
   * Recognized: consumed + noted, no else lane, never `uncovered`.
   */
  const elseIsNoop =
    !!elseMatch &&
    /^(?:do\s+)?nothing\b|^(?:take\s+)?no\s+action\b|^leave\s+(?:it|them|the\s+requests?)?\s*(?:alone|unchanged|as[- ]is)\b|^skip\s+(?:it|them)?$/i.test(elseText);
  const elseOutputs = elseMatch && !elseIsNoop
    ? matchOutputs(elseText, eventKey, [], opts, unresolved, notes, unbacked)
    : [];
  // Consume the else clause only when it was actually understood — either as
  // real else-actions or as the explicit no-op. Anything else ("otherwise fly
  // to the moon") stays unconsumed so it surfaces in `uncovered` and blocks.
  if (elseMatch && (elseIsNoop || elseOutputs.length > 0)) {
    consume(spans, elseMatch.index, elseMatch[0].length);
    if (elseIsNoop) notes.push("Otherwise → intentionally no action.");
  }
  // Coverage is computed AFTER the else clause is consumed — previously every
  // else clause (even a fully parsed one) was miscounted as uncovered.
  const uncovered = uncoveredFragments(text, spans);

  const triggers = [{ event: eventKey }];
  if (extraEvents?.length) {
    for (const ev of extraEvents) triggers.push({ event: ev });
  }

  notes.push(`Event → ${triggers.map((t) => t.event).join(" or ")}.`);
  if (conds.length) {
    notes.push(
      "Conditions → " +
        conds
          .map((c) => {
            const label = condFieldLabel(c.field);
            const op = opLabel(condFieldKind(c.field), c.operator);
            return isValuelessOperator(c.operator)
              ? `${label} ${op}`
              : `${label} ${op} ${scopeLabel(c.value) || "(pick a value)"}`;
          })
          .join(` ${condLogic} `) +
        "."
    );
  } else {
    notes.push("No conditions matched (fires on every event of this type).");
  }
  if (outputs.length) {
    notes.push(
      "Actions → " +
        outputs
          .map((o) => {
            const key = paramKeyFor(o.action);
            return `${o.action.replace(/_/g, " ")}${scopeLabel(o.params[key]) ? " " + scopeLabel(o.params[key]) : ""}`;
          })
          .join("; ") +
        "."
    );
  } else {
    notes.push('No action matched. Add one like "assign to Wael".');
  }
  for (const slot of unresolved) {
    notes.push(`Needs your pick: ${slot.param ?? "value"} (heard "${slot.heard}").`);
  }
  for (const value of unbacked) {
    notes.push(`Using “${value}” — not backed by real data.`);
  }

  return {
    rule: {
      schemaVersion: RULE_SCHEMA_VERSION,
      triggers,
      conditions: { logic: condLogic, children: conds },
      actions: outputs,
      else: elseOutputs.length ? elseOutputs : undefined,
      controls: { ...defaultControls(), ...controlPatch },
    },
    notes,
    unresolved,
    uncovered,
    ambiguities: [],
    unbacked,
  };
}

/**
 * Parse a bare action fragment ("notify Sara", "escalate to Operations") —
 * the revision engine's reuse of the tested action grammar (MVP 3). Returns
 * the outputs plus any unresolved slots the fragment produced; callers decide
 * whether unresolved fragments are acceptable.
 */
export function parseActionFragment(
  text: string,
  eventKey?: string,
  opts?: ParseOptions
): { outputs: RuleOutput[]; unresolved: UnresolvedSlot[] } {
  const unresolved: UnresolvedSlot[] = [];
  // The fragment path shares the grammar; permissive coercion (if opts sets it)
  // still lands the literal in outputs — the unbacked marker list is not part of
  // this function's contract, so it is collected locally and discarded.
  const outputs = matchOutputs(norm(text), eventKey ?? "SYSTEM ERROR", [], opts, unresolved, [], []);
  return { outputs, unresolved };
}
