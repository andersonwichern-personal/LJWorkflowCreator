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
  FieldKind,
  getAction,
  paramKeyFor,
  condFieldKey,
  condFieldLabel,
  condFieldKind,
  condFieldDef,
  isValuelessOperator,
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

/**
 * The single operator implementation (hardening plan §2.6 — ruleEngine
 * delegates here). Semantics:
 * - `is_empty` / `is_not_empty` run BEFORE the null guard: a *known* field
 *   whose value is null/""/[] IS empty. Unknown fields never reach this
 *   function (callers gate on `known`) — unknown ≠ empty.
 * - `worse_than` / `better_than` compare positions in the field's ranked
 *   options (best→worst); values not in the list rank worst, matching
 *   authorityEngine.gradeIndex semantics.
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

function traceCondition(r: PlatformRequest, c: RuleCondition): ConditionTrace {
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
