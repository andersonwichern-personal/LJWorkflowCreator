/**
 * Traced rule evaluator for the Live Simulator + Audit Logs
 * (docs/2026-07-14_workflow-creator-simulator-and-audit-logs-prompt_v1.md).
 *
 * Same semantics as lib/ruleEngine.ts, but every step is *traced*: the trigger
 * check and each condition report expected vs actual so the UI can render a
 * colored pass/fail tree and the audit log can persist the full evaluation.
 * Pure and side-effect free — the API route decides whether to log.
 */

import {
  WorkflowRule,
  RuleCondition,
  getAction,
  paramKeyFor,
  condFieldKey,
  condFieldLabel,
  condFieldKind,
} from "./vocabulary";
import { PlatformRequest } from "./platformData";
import { requestMatchesEvent, resolveField } from "./ruleEngine";

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
}

export interface SimulationTrace {
  matched: boolean;
  trace: {
    trigger: { event: string; matched: boolean; actual: string | null };
    conditions: ConditionTrace[];
  };
  /** Dispatched-action descriptors, e.g. "assign_user: Wael". */
  actions: string[];
}

/** Operator evaluation per the spec (§2), plus array membership for tags. */
export function evaluateCondition(
  fieldValue: string | number | string[] | null,
  operator: string,
  ruleValue: string,
  numeric: boolean
): boolean {
  if (fieldValue === null) return false;

  if (Array.isArray(fieldValue)) {
    const has = fieldValue.some((v) => eq(v, ruleValue));
    return operator === "is_not" ? !has : has;
  }

  if (numeric) {
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

function traceCondition(r: PlatformRequest, c: RuleCondition): ConditionTrace {
  const key = condFieldKey(c.field);
  const { known, value } = resolveField(r, key);
  const numeric = condFieldKind(c.field) === "numeric";
  const matched = known && evaluateCondition(value, c.operator, c.value, numeric);
  return {
    field: key,
    label: condFieldLabel(c.field),
    operator: c.operator,
    expected: c.value,
    actual: known ? (Array.isArray(value) ? value.join(", ") : String(value ?? "")) : null,
    matched,
  };
}

/** Human descriptor for a dispatched action, e.g. "assign_user: Wael". */
function describeAction(action: string, params: Record<string, string>): string {
  const def = getAction(action);
  if (def?.paramKind === "none") return action;
  const val = params[paramKeyFor(action)];
  return val ? `${action}: ${val}` : action;
}

/**
 * Dry-run a rule against a request, tracing every step.
 *
 * `actions` lists what *would* dispatch — only populated when the rule fully
 * matches, so an audit row for CONDITIONS_NOT_MET carries an empty list.
 */
export function simulateRule(rule: WorkflowRule, request: PlatformRequest): SimulationTrace {
  const event = rule.trigger.event;
  const triggerMatched = requestMatchesEvent(request, event);

  const conditions = rule.conditions.rules.map((c) => traceCondition(request, c));
  const conditionsMatched =
    conditions.length === 0
      ? true
      : rule.conditions.logic === "OR"
      ? conditions.some((c) => c.matched)
      : conditions.every((c) => c.matched);

  const matched = triggerMatched && conditionsMatched;

  return {
    matched,
    trace: {
      trigger: { event, matched: triggerMatched, actual: triggerMatched ? event : null },
      conditions,
    },
    actions: matched ? rule.actions.map((o) => describeAction(o.action, o.params)) : [],
  };
}
