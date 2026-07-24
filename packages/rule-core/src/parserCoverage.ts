/**
 * parserCoverage — deterministic clause→rule projection + coverage accounting.
 *
 * Answers two honesty questions no confidence score can:
 * 1. Is every material clause the author wrote ACCOUNTED FOR in the parse —
 *    represented in the rule, an intentional no-op, an open question
 *    (unresolved/ambiguous), or an explicit unsupported/uncovered flag? A
 *    clause that silently vanished (`materialUnaccounted`) is the failure
 *    mode that must block readiness.
 * 2. Does every rule component trace back to SOME clause the author wrote?
 *    A path no clause claims (`fabricated`) means the engine invented policy —
 *    impossible for the deterministic parser (pinned by tests), and exactly
 *    the trap that catches AI candidates in Wave 2.
 *
 * Projection is evidence re-projection, not a second parse: each rule
 * component derives distinctive evidence tokens from the vocabulary (event
 * words + parser alias families, field labels + operator families + value
 * labels, action verbs + param labels + delay phrases, control phrase
 * families), and a clause links to a component when it carries that evidence.
 * Components are claimed once each (no double-claiming), candidates resolve
 * first-match-wins in reading order, and a clause may claim several components
 * (a trigger clause with dual events, a fused trigger+condition clause).
 * `result.consumed` spans, when present, strengthen ties: a candidate whose
 * evidence sits inside a consumed span is preferred over one whose evidence
 * the parser never actually used.
 *
 * Both clauses and result MUST come from the same input text: clause spans and
 * consumed spans index the same normalized string (norm ≡ normalizeSource).
 * Deterministic on purpose — no clock, no randomness, same input → same output.
 */
import type { ParseResult } from "./nlParser";
import type { ClauseRuleLink } from "./parserProvenance";
import type { ParsedClause } from "./parserClauses";
import {
  ConditionGroup,
  ConditionLeaf,
  RuleOutput,
  WorkflowRule,
  condFieldLabel,
  condFieldKind,
  defaultControls,
  getAction,
  getEvent,
  isGroup,
  opLabel,
  paramKeyFor,
  scopeLabel,
} from "./vocabulary";

/* -------------------------------------------------------------------------- */
/* Text helpers (mirror the parser's normalization semantics)                 */
/* -------------------------------------------------------------------------- */

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Index of `word` as a whole word in `text`, or -1. */
function wordIndex(text: string, word: string): number {
  const m = new RegExp(`\\b${escapeRe(word)}\\b`).exec(text);
  return m ? m.index : -1;
}

/** Index of a multi-word phrase bounded by non-alphanumerics, or -1. */
function phraseIndex(text: string, phrase: string): number {
  const m = new RegExp(`(?:^|[^a-z0-9])(${escapeRe(phrase)})(?:$|[^a-z0-9])`).exec(text);
  return m ? m.index + m[0].indexOf(m[1]) : -1;
}

function wordsOf(s: string): string[] {
  return s.match(/[a-z0-9][a-z0-9-]*/g) ?? [];
}

/** Pinned to nlParser's STOPWORDS (connector/noise words carry no evidence weight). */
const STOPWORDS = new Set([
  "when", "if", "then", "and", "or", "the", "a", "an", "is", "are", "to", "it",
  "this", "that", "there", "on", "for", "of", "with", "in", "fires", "please",
]);

/** Pinned to nlParser's isDistinctive(): a value implying its field without naming it. */
const GENERIC_VALUES = ["approved", "rejected", "assigned", "unassigned", "sent", "all", "done"];

function isDistinctiveValue(label: string): boolean {
  return label.length > 3 && !GENERIC_VALUES.includes(label);
}

/** Group an integer's digits with commas ("250000" → "250,000"), deterministic. */
function withCommas(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Surface variants an author may have written for a value label ("250000" → "250k"). */
function valueVariants(label: string): string[] {
  const out = [label];
  if (/^\d+$/.test(label)) {
    const n = Number(label);
    if (Number.isFinite(n) && n > 0) {
      if (n % 1000000 === 0) out.push(`${n / 1000000}m`, `${n / 1000000} million`);
      else if (n % 1000 === 0) out.push(`${n / 1000}k`, `${n / 1000} thousand`);
      if (label.length > 3) out.push(withCommas(label), `$${withCommas(label)}`);
    }
  }
  return out;
}

/** Delay phrases for a minute count: every exact unit division, singular + plural. */
function delayVariants(delayMinutes: number): string[] {
  const abs = Math.abs(delayMinutes);
  const out: string[] = [];
  const units: Array<[number, string]> = [[10080, "week"], [1440, "day"], [60, "hour"], [1, "minute"]];
  for (const [size, unit] of units) {
    if (abs >= size && abs % size === 0) out.push(`${abs / size} ${unit}s`, `${abs / size} ${unit}`);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Evidence: triggers                                                         */
/* -------------------------------------------------------------------------- */

/** Subject nouns too common to identify an event alone. */
const GENERIC_SUBJECTS = new Set([
  "loan", "document", "offer", "request", "system", "application", "upload", "status", "booking",
]);

/** Verb families the parser's own event heuristics accept, keyed off the event key. */
function eventVerbFamily(key: string): string[] {
  if (key === "SYSTEM ERROR") return ["error", "failed", "failure"];
  if (key === "OFFER ACCEPTED") return ["offer", "accept", "accepts", "accepted", "approved"];
  if (key === "CHECKLIST COMPLETED") return ["checklist", "complete"];
  if (key.endsWith("APPROVED")) return ["approved", "approval", "accepted"];
  if (key.endsWith("REJECTED")) return ["rejected", "denied", "declined"];
  return [];
}

interface TriggerEvidence {
  all: string[];
  distinctive: string[];
}

function triggerEvidence(eventKey: string): TriggerEvidence {
  const def = getEvent(eventKey);
  const all = [
    ...new Set(
      [eventKey, ...(def?.aliases ?? [])]
        .flatMap((p) => wordsOf(norm(p)))
        .concat(eventVerbFamily(eventKey))
    ),
  ];
  const distinctive = all.filter((w) => w.length >= 4 && !GENERIC_SUBJECTS.has(w));
  return { all, distinctive };
}

/** ≥2 evidence words, or one distinctive word, place a trigger in a clause. */
function matchTrigger(text: string, ev: TriggerEvidence): number {
  const hits = ev.all.map((w) => wordIndex(text, w)).filter((i) => i >= 0);
  const distinctiveHit = ev.distinctive.map((w) => wordIndex(text, w)).find((i) => i >= 0);
  if (distinctiveHit !== undefined) return distinctiveHit;
  if (hits.length >= 2) return Math.min(...hits);
  return -1;
}

/* -------------------------------------------------------------------------- */
/* Evidence: condition leaves                                                 */
/* -------------------------------------------------------------------------- */

/** Operator words the parser's grammar accepts, beyond the canonical opLabel. */
const OPERATOR_SYNONYMS: Record<string, string[]> = {
  gt: ["over", "above", "greater", "more", ">"],
  gte: ["least", ">="],
  lt: ["under", "below", "less", "<"],
  lte: ["most", "<="],
  worse_than: ["worse"],
  better_than: ["better"],
  is_not: ["not", "isn't"],
  contains: ["contains"],
  is_empty: ["empty"],
  is_not_empty: ["empty"],
};

/**
 * Link rule for a condition leaf: the VALUE words (strongest evidence — with
 * field words too when the value is short/generic), OR the field-label words
 * plus an operator-family word.
 */
function matchConditionLeaf(text: string, leaf: ConditionLeaf): number {
  const fieldLabel = norm(condFieldLabel(leaf.field));
  const fieldWords = wordsOf(fieldLabel);
  const fieldAt = fieldWords.length ? fieldWords.map((w) => wordIndex(text, w)) : [];
  const fieldAll = fieldAt.length > 0 && fieldAt.every((i) => i >= 0);

  const valueLabel = norm(scopeLabel(leaf.value));
  if (valueLabel) {
    for (const variant of valueVariants(valueLabel)) {
      const at = phraseIndex(text, variant);
      if (at < 0) continue;
      if (isDistinctiveValue(variant) || fieldAll) return at;
    }
  }

  const family = [
    ...wordsOf(norm(opLabel(condFieldKind(leaf.field), leaf.operator))).filter((w) => !STOPWORDS.has(w) || w === "is"),
    ...(OPERATOR_SYNONYMS[leaf.operator] ?? []),
  ];
  if (fieldAll && (family.length === 0 || family.some((w) => wordIndex(text, w) >= 0))) {
    return Math.min(...fieldAt);
  }
  return -1;
}

/* -------------------------------------------------------------------------- */
/* Evidence: actions                                                          */
/* -------------------------------------------------------------------------- */

const PHRASE_STOPWORDS = new Set(["to", "the", "a", "an", "for", "from", "it", "this", "into"]);

/** Legacy grammar verbs nlParser accepts for its dedicated action matchers. */
const LEGACY_ACTION_PHRASES: Record<string, string[][]> = {
  assign_user: [["assign"], ["route"], ["escalate"], ["send"]],
  assign_authority: [["assign"], ["route"], ["escalate"], ["send"]],
  notify: [["notify"], ["remind"]],
  change_stage: [["change", "stage"], ["set", "stage"], ["move", "stage"]],
  add_tag: [["add", "tag"]],
  close_request: [["close", "request"]],
};

/** Evidence token sets for an action key: vocabulary label/aliases + legacy verbs. */
function actionPhraseSets(actionKey: string): string[][] {
  const def = getAction(actionKey);
  const sets: string[][] = [];
  const sources = def ? [def.label, ...(def.aliases ?? [])] : [actionKey.replace(/_/g, " ")];
  for (const raw of sources) {
    const tokens = norm(raw.replace("{param}", " "))
      .split(" ")
      .filter((w) => w && !PHRASE_STOPWORDS.has(w));
    if (tokens.length) sets.push(tokens);
  }
  for (const tokens of LEGACY_ACTION_PHRASES[actionKey] ?? []) sets.push(tokens);
  return sets;
}

/** Link rule for an action: a full verb-phrase token set, plus the param label when resolved. */
function matchAction(text: string, output: RuleOutput): number {
  const paramLabel = norm(scopeLabel(output.params[paramKeyFor(output.action)]));
  const paramAt = paramLabel ? phraseIndex(text, paramLabel) : -1;
  if (paramLabel && paramAt < 0) return -1;
  for (const tokens of actionPhraseSets(output.action)) {
    const at = tokens.map((w) => wordIndex(text, w));
    if (at.every((i) => i >= 0)) return paramAt >= 0 ? paramAt : Math.min(...at);
  }
  return -1;
}

/** Link rule for an action's gate: any of the gate's leaves places it. */
function matchGate(text: string, gate: ConditionGroup): number {
  for (const child of gate.children) {
    const at = isGroup(child) ? matchGate(text, child) : matchConditionLeaf(text, child);
    if (at >= 0) return at;
  }
  return -1;
}

/* -------------------------------------------------------------------------- */
/* Components — every rule path that needs a claiming clause                  */
/* -------------------------------------------------------------------------- */

type KindTier = ReadonlySet<ParsedClause["kind"]>;

const TRIGGER_KINDS: KindTier = new Set(["trigger"]);
const CONDITION_KINDS: KindTier = new Set(["condition", "action-guard"]);
const THEN_KINDS: KindTier = new Set(["action-primary"]);
const GUARD_KINDS: KindTier = new Set(["action-guard"]);
const TIMING_KINDS: KindTier = new Set(["timing"]);
const ELSE_KINDS: KindTier = new Set(["action-alternate", "no-op"]);
const CONTROL_KINDS: KindTier = new Set(["control"]);

interface Component {
  path: string;
  preferredKinds: KindTier;
  /** Relative evidence anchor in the clause text, or -1 when the clause lacks the evidence. */
  match(text: string): number;
}

function laneComponents(lane: "actions" | "else", outputs: RuleOutput[], preferred: KindTier): Component[] {
  const out: Component[] = [];
  outputs.forEach((output, i) => {
    out.push({ path: `${lane}[${i}]`, preferredKinds: preferred, match: (t) => matchAction(t, output) });
    if (output.when) {
      const gate = output.when;
      out.push({ path: `${lane}[${i}].when`, preferredKinds: GUARD_KINDS, match: (t) => matchGate(t, gate) });
    }
    if (output.delayMinutes) {
      const variants = delayVariants(output.delayMinutes);
      out.push({
        path: `${lane}[${i}].delayMinutes`,
        preferredKinds: TIMING_KINDS,
        match: (t) => {
          for (const v of variants) {
            const at = phraseIndex(t, v);
            if (at >= 0) return at;
          }
          return -1;
        },
      });
    }
  });
  return out;
}

/** Control phrase families (non-default controls only — defaults are implicit, never fabricated). */
function controlComponents(rule: WorkflowRule): Component[] {
  const defaults = defaultControls();
  const out: Component[] = [];
  const wordFamily = (path: string, words: string[]): Component => ({
    path,
    preferredKinds: CONTROL_KINDS,
    match: (t) => {
      for (const w of words) {
        const at = wordIndex(t, w);
        if (at >= 0) return at;
      }
      return -1;
    },
  });
  if (rule.controls.mode !== defaults.mode) {
    out.push(wordFamily("controls.mode", ["arm", "arms", "armed", "activate", "enable", "live"]));
  }
  if (rule.controls.oncePerRequest !== defaults.oncePerRequest) {
    out.push(wordFamily("controls.oncePerRequest", ["once", "per"]));
  }
  if (rule.controls.maxFiresPerHour !== defaults.maxFiresPerHour) {
    const n = String(rule.controls.maxFiresPerHour);
    out.push({
      path: "controls.maxFiresPerHour",
      preferredKinds: CONTROL_KINDS,
      match: (t) => {
        const nAt = wordIndex(t, n);
        return nAt >= 0 && wordIndex(t, "hour") >= 0 ? nAt : -1;
      },
    });
  }
  return out;
}

/** All components of a rule, in deterministic reading order of the rule shape. */
function buildComponents(rule: WorkflowRule): Component[] {
  const out: Component[] = [];
  rule.triggers.forEach((trigger, i) => {
    const ev = triggerEvidence(trigger.event);
    out.push({ path: `triggers[${i}]`, preferredKinds: TRIGGER_KINDS, match: (t) => matchTrigger(t, ev) });
  });
  const leaves: ConditionLeaf[] = [];
  const collect = (group: ConditionGroup) => {
    for (const child of group.children) {
      if (isGroup(child)) collect(child);
      else leaves.push(child);
    }
  };
  collect(rule.conditions);
  leaves.forEach((leaf, i) => {
    out.push({
      path: `conditions.leaf[${i}]`,
      preferredKinds: CONDITION_KINDS,
      match: (t) => matchConditionLeaf(t, leaf),
    });
  });
  out.push(...laneComponents("actions", rule.actions, THEN_KINDS));
  out.push(...laneComponents("else", rule.else ?? [], ELSE_KINDS));
  out.push(...controlComponents(rule));
  return out;
}

/* -------------------------------------------------------------------------- */
/* Status inputs from the ParseResult sidecars                                */
/* -------------------------------------------------------------------------- */

/** The parser's own negation grammar; the clause layer marks the same clauses `negated`. */
const NEGATION_RE = /\b(?:don't|do not|never|without)\b/;

function isNegatedClause(clause: ParsedClause): boolean {
  const flagged = (clause as ParsedClause & { negated?: boolean }).negated;
  if (typeof flagged === "boolean") return flagged;
  return NEGATION_RE.test(norm(clause.text));
}

function containsUnresolvedHeard(text: string, result: ParseResult): boolean {
  return result.unresolved.some((slot) => {
    const heard = norm(slot.heard);
    return heard.length > 0 && text.includes(heard);
  });
}

/** A clause carries an ambiguity's evidence when it matches one of the offered readings. */
function matchesAmbiguity(text: string, result: ParseResult): boolean {
  return result.ambiguities.some((amb) =>
    amb.options.some((option) => matchTrigger(text, triggerEvidence(option)) >= 0)
  );
}

/** Is this absolute offset inside any consumed span? */
function isConsumedAt(consumed: Array<[number, number]> | undefined, at: number): boolean {
  return !!consumed?.some(([s, e]) => at >= s && at < e);
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                 */
/* -------------------------------------------------------------------------- */

interface Projection {
  links: ClauseRuleLink[];
  fabricated: string[];
}

function project(clauses: ParsedClause[], result: ParseResult): Projection {
  const pathsByClause = new Map<string, string[]>();
  for (const clause of clauses) pathsByClause.set(clause.id, []);

  // Negated clauses are accounted-for by EXCLUSION (the parser noted the
  // prohibition); they claim nothing so the prohibited action can never look
  // represented through them.
  const claimable = clauses
    .map((clause, order) => ({ clause, order, text: norm(clause.text) }))
    .filter((c) => c.clause.material && !isNegatedClause(c.clause));

  const fabricated: string[] = [];
  const components = result.rule ? buildComponents(result.rule) : [];
  for (const component of components) {
    let claimed = false;
    const tiers: Array<typeof claimable> = [
      claimable.filter((c) => component.preferredKinds.has(c.clause.kind)),
      claimable,
    ];
    for (const tier of tiers) {
      const candidates = tier
        .map((c) => ({ ...c, at: component.match(c.text) }))
        .filter((c) => c.at >= 0);
      if (!candidates.length) continue;
      // Consumed spans strengthen the tie-break: evidence the parser actually
      // consumed beats evidence it never used; then reading order decides.
      const confirmed = candidates.find((c) =>
        isConsumedAt(result.consumed, c.clause.span.start + c.at)
      );
      const winner = confirmed ?? candidates[0];
      pathsByClause.get(winner.clause.id)?.push(component.path);
      claimed = true;
      break;
    }
    if (!claimed) fabricated.push(component.path);
  }

  const links: ClauseRuleLink[] = clauses.map((clause) => {
    const rulePaths = pathsByClause.get(clause.id) ?? [];
    const text = norm(clause.text);
    let status: ClauseRuleLink["status"];
    if (isNegatedClause(clause) || clause.kind === "no-op") status = "no-op";
    else if (clause.kind === "unsupported") status = "unsupported";
    else if (containsUnresolvedHeard(text, result)) status = "unresolved";
    else if (result.rule === null && matchesAmbiguity(text, result)) status = "ambiguous";
    else if (rulePaths.length > 0) status = "represented";
    // No links and no other disposition: whether the parser listed the text in
    // `uncovered` or derived nothing at all (unknown clause), it fell on the
    // floor — the status that feeds materialUnaccounted.
    else status = "uncovered";
    return { clauseId: clause.id, rulePaths, status };
  });

  return { links, fabricated };
}

/**
 * Deterministic evidence re-projection of segmented clauses onto a parse
 * result. One ClauseRuleLink per clause, in clause (reading) order; a
 * component is claimed by at most one clause; `contradictory` is left to the
 * envelope assembler, which owns contradiction findings.
 */
export function projectClausesOntoRule(clauses: ParsedClause[], result: ParseResult): ClauseRuleLink[] {
  return project(clauses, result).links;
}

export interface ClauseCoverageReport {
  links: ClauseRuleLink[];
  /** Material clause ids the parse SILENTLY dropped — must be empty for readiness. */
  materialUnaccounted: string[];
  /** Rule paths no clause claims — deterministic parses never fabricate; AI candidates might. */
  fabricated: string[];
}

/**
 * Full coverage accounting. "Accounted" is deliberately broad: represented,
 * no-op, unresolved, ambiguous, and unsupported clauses all have an honest
 * disposition (the open ones block readiness through their own sidecars);
 * unaccounted means the clause fell on the floor with no signal anywhere.
 */
export function clauseCoverage(clauses: ParsedClause[], result: ParseResult): ClauseCoverageReport {
  const { links, fabricated } = project(clauses, result);
  const byId = new Map(links.map((l) => [l.clauseId, l]));
  const materialUnaccounted = clauses
    .filter((c) => c.material && byId.get(c.id)?.status === "uncovered")
    .map((c) => c.id);
  return { links, materialUnaccounted, fabricated };
}
