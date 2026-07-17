/**
 * GENERATED from packages/rule-core/src/clarifications.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/rule-core contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * clarifications — the focused Q&A loop over a parse result (composer
 * roadmap MVP 3 / Phase 4).
 *
 * Turns the parse sidecar into targeted questions with suggested answers,
 * and applies an answer as a deterministic patch to the canonical rule —
 * updating coverage mechanically, never by re-guessing. Ambiguity questions
 * (event choice) are the one kind the caller must resolve by re-parsing with
 * `forceEvent`: they change how the whole description is read.
 */
import { ParseResult, UnresolvedSlot } from "./nlParser";
import { WorkflowRule, getEvent } from "./vocabulary";

export interface Clarification {
  /** Stable within one ParseResult generation: `<kind>:<index>`. */
  id: string;
  kind: "unresolved" | "ambiguity" | "uncovered";
  question: string;
  /** Suggested answers (tap to accept); free text is always allowed. */
  options: string[];
  /**
   * Uncovered clauses only: the user may explicitly leave the clause out.
   * That is an intentional, noted decision — never an automatic drop.
   */
  allowDismiss: boolean;
  /** Ambiguities must be resolved by re-parsing with forceEvent = answer. */
  needsReparse: boolean;
}

function questionFor(slot: UnresolvedSlot): string {
  const heard = ` (I heard “${slot.heard}”.)`;
  if (slot.where === "action-param") {
    if (slot.param === "assignee") return `Who should the request be assigned to?${heard}`;
    if (slot.param === "value" || slot.param === "user") return `Who should be notified?${heard}`;
    return `What should “${slot.param ?? "this"}” be?${heard}`;
  }
  if (slot.where === "condition-value") return `What value should this condition check?${heard}`;
  return `Which event should this workflow react to?${heard}`;
}

/** Ordered questions for a parse result — ask the first one or two at a time. */
export function clarificationsFor(result: ParseResult): Clarification[] {
  const list: Clarification[] = [];
  result.ambiguities.forEach((ambiguity, index) =>
    list.push({
      id: `ambiguity:${index}`,
      kind: "ambiguity",
      question: ambiguity.question,
      options: ambiguity.options,
      allowDismiss: false,
      needsReparse: true,
    })
  );
  result.unresolved.forEach((slot, index) =>
    list.push({
      id: `unresolved:${index}`,
      kind: "unresolved",
      question: questionFor(slot),
      options: slot.suggestions,
      allowDismiss: false,
      needsReparse: false,
    })
  );
  result.uncovered.forEach((fragment, index) =>
    list.push({
      id: `uncovered:${index}`,
      kind: "uncovered",
      question: `I didn't understand “${fragment}”. Rephrase it below, or leave it out.`,
      options: [],
      allowDismiss: true,
      needsReparse: false,
    })
  );
  return list;
}

function patchRuleForSlot(rule: WorkflowRule, slot: UnresolvedSlot, answer: string): WorkflowRule {
  const next: WorkflowRule = JSON.parse(JSON.stringify(rule));
  if (slot.where === "action-param") {
    const lane = slot.lane === "else" ? (next.else ?? []) : next.actions;
    const output = lane[slot.actionIndex ?? 0];
    if (output) output.params[slot.param ?? "value"] = answer;
    if (slot.lane === "else") next.else = lane;
    return next;
  }
  if (slot.where === "condition-value") {
    // conditionIndex addresses the leaf in walk order over a flat v3 draft.
    let cursor = 0;
    const visit = (node: WorkflowRule["conditions"]): void => {
      for (const child of node.children) {
        if ("children" in child) visit(child as WorkflowRule["conditions"]);
        else if (cursor++ === (slot.conditionIndex ?? 0)) (child as { value: unknown }).value = answer;
      }
    };
    visit(next.conditions);
    return next;
  }
  // Event slot: only accept a known event key — otherwise leave untouched.
  if (getEvent(answer)) next.triggers = [{ event: answer }, ...next.triggers.slice(1)];
  return next;
}

/**
 * Apply an answer (or an explicit dismiss) to the parse result. Returns a NEW
 * ParseResult with the rule patched and the resolved sidecar entry removed —
 * coverage recomputes downstream via parseGate. Ambiguities are not handled
 * here (re-parse with forceEvent). Unknown ids return the result unchanged.
 */
export function applyClarification(
  result: ParseResult,
  id: string,
  answer: string | { dismiss: true }
): ParseResult {
  const [kind, indexRaw] = id.split(":");
  const index = Number(indexRaw);

  if (kind === "uncovered" && typeof answer === "object" && answer.dismiss) {
    const fragment = result.uncovered[index];
    if (fragment === undefined) return result;
    return {
      ...result,
      uncovered: result.uncovered.filter((_, i) => i !== index),
      notes: [...result.notes, `Left out by your choice: “${fragment}”.`],
    };
  }

  if (kind === "unresolved" && typeof answer === "string" && answer.trim()) {
    const slot = result.unresolved[index];
    if (!slot || !result.rule) return result;
    return {
      ...result,
      rule: patchRuleForSlot(result.rule, slot, answer.trim()),
      unresolved: result.unresolved.filter((_, i) => i !== index),
      notes: [...result.notes, `You confirmed: ${slot.param ?? slot.where} → ${answer.trim()}.`],
    };
  }

  return result;
}
