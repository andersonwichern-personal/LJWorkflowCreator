/**
 * GENERATED from packages/rule-core/src/parseGate.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/rule-core contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * parseGate — the semantic-coverage gate (composer roadmap MVP 1).
 *
 * Turns a ParseResult's sidecar (unresolved slots, uncovered fragments,
 * ambiguities) into blocking RuleIssues and a deterministic coverage report,
 * so an incomplete parse can NEVER present as a successful one: the same
 * issues panel and save gate that enforce lint findings enforce parse gaps.
 *
 * Everything here is derived mechanically from the parser's own output —
 * no model, no heuristics, no confidence scores. A high-confidence partial
 * interpretation is still a partial interpretation.
 */
import { ParseResult } from "./nlParser";
import { RuleIssue } from "./ruleValidation";
import { walkLeaves } from "./vocabulary";

export interface ParseGateReport {
  /** 0..1 — represented components / (represented + gaps). 1 only when whole. */
  coverage: number;
  /** Rule components that did land: triggers + condition leaves + actions. */
  represented: number;
  /** Unresolved slots + uncovered fragments + open ambiguities (+1 if no rule). */
  gaps: number;
  /** Parse gaps as blocking issues — same shape the lint panel renders. */
  issues: RuleIssue[];
  readyToSimulate: boolean;
  readyToActivate: boolean;
}

/** Parse gaps as blocking RuleIssues (empty when the parse is whole). */
export function parseGateIssues(result: ParseResult): RuleIssue[] {
  const issues: RuleIssue[] = [];

  if (!result.rule) {
    issues.push({
      severity: "error",
      code: "PARSE_EMPTY",
      message: "The description could not be turned into a rule yet.",
    });
  }

  for (const fragment of result.uncovered) {
    issues.push({
      severity: "error",
      code: "UNCOVERED_CLAUSE",
      message: `The description says “${fragment}”, but the drafted rule does not include it.`,
    });
  }

  for (const slot of result.unresolved) {
    const where =
      slot.where === "action-param"
        ? `${slot.lane === "else" ? "else" : "actions"}[${slot.actionIndex ?? 0}]`
        : slot.where === "condition-value"
          ? `conditions[${slot.conditionIndex ?? 0}]`
          : "triggers[0]";
    const hint = slot.suggestions.length ? ` Did you mean: ${slot.suggestions.join(", ")}?` : "";
    issues.push({
      severity: "error",
      code: "UNRESOLVED_ENTITY",
      message: `“${slot.heard}” needs to be confirmed before this rule can run.${hint}`,
      path: where,
    });
  }

  for (const ambiguity of result.ambiguities) {
    issues.push({
      severity: "error",
      code: "AMBIGUOUS_CLAUSE",
      message: ambiguity.question,
    });
  }

  return issues;
}

/** Deterministic coverage + readiness verdict for a parse result. */
export function parseGateReport(result: ParseResult): ParseGateReport {
  const issues = parseGateIssues(result);
  const rule = result.rule;
  const represented = rule
    ? rule.triggers.length +
      walkLeaves(rule.conditions).length +
      rule.actions.length +
      (rule.else?.length ?? 0)
    : 0;
  const gaps =
    result.unresolved.length + result.uncovered.length + result.ambiguities.length + (rule ? 0 : 1);
  const whole = rule !== null && gaps === 0;
  return {
    coverage: gaps === 0 ? (rule ? 1 : 0) : represented / (represented + gaps),
    represented,
    gaps,
    issues,
    readyToSimulate: whole,
    readyToActivate: whole,
  };
}
