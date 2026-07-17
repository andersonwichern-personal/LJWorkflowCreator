/**
 * Traced rule evaluator for the Live Simulator + Audit Logs — the single
 * semantic engine (hardening plan §2.6, §3.3). Every step is traced so the UI
 * can render a colored pass/fail tree and the audit log can persist the full
 * evaluation. Pure and side-effect free — the API route decides whether to log.
 *
 * Schema v3: multiple triggers (OR), recursive AND/OR condition groups (traces
 * flattened with a `depth` for indentation), `missingData:"alert"` fail-closed
 * alerts, and `else` (Otherwise) actions when triggers match but conditions don't.
 *
 * `aggregate_exposure` arrives through CONTEXT rather than a lookup so this
 * module stays pure and synchronous. The host resolves the dynamic value first
 * and passes it in; the evaluator and its callers remain deterministic.
 *
 * A context field the caller didn't resolve is UNKNOWN, never 0 — fail-closed,
 * exactly like an absent request field. Treating "not looked up" as $0 exposure
 * would silently pass every `aggregate_exposure >= threshold` covenant check.
 */

import {
  WorkflowRule,
  RuleCondition,
  ConditionGroup,
  FieldKind,
  ScopeRef,
  ScopeValue,
  TriggerRef,
  getAction,
  paramKeyFor,
  condFieldKey,
  condFieldLabel,
  condFieldKind,
  condFieldDef,
  isValuelessOperator,
  isLegacyString,
  scopeLabel,
  isGroup,
  SCOPED_FIELDS,
} from "./vocabulary";
import { PlatformRequest } from "./platformData";
import { requestMatchesEvent, resolveField } from "./ruleEngine";

/**
 * Values resolved by the (server-side, async) caller for fields that aren't on
 * the request itself. Every entry is optional: omit it and the field resolves
 * unknown and fails closed. See the module docblock for why this is injected.
 */
export interface EvaluationContext {
  /** Total outstanding across the borrower's connected group, in dollars. */
  aggregateExposure?: number;
}

/**
 * Condition fields answered from the context rather than from the request.
 * `undefined` → the caller didn't resolve it → unknown → fail-closed.
 */
const CONTEXT_FIELDS: Record<string, (ctx: EvaluationContext) => string | number | undefined> = {
  aggregate_exposure: (ctx) => ctx.aggregateExposure,
};

/** resolveField, with the caller-supplied context fields overlaid. */
function resolveWithContext(
  r: PlatformRequest,
  fieldKey: string,
  ctx: EvaluationContext
): { known: boolean; value: string | number | string[] | null } {
  const fromContext = CONTEXT_FIELDS[fieldKey];
  if (!fromContext) return resolveField(r, fieldKey);
  const value = fromContext(ctx);
  return value === undefined ? { known: false, value: null } : { known: true, value };
}

export interface TriggerTrace {
  event: string;
  matched: boolean;
}

export interface ConditionTrace {
  /** Stable field key (attribute key or ff:<form>:<field>). */
  field: string;
  /** Human label for the trace UI. */
  label: string;
  operator: string;
  expected: string;
  /** Actual value on the request — null when the field is unknown/absent. */
  actual: string | null;
  matched: boolean;
  /** Nesting depth for indented rendering (0 = a leaf of the root group). */
  depth: number;
}

export interface SimulationTrace {
  matched: boolean;
  trace: {
    /** Every trigger, OR-combined; `matchedTrigger` is the first that matched. */
    triggers: TriggerTrace[];
    matchedTrigger: string | null;
    /** Flattened, depth-annotated condition leaves. */
    conditions: ConditionTrace[];
  };
  /** Dispatched-action descriptors when the rule fully matches. */
  actions: string[];
  /** Otherwise-branch descriptors when a trigger matched but conditions failed. */
  elseActions: string[];
  /** missingData:"alert" fields that were absent (fail-closed, but surfaced). */
  alerts: string[];
}

/**
 * The single operator implementation (ruleEngine delegates here). Semantics:
 * - `is_empty` / `is_not_empty` run BEFORE the null guard: a *known* field whose
 *   value is null/""/[] IS empty. Unknown fields never reach this function
 *   (callers gate on `known`) — unknown ≠ empty.
 * - `worse_than` / `better_than` compare positions in the field's ranked options
 *   (best→worst); values not in the list rank worst.
 */
export function evaluateCondition(
  fieldValue: string | number | string[] | null,
  operator: string,
  ruleValue: string,
  kind: FieldKind,
  options?: string[]
): boolean {
  if (isValuelessOperator(operator)) {
    const empty =
      fieldValue === null ||
      fieldValue === "" ||
      (Array.isArray(fieldValue) && fieldValue.length === 0);
    return operator === "is_empty" ? empty : !empty;
  }

  if (fieldValue === null) return false;

  if (Array.isArray(fieldValue)) {
    const has = fieldValue.some((v) => eq(v, ruleValue));
    return operator === "is_not" ? !has : has;
  }

  if (kind === "numeric") {
    const a = Number(fieldValue);
    const b = Number(ruleValue);
    if (isNaN(a) || isNaN(b)) return false;
    switch (operator) {
      case "gt": return a > b;
      case "gte": return a >= b;
      case "lt": return a < b;
      case "lte": return a <= b;
      default: return a === b;
    }
  }

  if (kind === "orderedEnum" && (operator === "worse_than" || operator === "better_than")) {
    const rank = (v: string) => {
      const i = (options ?? []).findIndex((o) => eq(o, v));
      return i === -1 ? (options ?? []).length : i; // unknown ranks worst
    };
    const a = rank(String(fieldValue));
    const b = rank(ruleValue);
    return operator === "worse_than" ? a > b : a < b;
  }

  const s = String(fieldValue);
  switch (operator) {
    case "is": return eq(s, ruleValue);
    case "is_not": return !eq(s, ruleValue);
    case "contains": return s.toLowerCase().includes(ruleValue.toLowerCase());
    default: return eq(s, ruleValue);
  }
}

function eq(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Total scope comparator (Phase 2 §4.4), shared by both evaluators.
 * - legacy string → case-insensitive label match (today's behavior)
 * - any          → vacuously true
 * - category     → caller passes the request's CATEGORY attribute as actualLabel
 * - instance     → id match when the request carries ids (live data); label
 *                  fallback when it doesn't (seed data). Stage instances are
 *                  labeled "Template › Stage" — the fallback also accepts the
 *                  bare stage segment so seed data still matches while two
 *                  same-named stages from different templates stay distinct (C7).
 */
export function scopeMatches(v: ScopeValue, actualId: string | null, actualLabel: string): boolean {
  if (isLegacyString(v)) return eq(actualLabel, v);
  switch (v.level) {
    case "any":
      return true;
    case "category":
      return eq(actualLabel, v.category);
    case "instance": {
      if (actualId !== null) return actualId === v.id;
      if (eq(actualLabel, v.label)) return true;
      const seg = v.label.split("›").pop() ?? v.label;
      return eq(actualLabel, seg);
    }
  }
}

/** The field key whose value carries a scoped field's CATEGORY attribute. */
function categoryAttributeFor(fieldKey: string): string {
  return SCOPED_FIELDS[fieldKey]?.categoryAttribute ?? fieldKey;
}

/** Does a trigger's optional scope admit this request? (absent/any → yes) */
function triggerScopeOk(t: TriggerRef, r: PlatformRequest): boolean {
  if (!t.scope || t.scope.level === "any") return true;
  // Template scope: match the request's template attribute (id-less seed data
  // falls back to label matching; unknown field → fail-closed).
  const attr = t.scope.level === "category" ? "reqtype" : "template";
  const { known, value } = resolveField(r, attr);
  if (!known || value == null) return false;
  const label = Array.isArray(value) ? value.join(", ") : String(value);
  return scopeMatches(t.scope, null, label);
}

function traceCondition(
  r: PlatformRequest,
  c: RuleCondition,
  depth: number,
  ctx: EvaluationContext
): ConditionTrace {
  const key = condFieldKey(c.field);
  const { known, value } = resolveWithContext(r, key, ctx);
  const kind = condFieldKind(c.field);
  const options = condFieldDef(c.field)?.options;
  const actualStr = Array.isArray(value) ? value.join(", ") : String(value ?? "");

  let matched: boolean;
  if (isLegacyString(c.value)) {
    // Legacy string values: the existing operator engine, unchanged.
    // Unknown fields never match — including is_empty (unknown ≠ empty, §2.4).
    matched = known && evaluateCondition(value, c.operator, c.value, kind, options);
  } else {
    // Structured ScopeRef values (Phase 2 §4.4). Operators reduce to identity
    // (is / is_not) — pickers only offer refs on identity-shaped fields.
    matched = scopeRefMatched(r, key, c.value, known, value);
    if (c.operator === "is_not") matched = !matched;
  }

  return {
    field: key,
    label: condFieldLabel(c.field),
    operator: c.operator,
    expected: scopeLabel(c.value),
    actual: known ? actualStr : null,
    matched,
    depth,
  };
}

/** Match a ScopeRef leaf value against the resolved request field. */
function scopeRefMatched(
  r: PlatformRequest,
  fieldKey: string,
  ref: ScopeRef,
  known: boolean,
  value: string | number | string[] | null
): boolean {
  if (ref.level === "any") return true; // vacuous — "field applies at all"
  if (ref.level === "category") {
    // Compare against the request's CATEGORY attribute (reqtype/custtype/stage…).
    const attr = categoryAttributeFor(fieldKey);
    const cat = attr === fieldKey ? { known, value } : resolveField(r, attr);
    if (!cat.known || cat.value == null) return false;
    const label = Array.isArray(cat.value) ? cat.value.join(", ") : String(cat.value);
    return scopeMatches(ref, null, label);
  }
  // instance — seed data carries no platform ids; label fallback applies.
  if (!known || value == null) return false;
  const label = Array.isArray(value) ? value.join(", ") : String(value);
  return scopeMatches(ref, null, label);
}

/**
 * Recursively evaluate a condition group, flattening leaf traces with a depth
 * for indented rendering. AND resolves false if any child fails; OR resolves
 * true if any matches; an empty group vacuously matches. All leaves are traced
 * (no trace-level short-circuit) so the UI shows every condition's result.
 */
export function evaluateGroup(
  group: ConditionGroup,
  onLeaf: (c: RuleCondition, depth: number) => ConditionTrace,
  depth = 0
): { matched: boolean; traces: ConditionTrace[] } {
  const traces: ConditionTrace[] = [];
  const results: boolean[] = [];
  for (const child of group.children) {
    if (isGroup(child)) {
      const sub = evaluateGroup(child, onLeaf, depth + 1);
      traces.push(...sub.traces);
      results.push(sub.matched);
    } else {
      const t = onLeaf(child, depth);
      traces.push(t);
      results.push(t.matched);
    }
  }
  const matched =
    results.length === 0 ? true : group.logic === "OR" ? results.some(Boolean) : results.every(Boolean);
  return { matched, traces };
}

/** Human descriptor for a dispatched action, e.g. "assign_user: Wael". */
function describeAction(action: string, params: Record<string, ScopeValue>): string {
  const def = getAction(action);
  if (def?.paramKind === "none") return action;
  const val = scopeLabel(params[paramKeyFor(action)]);
  return val ? `${action}: ${val}` : action;
}

/**
 * Dry-run a rule against a request, tracing every step (schema v3).
 *
 * `actions` lists what *would* dispatch — only populated on a full match.
 * `elseActions` populate when a trigger matched but the conditions failed.
 * `alerts` surface fields absent from the data model when missingData:"alert".
 */
export function simulateRule(
  rule: WorkflowRule,
  request: PlatformRequest,
  context: EvaluationContext = {}
): SimulationTrace {
  const alerts: string[] = [];

  const triggers: TriggerTrace[] = rule.triggers.map((t) => ({
    event: t.event,
    // Event match AND the trigger's optional scope (template instance) — §4.2.
    matched: requestMatchesEvent(request, t.event) && triggerScopeOk(t, request),
  }));
  const triggerMatched = triggers.some((t) => t.matched);
  const matchedTrigger = triggers.find((t) => t.matched)?.event ?? null;

  const onLeaf = (c: RuleCondition, depth: number): ConditionTrace => {
    const t = traceCondition(request, c, depth, context);
    // missingData:"alert": a field absent from the data model (actual === null)
    // with a value-requiring operator is fail-closed AND surfaced as an alert.
    if (rule.controls.missingData === "alert" && t.actual === null && !isValuelessOperator(c.operator)) {
      alerts.push(`${t.label} has no value on this request (fail-closed)`);
    }
    return t;
  };

  const groupEval = evaluateGroup(rule.conditions, onLeaf, 0);
  const conditionsMatched = groupEval.matched;
  const matched = triggerMatched && conditionsMatched;

  const elseActions =
    triggerMatched && !conditionsMatched && rule.else && rule.else.length > 0
      ? rule.else.map((o) => describeAction(o.action, o.params))
      : [];

  return {
    matched,
    trace: { triggers, matchedTrigger, conditions: groupEval.traces },
    actions: matched ? rule.actions.map((o) => describeAction(o.action, o.params)) : [],
    elseActions,
    alerts,
  };
}

/** Boolean-only convenience for the list-match engine (single semantic source). */
export function ruleMatches(
  rule: WorkflowRule,
  request: PlatformRequest,
  context: EvaluationContext = {}
): boolean {
  return simulateRule(rule, request, context).matched;
}
