/**
 * simulationExplainer — plain-language test results (composer roadmap MVP 4).
 *
 * Runs the completed rule against representative requests and explains every
 * outcome — sourced ENTIRELY from the deterministic evaluation trace
 * (`simulateRule`), never invented independently. If the trace can't justify
 * a sentence, the sentence doesn't exist.
 */
import { PlatformRequest, REQUESTS } from "./platformData";
import { EvaluationContext, SimulationTrace, simulateRule } from "./ruleEvaluator";
import { actionPhrase } from "./interpretation";
import { WorkflowRule } from "./vocabulary";

export type SimOutcome = "run" | "skip" | "needs_data";

export interface ExplainedCheck {
  label: string;
  state: "matched" | "not_matched" | "missing";
}

export interface ExplainedResult {
  requestId: string;
  requestName: string;
  outcome: SimOutcome;
  /** One plain-language sentence, derived from the trace. */
  explanation: string;
  /** Every check with its outcome — full fidelity behind the sentence. */
  checks: ExplainedCheck[];
  /** For "run": what would happen, in plain phrases. */
  actions: string[];
}

export interface ExplainedSimulation {
  tested: number;
  wouldRun: number;
  wouldSkip: number;
  needsData: number;
  results: ExplainedResult[];
}

const CURRENCY_FIELD = /amount|limit|exposure|balance|income/i;

function fmt(fieldKey: string, raw: string | null): string {
  if (raw == null) return "(missing)";
  if (CURRENCY_FIELD.test(fieldKey) && /^\d+(\.\d+)?$/.test(raw)) {
    return `$${Number(raw).toLocaleString("en-US")}`;
  }
  return raw;
}

/** How a failed comparison reads against its requirement. */
function failPhrase(operator: string, fieldKey: string, actual: string, expected: string): string {
  switch (operator) {
    case "gte":
    case "gt":
      return `is ${actual}, which is below the ${expected} requirement`;
    case "lte":
    case "lt":
      return `is ${actual}, which is above the ${expected} limit`;
    case "is":
      return `is ${actual}, not ${expected}`;
    case "is_not":
      return `is ${expected}, which this workflow excludes`;
    case "contains":
      return `is ${actual}, which does not include ${expected}`;
    default:
      return `is ${actual}, which does not meet “${expected}”`;
  }
}

function checksFrom(trace: SimulationTrace): ExplainedCheck[] {
  const checks: ExplainedCheck[] = trace.trace.triggers.map((t) => ({
    label: `Reacts to ${t.event.toLowerCase()}`,
    state: t.matched ? "matched" : "not_matched",
  }));
  for (const c of trace.trace.conditions) {
    checks.push({
      label: `${c.label} ${c.operator.replace(/_/g, " ")} ${fmt(c.field, c.expected)}`,
      state: c.matched ? "matched" : c.actual === null ? "missing" : "not_matched",
    });
  }
  return checks;
}

function explainOne(rule: WorkflowRule, request: PlatformRequest, trace: SimulationTrace): ExplainedResult {
  const checks = checksFrom(trace);
  const base = { requestId: request.id, requestName: request.name, checks };

  // No trigger applies — the workflow never looks at this request.
  if (trace.trace.matchedTrigger === null) {
    return {
      ...base,
      outcome: "skip",
      explanation: "This workflow would not run because none of its trigger events apply to this request.",
      actions: [],
    };
  }

  if (trace.matched) {
    const because = trace.trace.conditions
      .filter((c) => c.matched)
      .map((c) => `the ${c.label.toLowerCase()} is ${fmt(c.field, c.actual)}`);
    const reason = because.length
      ? `because ${because.join(" and ")}`
      : "because its trigger applies and there are no further requirements";
    return {
      ...base,
      outcome: "run",
      explanation: `This workflow would run ${reason}.`,
      actions: rule.actions.map(actionPhrase),
    };
  }

  // Conditions failed: missing data is its own outcome (roadmap Phase 5).
  const failing = trace.trace.conditions.filter((c) => !c.matched);
  const missing = failing.find((c) => c.actual === null);
  if (missing) {
    return {
      ...base,
      outcome: "needs_data",
      explanation: `The ${missing.label.toLowerCase()} is missing, so the workflow cannot determine whether this request qualifies.`,
      actions: [],
    };
  }
  const cause = failing[0];
  const causeText = cause
    ? `the ${cause.label.toLowerCase()} ${failPhrase(cause.operator, cause.field, fmt(cause.field, cause.actual), fmt(cause.field, cause.expected))}`
    : "its requirements are not met";
  return {
    ...base,
    outcome: "skip",
    explanation: `This workflow would not run because ${causeText}.`,
    actions: [],
  };
}

/**
 * Run the rule against representative requests and explain every result.
 * Recompute on every rule change — totals must always describe the rule
 * version under review, never a stale one.
 */
export function explainSimulation(
  rule: WorkflowRule,
  requests: PlatformRequest[] = REQUESTS,
  context: EvaluationContext = {}
): ExplainedSimulation {
  const results = requests.map((request) => explainOne(rule, request, simulateRule(rule, request, context)));
  return {
    tested: results.length,
    wouldRun: results.filter((r) => r.outcome === "run").length,
    wouldSkip: results.filter((r) => r.outcome === "skip").length,
    needsData: results.filter((r) => r.outcome === "needs_data").length,
    results,
  };
}
