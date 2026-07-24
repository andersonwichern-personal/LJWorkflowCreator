/**
 * candidateNormalization — the client-side last line of defense for AI parse candidates.
 *
 * Doctrine: MODEL OUTPUT IS UNTRUSTED INPUT. A transport candidate is reviewed the way a
 * hostile payload is reviewed — structural gate, bounds, enum allowlists against the
 * VocabularySnapshot, entity re-grounding, URL safety, semantic coverage, then the same
 * validator/linter every hand-authored rule passes. The pipeline fails closed: anything it
 * cannot prove safe is either converted into an honest gap (UnresolvedSlot / ambiguity /
 * uncovered — the parse gate blocks on those) or rejected outright. It never invents intent,
 * never lets a model omission look complete, and never lets a model arm a rule.
 *
 * Every transformation is recorded as a short slug in `repairs`, so an accepted candidate
 * with `repairs: []` is byte-honest: the pipeline changed nothing. Deterministic throughout —
 * no clock, no randomness, no host APIs; same input, same verdict.
 *
 * Repair-slug catalog:
 *   "parsed-fenced-json"            string candidate: fences stripped, JSON parsed
 *   "dropped-unknown-keys"          top-level keys outside the ParseEnvelope set removed
 *   "dropped-engine-sidecars"       engine-authored envelope fields (provenance, clauses…) a
 *                                   candidate may not assert about itself removed
 *   "dropped-malformed-entries"     non-conforming sidecar entries removed
 *   "clamped-bounds"                array/string length clamped to the documented budgets
 *   "sanitized-strings"             control / zero-width / bidi codepoints stripped
 *   "normalized-rule-shape"         normalizeRule (+ logic-case fix) changed the rule bytes
 *   "disarmed-model-output"         controls.mode "armed" forced back to "shadow"
 *   "unresolved-ungrounded-entity"  ungrounded value blanked into an UnresolvedSlot
 *   "regrounded-instance-id"        fabricated instance id replaced by the registry-backed one
 *   "blanked-fabricated-instance-id" instance ref with no registry backing blanked to a slot
 *   "ambiguated-duplicate-label"    duplicate registry label converted to a clarification
 *   "unsafe-url-param"              non-https / private / IP-literal URL param blanked to a slot
 *   "surfaced-dropped-clause"       clause the model omitted appended to `uncovered`
 */
import type {
  ParseAmbiguity,
  ParseOptions,
  ParseResult,
  UnresolvedSlot,
} from "../../rule-core/src/nlParser";
import type { ParsedClause } from "../../rule-core/src/parserClauses";
import {
  staticVocabularySnapshot,
  stableVocabularyHash,
  groundRule,
  groundValue,
} from "../../rule-core/src/parserGrounding";
import type { GroundingVerdict, VocabularySnapshot } from "../../rule-core/src/parserGrounding";
import {
  condFieldKind,
  isFormFieldRef,
  isScopeRef,
  normalizeRule,
  walkLeaves,
} from "../../rule-core/src/vocabulary";
import type {
  ConditionLeaf,
  RuleOutput,
  ScopeRef,
  ScopeValue,
  WorkflowRule,
} from "../../rule-core/src/vocabulary";
import { validateRule } from "../../rule-core/src/ruleValidation";
import { hasBlockingIssues, lintRuleIssues } from "../../rule-core/src/ruleLinter";
import { isParseEnvelope } from "../../rule-core/src/parserProvenance";
import type { ParseEnvelope } from "../../rule-core/src/parserProvenance";
import type { BrainContextSnapshot } from "./context";

/* -------------------------------------------------------------------------- */
/* Frozen API                                                                 */
/* -------------------------------------------------------------------------- */

export interface CandidateReviewInput {
  /** The transport candidate. HOSTILE until this review accepts it. */
  candidate: unknown;
  sourceText: string;
  clauses?: ParsedClause[];
  vocab: VocabularySnapshot;
  baseOptions: ParseOptions;
  deterministic: ParseResult;
  /**
   * Injected clause-coverage fn (rule-core parserCoverage.clauseCoverage once landed);
   * optional so callers without clauses skip the check.
   */
  coverage?: (
    clauses: ParsedClause[],
    result: ParseResult,
  ) => { materialUnaccounted: string[]; fabricated: string[] };
}

export type CandidateVerdict =
  | { accepted: true; result: ParseResult; repairs: string[] }
  | { accepted: false; structural: boolean; reason: string };

/* -------------------------------------------------------------------------- */
/* Budgets (backend contract mirrors these server-side)                       */
/* -------------------------------------------------------------------------- */

const MAX_NOTES = 20;
const NOTE_CHARS = 400;
const MAX_UNCOVERED = 50;
const UNCOVERED_CHARS = 300;
const MAX_UNRESOLVED = 50;
const MAX_AMBIGUITIES = 10;
const MAX_AMBIGUITY_OPTIONS = 10;
const AMBIGUITY_OPTION_CHARS = 120;
const AMBIGUITY_QUESTION_CHARS = 400;
const MAX_SUGGESTIONS = 3;
const SUGGESTION_CHARS = 120;
const HEARD_CHARS = 300;
const MAX_CONSUMED_SPANS = 500;
const MAX_RULE_JSON_CHARS = 100_000;
const REASON_KEY_CHARS = 80;

/** ParseResult keys a candidate may legitimately carry. */
const RESULT_KEYS = new Set([
  "rule",
  "notes",
  "unresolved",
  "uncovered",
  "ambiguities",
  "unbacked",
  "consumed",
  "suggestions",
]);

/**
 * Envelope fields only the ENGINE may author (provenance, clause links…). A candidate
 * asserting them would be lying about who produced what — dropped, never passed through.
 */
const ENGINE_SIDECAR_KEYS = new Set([
  "clauses",
  "clauseLinks",
  "unsupported",
  "contradictions",
  "negatedNoOps",
  "provenance",
]);

/* -------------------------------------------------------------------------- */
/* Small deterministic helpers                                                */
/* -------------------------------------------------------------------------- */

/** Ordered, deduped repair recorder. */
interface Repairs {
  list: string[];
  add(slug: string): void;
}
function makeRepairs(): Repairs {
  const seen = new Set<string>();
  const list: string[] = [];
  return {
    list,
    add(slug: string) {
      if (!seen.has(slug)) {
        seen.add(slug);
        list.push(slug);
      }
    },
  };
}

/**
 * C0/C1 controls (except \n and \t), zero-width and joiner codepoints, bidi marks,
 * overrides and isolates, word joiners, BOM. These are the invisible-text attack
 * surface (homoglyph names stay visible and are handled by grounding instead).
 */
const HOSTILE_CODEPOINTS_RE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

function stripHostile(text: string): string {
  return text.replace(HOSTILE_CODEPOINTS_RE, "");
}

/** Case/whitespace-insensitive comparison key (mirrors parserGrounding's normLabel). */
function normLabel(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Canonical JSON (sorted keys, undefined dropped) — byte-stable structural equality. */
function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${body.join(",")}}`;
}

/** Sanitized, clamped key for embedding in a rejection reason (already-rejected text). */
function reasonKey(text: string): string {
  return stripHostile(text).slice(0, REASON_KEY_CHARS);
}

function reject(structural: boolean, reason: string): CandidateVerdict {
  return { accepted: false, structural, reason };
}

/* -------------------------------------------------------------------------- */
/* vocabFromContext                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Project a BrainContextSnapshot onto the VocabularySnapshot the reviewer grounds
 * against: the static vocabulary merged with the snapshot's live overlays, using the
 * SAME semantics the deterministic parser applies to ParseOptions (a non-empty live
 * list replaces the static list for that key; empty overlays fall back), then
 * re-hashed. Reviewer and parser therefore agree on what exists — an honest
 * deterministic result re-reviewed here re-grounds cleanly.
 */
export function vocabFromContext(snapshot: BrainContextSnapshot): VocabularySnapshot {
  const base = staticVocabularySnapshot();
  const instanceOptions: Record<string, string[]> = { ...base.instanceOptions };
  for (const [key, list] of Object.entries(snapshot.instanceOptions ?? {})) {
    if (Array.isArray(list) && list.length > 0) instanceOptions[key] = [...list];
  }
  const instanceRegistry: Record<string, { id: string; label: string }[]> = {};
  for (const [key, entries] of Object.entries(snapshot.instanceRegistry ?? {})) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    instanceRegistry[key] = entries
      .filter((entry) => typeof entry?.id === "string" && typeof entry?.label === "string")
      .map((entry) => ({ id: entry.id, label: entry.label }));
  }
  const assignees =
    Array.isArray(snapshot.assignees) && snapshot.assignees.length > 0
      ? [...snapshot.assignees]
      : base.assignees;
  const body: Omit<VocabularySnapshot, "hash"> = {
    events: base.events,
    fields: base.fields,
    actions: base.actions,
    operatorsByKind: base.operatorsByKind,
    instanceOptions,
    instanceRegistry,
    assignees,
    source: `brain-context:${snapshot.profile}`,
    version: snapshot.snapshotId,
  };
  return { ...body, hash: stableVocabularyHash(body) };
}

/* -------------------------------------------------------------------------- */
/* Step 1 — string input                                                      */
/* -------------------------------------------------------------------------- */

/** Donor stripJsonFence lesson: models wrap JSON in markdown fences. */
function stripJsonFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Step 3 — deep sanitize + sidecar bounds                                    */
/* -------------------------------------------------------------------------- */

/** Deep copy with every string (keys included) stripped of hostile codepoints. */
function deepSanitize(value: unknown, repairs: Repairs): unknown {
  if (typeof value === "string") {
    const clean = stripHostile(value);
    if (clean !== value) repairs.add("sanitized-strings");
    return clean;
  }
  if (Array.isArray(value)) return value.map((item) => deepSanitize(item, repairs));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const cleanKey = stripHostile(key);
      if (cleanKey !== key) repairs.add("sanitized-strings");
      out[cleanKey] = deepSanitize(item, repairs);
    }
    return out;
  }
  return value;
}

function clampString(text: string, maxChars: number, repairs: Repairs): string {
  if (text.length > maxChars) {
    repairs.add("clamped-bounds");
    return text.slice(0, maxChars);
  }
  return text;
}

function boundStringArray(
  raw: unknown,
  maxItems: number,
  maxChars: number,
  repairs: Repairs,
): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const strings = arr.filter((item): item is string => typeof item === "string");
  if (strings.length !== arr.length) repairs.add("dropped-malformed-entries");
  const kept = strings.length > maxItems ? strings.slice(0, maxItems) : strings;
  if (kept.length !== strings.length) repairs.add("clamped-bounds");
  return kept.map((item) => clampString(item, maxChars, repairs));
}

const SLOT_WHERE = new Set(["action-param", "condition-value", "event"]);

function isBoundedIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000;
}

function boundUnresolved(raw: unknown, repairs: Repairs): UnresolvedSlot[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: UnresolvedSlot[] = [];
  let dropped = false;
  for (const item of arr) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      dropped = true;
      continue;
    }
    const slot = item as Record<string, unknown>;
    if (
      typeof slot.where !== "string" ||
      !SLOT_WHERE.has(slot.where) ||
      typeof slot.heard !== "string"
    ) {
      dropped = true;
      continue;
    }
    const clean: UnresolvedSlot = {
      where: slot.where as UnresolvedSlot["where"],
      heard: clampString(slot.heard, HEARD_CHARS, repairs),
      suggestions: boundStringArray(slot.suggestions, MAX_SUGGESTIONS, SUGGESTION_CHARS, repairs),
    };
    if (slot.lane === "then" || slot.lane === "else") clean.lane = slot.lane;
    if (isBoundedIndex(slot.actionIndex)) clean.actionIndex = slot.actionIndex;
    if (isBoundedIndex(slot.conditionIndex)) clean.conditionIndex = slot.conditionIndex;
    if (typeof slot.param === "string") clean.param = clampString(slot.param, HEARD_CHARS, repairs);
    out.push(clean);
  }
  if (dropped) repairs.add("dropped-malformed-entries");
  if (out.length > MAX_UNRESOLVED) {
    repairs.add("clamped-bounds");
    return out.slice(0, MAX_UNRESOLVED);
  }
  return out;
}

function boundAmbiguities(raw: unknown, repairs: Repairs): ParseAmbiguity[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: ParseAmbiguity[] = [];
  let dropped = false;
  for (const item of arr) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      dropped = true;
      continue;
    }
    const amb = item as Record<string, unknown>;
    if (typeof amb.question !== "string" || !Array.isArray(amb.options)) {
      dropped = true;
      continue;
    }
    out.push({
      question: clampString(amb.question, AMBIGUITY_QUESTION_CHARS, repairs),
      options: boundStringArray(
        amb.options,
        MAX_AMBIGUITY_OPTIONS,
        AMBIGUITY_OPTION_CHARS,
        repairs,
      ),
    });
  }
  if (dropped) repairs.add("dropped-malformed-entries");
  if (out.length > MAX_AMBIGUITIES) {
    repairs.add("clamped-bounds");
    return out.slice(0, MAX_AMBIGUITIES);
  }
  return out;
}

/** Well-formed consumed spans pass through; anything else is dropped, never trusted. */
function boundConsumed(raw: unknown, repairs: Repairs): Array<[number, number]> | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    repairs.add("dropped-malformed-entries");
    return undefined;
  }
  const out: Array<[number, number]> = [];
  let dropped = false;
  for (const item of raw) {
    if (
      Array.isArray(item) &&
      item.length === 2 &&
      typeof item[0] === "number" &&
      typeof item[1] === "number" &&
      Number.isFinite(item[0]) &&
      Number.isFinite(item[1]) &&
      item[0] >= 0 &&
      item[0] <= item[1]
    ) {
      out.push([item[0], item[1]]);
    } else {
      dropped = true;
    }
  }
  if (dropped) repairs.add("dropped-malformed-entries");
  if (out.length > MAX_CONSUMED_SPANS) {
    repairs.add("clamped-bounds");
    return out.slice(0, MAX_CONSUMED_SPANS);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Step 5 — normalize (with the donor logic-case lesson)                      */
/* -------------------------------------------------------------------------- */

/**
 * Donor fixGroupLogic lesson: normalizeRule maps anything that is not exactly "OR"
 * to "AND", so a model's lowercase "or" would silently FLIP the combinator — a
 * semantic mangling, not a repair. Upper-case logic markers first.
 */
function fixGroupLogicDeep(node: unknown): unknown {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
  const group = { ...(node as Record<string, unknown>) };
  if (typeof group.logic === "string") group.logic = group.logic.toUpperCase();
  if (Array.isArray(group.children)) {
    group.children = group.children.map((child) => fixGroupLogicDeep(child));
  }
  return group;
}

/** Apply the logic fix to the places that carry condition groups. */
function fixRuleLogicCase(raw: Record<string, unknown>): Record<string, unknown> {
  const rule = { ...raw };
  rule.conditions = fixGroupLogicDeep(rule.conditions);
  for (const lane of ["actions", "else"] as const) {
    const list = rule[lane];
    if (!Array.isArray(list)) continue;
    rule[lane] = list.map((item) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
      const output = { ...(item as Record<string, unknown>) };
      if (output.when !== undefined) output.when = fixGroupLogicDeep(output.when);
      return output;
    });
  }
  return rule;
}

/* -------------------------------------------------------------------------- */
/* Step 6 — allowlist                                                         */
/* -------------------------------------------------------------------------- */

function collectLeaves(rule: WorkflowRule): ConditionLeaf[] {
  const leaves = [...walkLeaves(rule.conditions)];
  for (const output of [...rule.actions, ...(rule.else ?? [])]) {
    if (output.when) leaves.push(...walkLeaves(output.when));
  }
  return leaves;
}

/** Fail closed against the snapshot: every enum key must exist or the candidate dies. */
function allowlistRule(rule: WorkflowRule, vocab: VocabularySnapshot): CandidateVerdict | null {
  for (const trigger of rule.triggers) {
    if (!vocab.events.includes(trigger.event)) {
      return reject(false, `unknown-event:${reasonKey(trigger.event)}`);
    }
  }
  for (const leaf of collectLeaves(rule)) {
    if (isFormFieldRef(leaf.field)) {
      if (!leaf.field.formTemplateId || !leaf.field.fieldId) {
        return reject(false, "unknown-field:malformed-form-field-ref");
      }
    } else if (!vocab.fields.includes(leaf.field)) {
      return reject(false, `unknown-field:${reasonKey(leaf.field)}`);
    }
    const kind = condFieldKind(leaf.field);
    const operators = vocab.operatorsByKind[kind] ?? [];
    if (!operators.includes(leaf.operator)) {
      return reject(false, `invalid-operator:${reasonKey(leaf.operator)}`);
    }
  }
  for (const output of [...rule.actions, ...(rule.else ?? [])]) {
    if (!vocab.actions.includes(output.action)) {
      return reject(false, `unknown-action:${reasonKey(output.action)}`);
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Step 7 — entity re-grounding                                               */
/* -------------------------------------------------------------------------- */

interface Conversions {
  unresolved: UnresolvedSlot[];
  ambiguities: ParseAmbiguity[];
}

function verdictSuggestions(verdict: GroundingVerdict): string[] {
  return verdict.kind === "suggestions" ? verdict.candidates.slice(0, MAX_SUGGESTIONS) : [];
}

function dedupeLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    const key = normLabel(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function duplicateAmbiguity(heard: string, verdict: GroundingVerdict): ParseAmbiguity {
  const options =
    verdict.kind === "duplicate"
      ? dedupeLabels(verdict.candidates).slice(0, MAX_AMBIGUITY_OPTIONS)
      : [];
  return {
    question: `Which "${heard.slice(0, AMBIGUITY_OPTION_CHARS)}" did you mean? There are several.`,
    options,
  };
}

function valueMatchesHeard(value: ScopeValue, heard: string): boolean {
  if (typeof value === "string") return normLabel(value) === normLabel(heard);
  if (isScopeRef(value) && value.level === "instance")
    return normLabel(value.label) === normLabel(heard);
  return false;
}

/**
 * Re-ground one ungrounded action-param finding: blank the param and mirror the
 * parser's UnresolvedSlot shape, or (for a fabricated instance id whose LABEL does
 * ground) swap in the registry-backed reference.
 */
function convertOutputFinding(
  output: RuleOutput,
  lane: "then" | "else",
  actionIndex: number,
  heard: string,
  vocab: VocabularySnapshot,
  conversions: Conversions,
  repairs: Repairs,
): void {
  for (const [param, value] of Object.entries(output.params)) {
    if (!valueMatchesHeard(value, heard)) continue;
    const isInstance = typeof value !== "string" && isScopeRef(value) && value.level === "instance";
    const label =
      typeof value === "string" ? value : (value as Extract<ScopeRef, { level: "instance" }>).label;
    const regroundVerdict = groundValue(output.action, label, vocab);
    if (
      isInstance &&
      regroundVerdict.kind === "grounded" &&
      regroundVerdict.instanceId !== undefined
    ) {
      output.params[param] = {
        level: "instance",
        id: regroundVerdict.instanceId,
        label: regroundVerdict.canonical,
      };
      repairs.add("regrounded-instance-id");
      continue;
    }
    delete output.params[param];
    if (regroundVerdict.kind === "duplicate") {
      conversions.ambiguities.push(duplicateAmbiguity(label, regroundVerdict));
      repairs.add("ambiguated-duplicate-label");
      continue;
    }
    conversions.unresolved.push({
      where: "action-param",
      lane,
      actionIndex,
      param,
      heard: label.slice(0, HEARD_CHARS),
      suggestions: verdictSuggestions(regroundVerdict),
    });
    repairs.add(isInstance ? "blanked-fabricated-instance-id" : "unresolved-ungrounded-entity");
  }
}

/** Same conversion for condition leaves (root tree and per-action gates). */
function convertLeafFinding(
  leaf: ConditionLeaf,
  conditionIndex: number | undefined,
  heard: string,
  vocab: VocabularySnapshot,
  conversions: Conversions,
  repairs: Repairs,
): void {
  if (!valueMatchesHeard(leaf.value, heard)) return;
  const registryKey = isFormFieldRef(leaf.field) ? "" : leaf.field;
  const isInstance =
    typeof leaf.value !== "string" && isScopeRef(leaf.value) && leaf.value.level === "instance";
  const label =
    typeof leaf.value === "string"
      ? leaf.value
      : (leaf.value as Extract<ScopeRef, { level: "instance" }>).label;
  const regroundVerdict = registryKey
    ? groundValue(registryKey, label, vocab)
    : { kind: "unknown" as const };
  if (
    isInstance &&
    regroundVerdict.kind === "grounded" &&
    regroundVerdict.instanceId !== undefined
  ) {
    leaf.value = {
      level: "instance",
      id: regroundVerdict.instanceId,
      label: regroundVerdict.canonical,
    };
    repairs.add("regrounded-instance-id");
    return;
  }
  if (regroundVerdict.kind === "grounded") {
    leaf.value = regroundVerdict.canonical;
    repairs.add(isInstance ? "blanked-fabricated-instance-id" : "unresolved-ungrounded-entity");
    return;
  }
  leaf.value = "";
  if (regroundVerdict.kind === "duplicate") {
    conversions.ambiguities.push(duplicateAmbiguity(label, regroundVerdict));
    repairs.add("ambiguated-duplicate-label");
    return;
  }
  const slot: UnresolvedSlot = {
    where: "condition-value",
    heard: label.slice(0, HEARD_CHARS),
    suggestions: verdictSuggestions(regroundVerdict),
  };
  if (conditionIndex !== undefined) slot.conditionIndex = conditionIndex;
  conversions.unresolved.push(slot);
  repairs.add(isInstance ? "blanked-fabricated-instance-id" : "unresolved-ungrounded-entity");
}

/** Trigger scope with an unbacked instance id: keep it only if the label re-grounds to a real id. */
function convertTriggerFinding(
  rule: WorkflowRule,
  triggerIndex: number,
  heard: string,
  vocab: VocabularySnapshot,
  conversions: Conversions,
  repairs: Repairs,
): void {
  const trigger = rule.triggers[triggerIndex];
  const scope = trigger?.scope;
  if (
    !trigger ||
    !scope ||
    scope.level !== "instance" ||
    normLabel(scope.label) !== normLabel(heard)
  )
    return;
  const regroundVerdict = groundValue("template", scope.label, vocab);
  if (regroundVerdict.kind === "grounded" && regroundVerdict.instanceId !== undefined) {
    trigger.scope = {
      level: "instance",
      id: regroundVerdict.instanceId,
      label: regroundVerdict.canonical,
    };
    repairs.add("regrounded-instance-id");
    return;
  }
  delete trigger.scope;
  if (regroundVerdict.kind === "duplicate") {
    conversions.ambiguities.push(duplicateAmbiguity(scope.label, regroundVerdict));
    repairs.add("ambiguated-duplicate-label");
    return;
  }
  conversions.unresolved.push({
    where: "event",
    heard: scope.label.slice(0, HEARD_CHARS),
    suggestions: verdictSuggestions(regroundVerdict),
  });
  repairs.add("blanked-fabricated-instance-id");
}

const ACTION_PATH_RE = /^(actions|else)\[(\d+)\](\.when)?$/;
const LEAF_PATH_RE = /^conditions\.leaf\[(\d+)\]$/;
const TRIGGER_PATH_RE = /^triggers\[(\d+)\]$/;

/**
 * groundRule is the verdict oracle; findings are mapped back onto the rule and every
 * non-grounded entity is CONVERTED into an honest gap. The allowlist ran first, so the
 * only findings left are value/param/scope findings — key-level unknowns already died.
 */
function regroundEntities(
  rule: WorkflowRule,
  vocab: VocabularySnapshot,
  conversions: Conversions,
  repairs: Repairs,
): void {
  const { findings } = groundRule(rule, vocab);
  const rootLeaves = walkLeaves(rule.conditions);
  for (const finding of findings) {
    if (finding.verdict.kind === "grounded") continue;
    // An empty value IS the parser's honest representation of an unresolved slot —
    // blanking a blank would double-report the same gap.
    if (normLabel(finding.heard) === "") continue;
    const actionMatch = ACTION_PATH_RE.exec(finding.path);
    if (actionMatch) {
      const lane = actionMatch[1] === "else" ? "else" : "then";
      const list = actionMatch[1] === "else" ? (rule.else ?? []) : rule.actions;
      const index = Number(actionMatch[2]);
      const output = list[index];
      if (!output) continue;
      if (actionMatch[3]) {
        for (const leaf of output.when ? walkLeaves(output.when) : []) {
          convertLeafFinding(leaf, undefined, finding.heard, vocab, conversions, repairs);
        }
      } else {
        convertOutputFinding(output, lane, index, finding.heard, vocab, conversions, repairs);
      }
      continue;
    }
    const leafMatch = LEAF_PATH_RE.exec(finding.path);
    if (leafMatch) {
      const index = Number(leafMatch[1]);
      const leaf = rootLeaves[index];
      if (leaf) convertLeafFinding(leaf, index, finding.heard, vocab, conversions, repairs);
      continue;
    }
    const triggerMatch = TRIGGER_PATH_RE.exec(finding.path);
    if (triggerMatch) {
      convertTriggerFinding(
        rule,
        Number(triggerMatch[1]),
        finding.heard,
        vocab,
        conversions,
        repairs,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Step 8 — URL safety (SSRF / scheme abuse, every action param)              */
/* -------------------------------------------------------------------------- */

type UrlSafety = "not-a-url" | "safe" | "unsafe";

/**
 * The red team's SSRF finding: the generic grammar can carry raw URLs (including the
 * 169.254.169.254 metadata endpoint) into action params. Policy, applied to EVERY
 * action param: only a full https:// URL with a public multi-label hostname passes.
 * Anything URL-shaped that is not that — http://, javascript:, data:, file:, other
 * schemes, protocol-relative, www.-prefixed, credential-bearing, IP literals (v4 or
 * v6), localhost / *.local / *.internal / *.localhost, single-label or numeric hosts,
 * or a URL embedded in longer text — is converted to an unresolved slot.
 */
function urlSafety(raw: string): UrlSafety {
  const text = raw.trim();
  if (!text) return "not-a-url";
  const schemeShaped = /^[a-z][a-z0-9+.-]*:\S/i.test(text);
  const urlish =
    text.includes("://") || schemeShaped || text.startsWith("//") || /^www\./i.test(text);
  if (!urlish) return "not-a-url";
  const authorityMatch = /^https:\/\/([^/?#]*)(?:[/?#]|$)/i.exec(text);
  if (!authorityMatch) return "unsafe";
  let host = authorityMatch[1];
  if (host.includes("@")) return "unsafe";
  if (host.startsWith("[")) return "unsafe";
  const portIndex = host.indexOf(":");
  if (portIndex !== -1) host = host.slice(0, portIndex);
  host = host.toLowerCase().replace(/\.$/, "");
  if (!host || !host.includes(".")) return "unsafe";
  if (host === "localhost" || host.endsWith(".localhost")) return "unsafe";
  if (host.endsWith(".local") || host.endsWith(".internal")) return "unsafe";
  if (host.split(".").every((label) => /^(0x[0-9a-f]+|\d+)$/.test(label))) return "unsafe";
  return "safe";
}

function screenUrlParams(rule: WorkflowRule, conversions: Conversions, repairs: Repairs): void {
  const lanes: Array<["then" | "else", RuleOutput[]]> = [
    ["then", rule.actions],
    ["else", rule.else ?? []],
  ];
  for (const [lane, outputs] of lanes) {
    outputs.forEach((output, actionIndex) => {
      for (const [param, value] of Object.entries(output.params)) {
        const text =
          typeof value === "string"
            ? value
            : isScopeRef(value) && value.level === "instance"
              ? value.label
              : isScopeRef(value) && value.level === "category"
                ? value.category
                : "";
        if (!text || urlSafety(text) !== "unsafe") continue;
        delete output.params[param];
        conversions.unresolved.push({
          where: "action-param",
          lane,
          actionIndex,
          param,
          heard: text.slice(0, HEARD_CHARS),
          suggestions: [],
        });
        repairs.add("unsafe-url-param");
      }
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Step 11 — merge + dedupe                                                   */
/* -------------------------------------------------------------------------- */

function slotKey(slot: UnresolvedSlot): string {
  return [
    slot.where,
    slot.lane ?? "",
    slot.actionIndex ?? "",
    slot.conditionIndex ?? "",
    slot.param ?? "",
    normLabel(slot.heard),
  ].join("|");
}

function dedupeSlots(slots: UnresolvedSlot[]): UnresolvedSlot[] {
  const seen = new Set<string>();
  const out: UnresolvedSlot[] = [];
  for (const slot of slots) {
    const key = slotKey(slot);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(slot);
  }
  return out;
}

function dedupeAmbiguities(list: ParseAmbiguity[]): ParseAmbiguity[] {
  const seen = new Set<string>();
  const out: ParseAmbiguity[] = [];
  for (const amb of list) {
    const key = normLabel(amb.question);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(amb);
  }
  return out;
}

function dedupeStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* reviewCandidate                                                            */
/* -------------------------------------------------------------------------- */

interface BoundedSidecars {
  notes: string[];
  unresolved: UnresolvedSlot[];
  uncovered: string[];
  ambiguities: ParseAmbiguity[];
  unbacked?: string[];
  consumed?: Array<[number, number]>;
  suggestions: string[];
}

function boundSidecars(obj: Record<string, unknown>, repairs: Repairs): BoundedSidecars {
  const out: BoundedSidecars = {
    notes: boundStringArray(obj.notes, MAX_NOTES, NOTE_CHARS, repairs),
    unresolved: boundUnresolved(obj.unresolved, repairs),
    uncovered: boundStringArray(obj.uncovered, MAX_UNCOVERED, UNCOVERED_CHARS, repairs),
    ambiguities: boundAmbiguities(obj.ambiguities, repairs),
    suggestions: boundStringArray(obj.suggestions, MAX_SUGGESTIONS, SUGGESTION_CHARS, repairs),
  };
  if (obj.unbacked !== undefined) {
    out.unbacked = boundStringArray(obj.unbacked, MAX_UNCOVERED, UNCOVERED_CHARS, repairs);
  }
  const consumed = boundConsumed(obj.consumed, repairs);
  if (consumed !== undefined) out.consumed = consumed;
  return out;
}

function assembleResult(
  rule: WorkflowRule | null,
  sidecars: BoundedSidecars,
  conversions: Conversions,
  extraUncovered: string[],
): ParseEnvelope {
  const result: ParseEnvelope = {
    rule,
    notes: sidecars.notes,
    unresolved: dedupeSlots([...sidecars.unresolved, ...conversions.unresolved]).slice(
      0,
      MAX_UNRESOLVED,
    ),
    uncovered: dedupeStrings([...sidecars.uncovered, ...extraUncovered]).slice(0, MAX_UNCOVERED),
    ambiguities: dedupeAmbiguities([...sidecars.ambiguities, ...conversions.ambiguities]).slice(
      0,
      MAX_AMBIGUITIES,
    ),
  };
  if (sidecars.unbacked !== undefined) result.unbacked = sidecars.unbacked;
  if (sidecars.consumed !== undefined) result.consumed = sidecars.consumed;
  if (sidecars.suggestions.length > 0)
    result.suggestions = sidecars.suggestions.slice(0, MAX_SUGGESTIONS);
  return result;
}

/**
 * Review one hostile candidate. See the module doc for the numbered pipeline; the
 * verdict is deterministic, the input is never mutated, and rejection reasons carry
 * only canonical vocabulary keys or already-rejected (sanitized, clamped) tokens.
 */
export function reviewCandidate(input: CandidateReviewInput): CandidateVerdict {
  const repairs = makeRepairs();

  /* 1 — string input: fence-strip + parse. Non-strings are canonicalized through a
   *     JSON round-trip so cycles, getters, functions and BigInts die here. */
  let parsed: unknown;
  if (typeof input.candidate === "string") {
    try {
      parsed = JSON.parse(stripJsonFence(input.candidate));
    } catch {
      return reject(true, "unparseable-json");
    }
    repairs.add("parsed-fenced-json");
  } else {
    try {
      const serialized: string | undefined = JSON.stringify(input.candidate);
      if (serialized === undefined) return reject(true, "unserializable-candidate");
      parsed = JSON.parse(serialized);
    } catch {
      return reject(true, "unserializable-candidate");
    }
  }

  /* 2 — shape gate: plain object, rule null-or-object, the four honesty arrays. */
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return reject(true, "not-an-object");
  }
  const rawObj = parsed as Record<string, unknown>;
  if (
    rawObj.rule === undefined ||
    (rawObj.rule !== null && (typeof rawObj.rule !== "object" || Array.isArray(rawObj.rule)))
  ) {
    return reject(true, "invalid-shape:rule");
  }
  for (const key of ["notes", "unresolved", "uncovered", "ambiguities"] as const) {
    if (!Array.isArray(rawObj[key])) return reject(true, `invalid-shape:${key}`);
  }

  /* 2b — unknown top-level keys dropped; engine-authored sidecars dropped. */
  const obj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawObj)) {
    if (RESULT_KEYS.has(key)) {
      obj[key] = value;
    } else if (ENGINE_SIDECAR_KEYS.has(key)) {
      repairs.add("dropped-engine-sidecars");
    } else {
      repairs.add("dropped-unknown-keys");
    }
  }

  /* 3 — size ceiling on the rule, then deep string sanitation + sidecar bounds. */
  if (obj.rule !== null && JSON.stringify(obj.rule).length > MAX_RULE_JSON_CHARS) {
    return reject(true, "rule-too-large");
  }
  const clean = deepSanitize(obj, repairs) as Record<string, unknown>;
  const sidecars = boundSidecars(clean, repairs);
  const conversions: Conversions = { unresolved: [], ambiguities: [] };

  /* 4 — an honest-null model answer must not erase a working deterministic draft. */
  if (clean.rule === null) {
    if (input.deterministic.rule !== null) {
      return reject(false, "candidate-weaker-than-deterministic");
    }
    const nullResult = assembleResult(null, sidecars, conversions, []);
    if (!isParseEnvelope(nullResult)) return reject(true, "guard-failed");
    return { accepted: true, result: nullResult, repairs: repairs.list };
  }

  /* 5 — normalize (logic-case fix first — see fixGroupLogicDeep) + controls hardening. */
  const sanitizedRule = clean.rule as Record<string, unknown>;
  const rule = normalizeRule(fixRuleLogicCase(sanitizedRule));
  if (canonicalJson(rule) !== canonicalJson(sanitizedRule)) repairs.add("normalized-rule-shape");
  if (rule.controls.mode === "armed") {
    // A model may never arm. The author's own explicit text can (via the
    // deterministic parser); a model candidate cannot.
    rule.controls.mode = "shadow";
    repairs.add("disarmed-model-output");
  }

  /* 6 — enum allowlists against the snapshot; fail closed on any unknown key. */
  const allowlistVerdict = allowlistRule(rule, input.vocab);
  if (allowlistVerdict) return allowlistVerdict;

  /* 7 — re-ground every entity; ungrounded values become honest gaps. */
  regroundEntities(rule, input.vocab, conversions, repairs);

  /* 8 — URL safety on every action param. */
  screenUrlParams(rule, conversions, repairs);

  /* 9 — semantic coverage: fabrication is fatal, omission is surfaced. The result
   *     handed to coverage carries no `consumed` spans — a candidate must not be
   *     able to claim coverage it did not earn. */
  const coverageUncovered: string[] = [];
  if (input.clauses && input.clauses.length > 0 && input.coverage) {
    const soFar: ParseResult = {
      rule,
      notes: sidecars.notes,
      unresolved: [...sidecars.unresolved, ...conversions.unresolved],
      uncovered: sidecars.uncovered,
      ambiguities: [...sidecars.ambiguities, ...conversions.ambiguities],
    };
    const report = input.coverage(input.clauses, soFar);
    if (report.fabricated.length > 0) {
      return reject(false, "fabricated-component");
    }
    if (report.materialUnaccounted.length > 0) {
      const byId = new Map(input.clauses.map((clause) => [clause.id, clause.text]));
      for (const clauseId of report.materialUnaccounted) {
        coverageUncovered.push((byId.get(clauseId) ?? clauseId).slice(0, UNCOVERED_CHARS));
      }
      repairs.add("surfaced-dropped-clause");
    }
  }

  /* 10 — the same validator + linter every hand-authored rule passes. */
  const validation = validateRule(rule);
  const firstError = validation.issues.find((issue) => issue.severity === "error");
  if (firstError) return reject(false, `invalid-rule:${firstError.code}`);
  const lintIssues = lintRuleIssues(rule, {});
  if (hasBlockingIssues(lintIssues)) {
    const firstBlocking = lintIssues.find((issue) => issue.severity === "error");
    return reject(false, `lint:${firstBlocking?.code ?? "BLOCKING"}`);
  }

  /* 11 — assemble, dedupe, final shape guard. */
  const result = assembleResult(rule, sidecars, conversions, coverageUncovered);
  if (!isParseEnvelope(result)) return reject(true, "guard-failed");
  return { accepted: true, result, repairs: repairs.list };
}
