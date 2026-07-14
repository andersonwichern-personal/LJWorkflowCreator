/**
 * Traced rule evaluator for the Live Simulator + Audit Logs — the single
 * semantic engine (hardening plan §2.6, §3.3). Every step is traced so the UI
 * can render a colored pass/fail tree and the audit log can persist the full
 * evaluation. Pure and side-effect free — the API route decides whether to log.
 *
 * Schema v3: multiple triggers (OR), recursive AND/OR condition groups (traces
 * flattened with a `depth` for indentation), `missingData:"alert"` fail-closed
 * alerts, and `else` (Otherwise) actions when triggers match but conditions don't.
 */

import {
  WorkflowRule,
  RuleCondition,
  ConditionGroup,
  FieldKind,
  getAction,
  paramKeyFor,
  condFieldKey,
  condFieldLabel,
  condFieldKind,
  condFieldDef,
  isValuelessOperator,
  isGroup,
} from "./vocabulary";
import { PlatformRequest } from "./platformData";
import { requestMatchesEvent, resolveField } from "./ruleEngine";

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

function traceCondition(r: PlatformRequest, c: RuleCondition, depth: number): ConditionTrace {
  const key = condFieldKey(c.field);
  const { known, value } = resolveField(r, key);
  const kind = condFieldKind(c.field);
  const options = condFieldDef(c.field)?.options;
  // Unknown fields never match — including is_empty (unknown ≠ empty, §2.4).
  const matched = known && evaluateCondition(value, c.operator, c.value, kind, options);
  return {
    field: key,
    label: condFieldLabel(c.field),
    operator: c.operator,
    expected: c.value,
    actual: known ? (Array.isArray(value) ? value.join(", ") : String(value ?? "")) : null,
    matched,
    depth,
  };
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
function describeAction(action: string, params: Record<string, string>): string {
  const def = getAction(action);
  if (def?.paramKind === "none") return action;
  const val = params[paramKeyFor(action)];
  return val ? `${action}: ${val}` : action;
}

/**
 * Dry-run a rule against a request, tracing every step (schema v3).
 *
 * `actions` lists what *would* dispatch — only populated on a full match.
 * `elseActions` populate when a trigger matched but the conditions failed.
 * `alerts` surface fields absent from the data model when missingData:"alert".
 */
export function simulateRule(rule: WorkflowRule, request: PlatformRequest): SimulationTrace {
  const alerts: string[] = [];

  const triggers: TriggerTrace[] = rule.triggers.map((t) => ({
    event: t.event,
    matched: requestMatchesEvent(request, t.event),
  }));
  const triggerMatched = triggers.some((t) => t.matched);
  const matchedTrigger = triggers.find((t) => t.matched)?.event ?? null;

  const onLeaf = (c: RuleCondition, depth: number): ConditionTrace => {
    const t = traceCondition(request, c, depth);
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
export function ruleMatches(rule: WorkflowRule, request: PlatformRequest): boolean {
  return simulateRule(rule, request).matched;
}
