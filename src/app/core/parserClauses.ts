/**
 * GENERATED from packages/rule-core/src/parserClauses.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/rule-core contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * parserClauses — span-preserving normalization + deterministic clause segmentation and
 * classification (parser AI engine, architecture doc "parserClauses.ts", interface freeze v1).
 *
 * Mirrors nlParser's reading of the text WITHOUT importing it (no cycles): the pinned helpers
 * below (norm, STOPWORDS, event keywords, negation, no-op family, control grammar, materiality)
 * are byte-for-byte replicas of their nlParser.ts counterparts and must change together.
 * Classification evidence derives from the vocabulary (EVENTS/FIELDS/ACTIONS) — process over
 * content — and never guesses: no evidence = "unknown" (material).
 *
 * Determinism contract: same input → byte-identical output. Clause ids hash (sourceText, span),
 * so an edit ANYWHERE in the text changes the ids of shifted clauses — intended: ids are stable
 * only within one description generation, never across edits.
 *
 * Split conservatism: a boundary is taken only when the right-hand side demonstrably starts an
 * independent clause (action verb, field label, control/no-op/timing/schedule lead, negation).
 * When in doubt the text stays one clause — a bigger clause is honest, a wrong split lies.
 */

import { ACTIONS, EVENTS, FIELDS } from "./vocabulary";

/* -------------------------------------------------------------------------- */
/* Contract types                                                             */
/* -------------------------------------------------------------------------- */

/** [start, end) over NormalizedSource.text. */
export interface SourceSpan {
  start: number;
  end: number;
}

export interface NormalizedSource {
  /** Original input, untouched. */
  raw: string;
  /** EXACTLY nlParser's norm(): lowercased, whitespace runs collapsed to one space, trimmed. */
  text: string;
  /** Maps an offset in `text` back to the ORIGINAL offset in `raw` (collapsed runs map to the
   *  first raw char of the run; the trimmed lead maps forward to the first content char). */
  toRaw(normIndex: number): number;
}

export type ClauseKind =
  | "trigger"
  | "condition"
  | "action-primary"
  | "action-alternate"
  | "action-guard"
  | "timing"
  | "control"
  | "no-op"
  | "unsupported"
  | "unknown";

export interface ParsedClause {
  /** stableClauseId(source.text, span) — generation-scoped; shifts with any upstream edit. */
  id: string;
  /** Over NormalizedSource.text. */
  span: SourceSpan;
  /** Over NormalizedSource.raw. */
  rawSpan: SourceSpan;
  /** Exact normalized slice: source.text.slice(span.start, span.end). */
  text: string;
  kind: ClauseKind;
  /** false only for pure connector/noise clauses (the uncoveredFragments materiality rule). */
  material: boolean;
  /** "don't/do not/never/without <verb>…" prohibition clauses. */
  negated?: boolean;
  /** kind === "unsupported" only. */
  unsupportedReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Pinned nlParser replicas (keep byte-for-byte with nlParser.ts)             */
/* -------------------------------------------------------------------------- */

/** Pinned to nlParser.ts norm(). */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Pinned to nlParser.ts escapeRe(). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pinned to nlParser.ts STOPWORDS. */
const STOPWORDS = new Set([
  "when", "if", "then", "and", "or", "the", "a", "an", "is", "are", "to", "it",
  "this", "that", "there", "on", "for", "of", "with", "in", "fires", "please",
]);

/** Pinned to nlParser.ts EVENT_KEYWORD_RE (without the /g flag). */
const EVENT_KEYWORD_RE =
  /\b(?:error|failed|failure|approved|approval|rejected|denied|declined|offer|accepts?|accepted|fiserv|fmac|document|signature)\b/;

/** Pinned to nlParser.ts negRe (verb list + prefixes; capture groups dropped). */
const NEG_RE = /(?:don't|do not|never|without)\s+(?:assign|route|escalate|notify|close|tag|change)\b/;

/** Pinned to nlParser.ts elseIsNoop (applied to the marker-stripped clause body). */
const NOOP_RE =
  /^(?:do\s+)?nothing\b|^(?:take\s+)?no\s+action\b|^leave\s+(?:it|them|the\s+requests?)?\s*(?:alone|unchanged|as[- ]is)\b|^skip\s+(?:it|them)?$/i;

/** Pinned to nlParser.ts matchControls (detection only — no control values are extracted here). */
const CONTROL_RES: RegExp[] = [
  /\bshadow\s+mode\b/,
  /\blive\s+mode\b/,
  /\bonce\s+per\s+request\b/,
  /\bone\s+per\s+request\b/,
  /\bper\s+request\b/,
  /\b(?:arm|activate|enable)\b(?:\s+live\s+actions|\s+this\s+rule|\s+the\s+rule|\s+rule)?\b/,
  /\blive\s+actions\b/,
  /\b(?:cap|limit|at most)\s+(?:at\s+)?\d{1,3}\s+(?:fires?|runs?|executions?)\s+per\s+hour\b/,
  /\b(?:cap|limit|at most)\s+(?:at\s+)?\d{1,3}\s*\/\s*hour\b/,
  /\b\d{1,3}\s+(?:fires?|runs?|executions?)\s+per\s+hour\b/,
  /\b\d{1,3}\s*\/\s*hour\b/,
];

/** Pinned to nlParser.ts matchOutputs' legacy grammar heads (capture bodies dropped). */
const LEGACY_ACTION_RES: RegExp[] = [
  /\b(?:assign|route|escalate|send it|send this)\s+(?:this\s+|it\s+)?to\b/,
  /\b(?:notify|remind)\s+\S/,
  /\b(?:change|set|move)\s+(?:the\s+)?stage\s+to\b/,
  /\badd\s+(?:a\s+)?tag\b/,
  /\bclose\s+(?:the\s+)?request\b/,
];

/** Pinned to nlParser.ts loanAmountRe fallback head ("loan over 500k" phrasing). */
const LOAN_AMOUNT_FALLBACK_RE =
  /\bloan\b(?:\s+amount)?\s+(?:is\s+)?(?:over|above|greater than|more than|at least|under|below|less than|at most|>=|>|<=|<|=)\s+\$?[\d.,]+/;

/** Pinned to nlParser.ts CATEGORY_PATTERNS (detection only). */
const CATEGORY_RES: RegExp[] = [
  /\b(?:any\s+)?(?:business|individual)\s+customers?\b/,
  /\b(?:any\s+)?(?:origination|covenant|loan application)\s+(?:requests?|templates?)\b/,
];

/** Pinned to nlParser.ts isDistinctive() generic list. */
const DISTINCTIVE_GENERIC = ["approved", "rejected", "assigned", "unassigned", "sent", "all", "done"];

/** Pinned to nlParser.ts uncoveredFragments materiality: ≥2 content words, or a digit/$ token. */
function isMaterialText(s: string): boolean {
  const words = s.split(/[^a-z0-9$-]+/).filter((w) => w && !STOPWORDS.has(w));
  return words.length >= 2 || words.some((w) => /\d|\$/.test(w));
}

/* -------------------------------------------------------------------------- */
/* Vocabulary-derived evidence (computed once; deterministic)                 */
/* -------------------------------------------------------------------------- */

/** Word-boundary-safe phrase containment tolerating non-alnum phrase edges ("%", parens). */
function containsPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${escapeRe(phrase)}(?:$|[^a-z0-9])`).test(text);
}

const FIELD_LABELS: string[] = Object.values(FIELDS)
  .map((f) => norm(f.label))
  .filter(Boolean)
  .sort((a, b) => b.length - a.length);

/** Enum options distinctive enough to imply their field (nlParser pass-2 notion). */
const DISTINCTIVE_OPTIONS: string[] = [
  ...new Set(
    Object.values(FIELDS)
      .flatMap((f) => ((f.kind === "enum" || f.kind === "orderedEnum") && f.options ? f.options : []))
      .filter((o) => o.length > 3 && !DISTINCTIVE_GENERIC.includes(o.toLowerCase()))
      .map(norm)
  ),
].sort();

/** Action phrase heads from the vocabulary: label + aliases, text before any {param} slot. */
const ACTION_PHRASES: string[] = [
  ...new Set(
    ACTIONS.flatMap((a) => [a.label, ...(a.aliases ?? [])])
      .map((p) => norm(p).split("{param}")[0].trim())
      .filter(Boolean)
  ),
].sort((a, b) => b.length - a.length);

/** First words of action grammar — split/lead evidence (vocabulary + legacy verbs). */
const ACTION_LEAD_WORDS = new Set<string>([
  ...ACTION_PHRASES.map((p) => p.split(" ")[0]),
  "assign", "route", "escalate", "notify", "remind", "change", "set", "move", "add", "close", "send",
]);

/** Token sets per event (key + aliases); ≥2 exact-token hits = trigger evidence, mirroring
 *  matchEventGeneric's floor (one-word phrases are too hijackable and are ignored there too). */
const EVENT_TOKEN_SETS: string[][] = EVENTS.map((e) => [
  ...new Set([e.key, ...(e.aliases ?? [])].flatMap((p) => norm(p).split(" ").filter(Boolean))),
]);

function hasTriggerEvidence(s: string): boolean {
  if (EVENT_KEYWORD_RE.test(s)) return true;
  const words = new Set(s.split(/[^a-z0-9-]+/).filter(Boolean));
  return EVENT_TOKEN_SETS.some((tokens) => tokens.filter((t) => words.has(t)).length >= 2);
}

function hasActionEvidence(s: string): boolean {
  if (LEGACY_ACTION_RES.some((re) => re.test(s))) return true;
  return ACTION_PHRASES.some((p) => containsPhrase(s, p));
}

const ORDERED_COMPARE_RE = /\b(?:worse|better)\s+than\b/;
const NUMERIC_COMPARE_RE =
  /(?:\bover|\bunder|\babove|\bbelow|\bat\s+least|\bat\s+most|\bgreater\s+than|\bless\s+than|\bmore\s+than|>=|<=|>|<|=)\s*\$?[\d.,]+/;
const MONEY_RE = /\$\s*[\d.,]+|\b[\d.,]+\s*(?:k|m|thousand|million)\b/;

function hasConditionEvidence(s: string): boolean {
  if (FIELD_LABELS.some((l) => containsPhrase(s, l))) return true;
  if (ORDERED_COMPARE_RE.test(s) || NUMERIC_COMPARE_RE.test(s) || MONEY_RE.test(s)) return true;
  if (LOAN_AMOUNT_FALLBACK_RE.test(s)) return true;
  if (CATEGORY_RES.some((re) => re.test(s))) return true;
  return DISTINCTIVE_OPTIONS.some((o) => containsPhrase(s, o));
}

/** Standalone delay clause shapes (nlParser's delay-suffix + remind-anchor grammar). */
const TIMING_RES: RegExp[] = [
  /^(?:after|in)\s+\d{1,4}\s*(?:day|days|hour|hours|minute|minutes|min|mins|week|weeks)$/,
  /^\d{1,4}\s+days?\s+(?:before|after)\b.*$/,
];

/* ---- Unsupported semantics (material, with reason) ------------------------ */

const REASON_SCHEDULE = "recurring schedules are not supported by the rule runtime";
const REASON_LOOP = "repeat-until/escalation loops are not supported by the rule runtime";
const REASON_EXTERNAL = "external decision sources are not supported by the rule runtime";
const REASON_CALENDAR = "business-day calendar math is not supported by the rule runtime";

const WEEKDAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const PERIODS =
  "day|days|morning|mornings|evening|evenings|night|nights|week|weeks|month|months|quarter|quarters|hour|hours|weekday|weekdays|weekend|weekends";

const UNSUPPORTED_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: new RegExp(`\\bevery\\s+(?:${PERIODS}|(?:${WEEKDAYS})s?)\\b`), reason: REASON_SCHEDULE },
  { re: new RegExp(`\\beach\\s+(?:${PERIODS}|(?:${WEEKDAYS})s?)\\b`), reason: REASON_SCHEDULE },
  { re: /\b(?:daily|weekly|monthly|quarterly|nightly|hourly)\b/, reason: REASON_SCHEDULE },
  { re: new RegExp(`\\bon\\s+(?:${WEEKDAYS})s?\\b`), reason: REASON_SCHEDULE },
  { re: /\brecurring\b/, reason: REASON_SCHEDULE },
  { re: /\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/, reason: REASON_SCHEDULE },
  { re: /\bkeep\s+(?:escalating|notifying|reminding|retrying|sending|asking)\b/, reason: REASON_LOOP },
  { re: /\buntil\s.*\brespon/, reason: REASON_LOOP },
  { re: /\bask\s+the\s+credit\s+bureau\b/, reason: REASON_EXTERNAL },
  { re: /\bbusiness\s+days?\b/, reason: REASON_CALENDAR },
];

/* -------------------------------------------------------------------------- */
/* normalizeSource                                                            */
/* -------------------------------------------------------------------------- */

interface BuiltSource {
  source: NormalizedSource;
  /** Raw offset of the char that produced text[i]. */
  rawStart: number[];
  /** Raw offset just past that char (collapsed runs: first raw ws char + 1). */
  rawEnd: number[];
}

function buildNormalized(raw: string): BuiltSource {
  const chars: string[] = [];
  const rawStart: number[] = [];
  const rawEnd: number[] = [];
  let pendingWs = -1;
  let i = 0;
  // Code-point walk so astral pairs lowercase exactly as String#toLowerCase does on the whole
  // string; \s and trim() agree on the JS whitespace set, so skip-runs === replace+trim.
  for (const cp of raw) {
    if (/\s/.test(cp)) {
      if (chars.length > 0 && pendingWs === -1) pendingWs = i;
    } else {
      if (pendingWs !== -1) {
        chars.push(" ");
        rawStart.push(pendingWs);
        rawEnd.push(pendingWs + 1);
        pendingWs = -1;
      }
      const lc = cp.toLowerCase();
      for (let k = 0; k < lc.length; k++) {
        chars.push(lc[k]);
        rawStart.push(i);
        rawEnd.push(i + cp.length);
      }
    }
    i += cp.length;
  }
  const text = chars.join("");
  const toRaw = (normIndex: number): number => {
    if (text.length === 0) return 0;
    if (normIndex <= 0) return rawStart[0];
    if (normIndex >= text.length) return rawEnd[text.length - 1];
    return rawStart[normIndex];
  };
  return { source: { raw, text, toRaw }, rawStart, rawEnd };
}

export function normalizeSource(raw: string): NormalizedSource {
  return buildNormalized(raw).source;
}

/* -------------------------------------------------------------------------- */
/* stableClauseId                                                             */
/* -------------------------------------------------------------------------- */

/** djb2-xor content hash over span + text → "cl-<8 hex>". No Date, no randomness. */
export function stableClauseId(sourceText: string, span: SourceSpan): string {
  let h = 5381;
  const seed = `${span.start}:${span.end}|${sourceText}`;
  for (let i = 0; i < seed.length; i++) {
    h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
  }
  return `cl-${h.toString(16).padStart(8, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Segmentation                                                               */
/* -------------------------------------------------------------------------- */

/** Lane/exception markers stay attached to the START of the clause they introduce. */
const MARKER_RE = /^(?:otherwise|else|unless|except)\b[\s,]*/;

/** Body of a clause with any leading lane/exception marker removed (classification text). */
function stripMarker(s: string): string {
  const m = MARKER_RE.exec(s);
  return m ? s.slice(m[0].length) : s;
}

/** Does this text begin with action grammar (optionally negated / politeness-prefixed)? */
function isActionLed(s: string): boolean {
  const words = s.split(" ");
  let i = 0;
  if (words[i] === "please") i++;
  if (words[i] === "don't" || words[i] === "never" || words[i] === "without") i++;
  else if (words[i] === "do" && words[i + 1] === "not") i += 2;
  return ACTION_LEAD_WORDS.has(words[i] ?? "");
}

/** Would this right-hand side of an " and " stand as its own clause? Conservative by design. */
function startsIndependentClause(s: string): boolean {
  if (!s) return false;
  if (isActionLed(s)) return true;
  if (/^(?:don't|do not|never|without)\b/.test(s)) return true;
  if (
    /^(?:shadow\s+mode|live\s+mode|live\s+actions|once\s+per\s+request|one\s+per\s+request|per\s+request|cap\b|limit\b|arm\b|activate\b|enable\b)/.test(
      s
    )
  ) {
    return true;
  }
  if (/^(?:do\s+nothing|take\s+no\s+action|no\s+action|nothing\b|leave\s|skip\s)/.test(s)) return true;
  if (/^(?:after|in)\s+\d/.test(s) || /^\d{1,4}\s+days?\s+(?:before|after)\b/.test(s)) return true;
  if (/^(?:every|each)\s/.test(s) || /^(?:daily|weekly|monthly|quarterly|recurring)\b/.test(s)) return true;
  if (/^keep\s/.test(s)) return true;
  const afterGate = s.replace(/^(?:if|when)\s+/, "");
  if (FIELD_LABELS.some((l) => afterGate === l || afterGate.startsWith(l + " "))) return true;
  if (LOAN_AMOUNT_FALLBACK_RE.test(afterGate) && afterGate.startsWith("loan")) return true;
  if (CATEGORY_RES.some((re) => new RegExp(`^${re.source.slice(2)}`).test(afterGate))) return true;
  return false;
}

interface Classified {
  kind: ClauseKind;
  negated?: boolean;
  unsupportedReason?: string;
}

function classifyBody(body: string, alternate: boolean, triggerClaimed: boolean): Classified {
  const lane: ClauseKind = alternate ? "action-alternate" : "action-primary";
  // Priority (spec §9): control → no-op → unsupported → trigger (first bearer, never an
  // action-led clause — matchEvent's rule that subject words inside action clauses never
  // define the trigger) → action → condition → timing → unknown. Negation sits just before
  // the trigger check: a prohibition clause is an action-lane statement, never a trigger.
  if (CONTROL_RES.some((re) => re.test(body))) return { kind: "control" };
  if (NOOP_RE.test(body)) return { kind: "no-op" };
  const unsupported = UNSUPPORTED_PATTERNS.find((u) => u.re.test(body));
  if (unsupported) return { kind: "unsupported", unsupportedReason: unsupported.reason };
  if (NEG_RE.test(body)) return { kind: lane, negated: true };
  if (!triggerClaimed && !isActionLed(body) && hasTriggerEvidence(body)) return { kind: "trigger" };
  if (hasActionEvidence(body)) return { kind: lane };
  if (hasConditionEvidence(body)) return { kind: "condition" };
  if (TIMING_RES.some((re) => re.test(body))) return { kind: "timing" };
  return { kind: "unknown" };
}

export function segmentInstruction(raw: string): { source: NormalizedSource; clauses: ParsedClause[] } {
  const { source, rawEnd } = buildNormalized(raw);
  const text = source.text;
  const clauses: ParsedClause[] = [];
  if (!text) return { source, clauses };

  /* ---- 1. Boundary cuts (separator text falls BETWEEN spans) --------------- */
  interface Cut {
    at: number;
    len: number;
  }
  const cuts: Cut[] = [];
  for (const m of text.matchAll(/[,;]/g)) cuts.push({ at: m.index ?? 0, len: 1 });
  // A "." only separates at end of clause (before whitespace or the end) — URLs/decimals survive.
  for (const m of text.matchAll(/\.(?=\s|$)/g)) cuts.push({ at: m.index ?? 0, len: 1 });
  for (const m of text.matchAll(/\bthen\b/g)) cuts.push({ at: m.index ?? 0, len: 4 });
  // Alternate lane starts at the FIRST otherwise/else (nlParser's elseMatch); the marker stays
  // attached to the clause it introduces (zero-length cut).
  const elseM = /\b(?:otherwise|else)\b/.exec(text);
  const elseIdx = elseM ? elseM.index : -1;
  if (elseM) cuts.push({ at: elseM.index, len: 0 });
  for (const m of text.matchAll(/\b(?:unless|except)\b/g)) cuts.push({ at: m.index ?? 0, len: 0 });
  // " and " splits ONLY when the right side starts an independent clause; the region before the
  // first hard boundary (matchEvent's trigger clause) can therefore never be split mid-phrase.
  const hardStops = [...cuts.map((c) => c.at), text.length].sort((a, b) => a - b);
  for (const m of text.matchAll(/\band\b/g)) {
    const at = m.index ?? 0;
    const stop = hardStops.find((p) => p > at) ?? text.length;
    const right = text.slice(at + 3, stop).replace(/^[\s,]+/, "");
    if (startsIndependentClause(right)) cuts.push({ at, len: 3 });
  }
  cuts.sort((a, b) => a.at - b.at || b.len - a.len);

  /* ---- 2. Segments between cuts, edge-trimmed of separator punctuation ----- */
  const segs: Array<{ start: number; end: number }> = [];
  const pushSeg = (start: number, end: number) => {
    let s = start;
    let e = end;
    while (s < e && " .,;".includes(text[s])) s++;
    while (e > s && " .,;".includes(text[e - 1])) e--;
    if (s < e) segs.push({ start: s, end: e });
  };
  let cursor = 0;
  for (const c of cuts) {
    if (c.at < cursor) {
      cursor = Math.max(cursor, c.at + c.len);
      continue;
    }
    pushSeg(cursor, c.at);
    cursor = c.at + c.len;
  }
  pushSeg(cursor, text.length);

  /* ---- 3. Action if/when gates → action clause + action-guard clause ------- */
  const pieces: Array<{ start: number; end: number; guard: boolean }> = [];
  for (const seg of segs) {
    const clauseText = text.slice(seg.start, seg.end);
    const markerM = MARKER_RE.exec(clauseText);
    const bodyStart = seg.start + (markerM ? markerM[0].length : 0);
    const body = text.slice(bodyStart, seg.end);
    let split = false;
    if (isActionLed(body)) {
      const gate = /\s(?:if|when)\s/.exec(body);
      if (gate && gate.index > 0 && gate.index + gate[0].length < body.length) {
        const gateAt = bodyStart + gate.index;
        let leftEnd = gateAt;
        while (leftEnd > seg.start && " .,;".includes(text[leftEnd - 1])) leftEnd--;
        if (leftEnd > seg.start) {
          pieces.push({ start: seg.start, end: leftEnd, guard: false });
          pieces.push({ start: gateAt + 1, end: seg.end, guard: true });
          split = true;
        }
      }
    }
    if (!split) pieces.push({ start: seg.start, end: seg.end, guard: false });
  }

  /* ---- 4. Classify in reading order (trigger = earliest evidence bearer) ---- */
  let triggerClaimed = false;
  for (const piece of pieces) {
    const clauseText = text.slice(piece.start, piece.end);
    const alternate = elseIdx >= 0 && piece.start >= elseIdx;
    let kind: ClauseKind;
    let negated: boolean | undefined;
    let unsupportedReason: string | undefined;
    if (piece.guard) {
      kind = "action-guard";
    } else {
      const body = stripMarker(clauseText);
      const c = classifyBody(body, alternate, triggerClaimed);
      kind = c.kind;
      negated = c.negated;
      unsupportedReason = c.unsupportedReason;
      if (kind === "trigger") triggerClaimed = true;
    }
    const span: SourceSpan = { start: piece.start, end: piece.end };
    // Classified clauses are material by construction (a recognized, intentional statement —
    // incl. the explicit no-op); the fragment materiality formula applies to "unknown" only.
    const material = kind === "unknown" ? isMaterialText(clauseText) : true;
    const clause: ParsedClause = {
      id: stableClauseId(text, span),
      span,
      rawSpan: {
        start: source.toRaw(span.start),
        end: span.end > span.start ? rawEnd[span.end - 1] : source.toRaw(span.start),
      },
      text: clauseText,
      kind,
      material,
    };
    if (negated) clause.negated = true;
    if (unsupportedReason !== undefined) clause.unsupportedReason = unsupportedReason;
    clauses.push(clause);
  }

  return { source, clauses };
}
