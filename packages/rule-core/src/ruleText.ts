/**
 * ruleText — canonical plain-English serialization of a WorkflowRule
 * (Phase 1.6: builder ⇄ parser bi-directional sync).
 *
 * The inverse of nlParser's parseInstruction for the parser-covered subset of
 * the vocabulary: composeRuleText(rule) emits a description the deterministic
 * parser reads back to an equivalent rule (pinned by
 * core-tests/assert-rule-text.ts). Rule pieces the parser has no grammar for
 * (route_to_queue, remove_tag, request_signature, …) are still rendered
 * readably — the composed text is presentational first; the committed rule
 * object stays the source of truth. Known re-parse limitations:
 *
 *  - Triggers are emitted as a quoted event-key mention ("“Loan approved”
 *    fires"), which the parser resolves via its direct-key branch. If another
 *    clause embeds a LONGER event key (e.g. a core-system value "FISERV
 *    LOAN" under an "FMAC LOAN" trigger), the parser's longest-key rule picks
 *    that one instead.
 *  - Same-subject approved/rejected trigger pairs serialize to the natural
 *    dual form ("a loan is approved or rejected") only when no other subject
 *    word (document/offer/loan/request/application) appears elsewhere in the
 *    sentence — the parser requires an unambiguous subject.
 *  - The parser scans the whole sentence for distinctive enum options, so a
 *    re-parse may pick up extra rough-match conditions from action clauses
 *    (existing parser behavior, not introduced here).
 */
import {
  ConditionFieldRef,
  ConditionGroup,
  ConditionLeaf,
  ConditionNode,
  CondLogic,
  RuleOutput,
  WorkflowRule,
  condFieldDef,
  condFieldKind,
  condFieldLabel,
  formatDelay,
  getAction,
  isGroup,
  paramKeyFor,
  scopeLabel,
} from "./vocabulary";

/** "LOAN APPROVED" → "Loan approved" (norm() lowercases it back for matching). */
function sentenceCase(key: string): string {
  const lower = key.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/* -------------------------------------------------------------------------- */
/* Triggers                                                                   */
/* -------------------------------------------------------------------------- */

const DUAL_SUBJECT_WORDS: Record<string, { phrase: string; foreign: RegExp }> = {
  LOAN: { phrase: "a loan is", foreign: /\b(document|offer)\b/ },
  DOCUMENT: { phrase: "a document is", foreign: /\b(offer|loan|request|application)\b/ },
  OFFER: { phrase: "an offer is", foreign: /\b(document|loan|request|application)\b/ },
};

/**
 * Natural dual-trigger phrase ("a loan is approved or rejected") for the
 * same-subject verb pairs the parser's dual-trigger branch understands.
 * `restOfSentence` guards the parser's single-subject requirement.
 */
function dualTriggerPhrase(events: string[], restOfSentence: string): string | null {
  if (events.length !== 2) return null;
  const parse = (key: string) => /^(LOAN|DOCUMENT|OFFER) (APPROVED|REJECTED|ACCEPTED)$/.exec(key);
  const a = parse(events[0]);
  const b = parse(events[1]);
  if (!a || !b || a[1] !== b[1] || a[2] === b[2]) return null;
  const subject = DUAL_SUBJECT_WORDS[a[1]];
  if (!subject || subject.foreign.test(restOfSentence.toLowerCase())) return null;
  return `${subject.phrase} ${a[2].toLowerCase()} or ${b[2].toLowerCase()}`;
}

function triggerPhrase(rule: WorkflowRule, restOfSentence: string): string {
  const events = rule.triggers.map((t) => t.event);
  if (events.length === 0) return "…";
  const dual = dualTriggerPhrase(events, restOfSentence);
  if (dual) return dual;
  return `${events.map((e) => `“${sentenceCase(e)}”`).join(" or ")} fires`;
}

/* -------------------------------------------------------------------------- */
/* Conditions                                                                 */
/* -------------------------------------------------------------------------- */

/** Operator → the phrasing nlParser's numeric branch maps back to the operator. */
const NUMERIC_OP_PHRASES: Record<string, string> = {
  is: "is",
  gt: "is over",
  gte: "is at least",
  lt: "is under",
  lte: "is at most",
};

function numericValue(field: ConditionFieldRef, raw: string): string {
  const def = condFieldDef(field);
  if (def?.unit === "$" && /^\d+$/.test(raw)) {
    return `$${Number(raw).toLocaleString("en-US")}`;
  }
  return raw || "…";
}

export function conditionPhrase(leaf: ConditionLeaf): string {
  const label = condFieldLabel(leaf.field);
  if (leaf.operator === "is_empty") return `${label} is empty`;
  if (leaf.operator === "is_not_empty") return `${label} is not empty`;
  const value = scopeLabel(leaf.value);
  if (condFieldKind(leaf.field) === "numeric") {
    const op = NUMERIC_OP_PHRASES[leaf.operator] ?? "is";
    return `${label} ${op} ${numericValue(leaf.field, value)}`;
  }
  if (leaf.operator === "worse_than") return `${label} is worse than ${value || "…"}`;
  if (leaf.operator === "better_than") return `${label} is better than ${value || "…"}`;
  if (leaf.operator === "is_not") return `${label} is not ${value || "…"}`;
  if (leaf.operator === "contains") return `${label} contains ${value || "…"}`;
  return `${label} is ${value || "…"}`;
}

function logicJoin(logic: CondLogic): string {
  return logic === "OR" ? " or " : " and ";
}

function nodePhrase(node: ConditionNode): string {
  if (isGroup(node)) {
    return `(${node.children.map(nodePhrase).join(logicJoin(node.logic))})`;
  }
  return conditionPhrase(node);
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One phrase per action. The first block round-trips through matchOutputs;
 * the rest are readable-only (their verbs deliberately avoid the parser's
 * assign/route/escalate/notify/change-stage/add-tag/close patterns so a
 * re-parse never misreads them as a different action).
 */
export function actionPhrase(output: RuleOutput): string {
  const def = getAction(output.action);
  const value = scopeLabel(output.params[def ? paramKeyFor(def.key) : "value"]);
  const v = value || "…";
  let phrase: string;
  switch (output.action) {
    case "assign_user": phrase = `assign to ${v}`; break;
    case "notify": phrase = `notify ${v}`; break;
    case "assign_authority":
      phrase = value ? `escalate to ${value.toLowerCase()}` : "escalate to the authority";
      break;
    case "change_stage": phrase = `change stage to ${v}`; break;
    case "add_tag": phrase = `add tag ${v}`; break;
    case "close_request": phrase = "close the request"; break;
    case "remove_tag": phrase = `remove tag ${v}`; break;
    case "route_to_queue": phrase = `move it into the ${v} queue`; break;
    case "set_underwriting_result": phrase = `record the underwriting result as ${v}`; break;
    case "request_signature": phrase = `request a signature from ${v}`; break;
    case "pull_credit": phrase = "pull credit"; break;
    case "run_extraction": phrase = "run document extraction"; break;
    case "request_document": phrase = `request the ${v} document`; break;
    case "assign_checklist": phrase = `attach the ${v} checklist`; break;
    case "make_offer": phrase = `make an offer for ${v}`; break;
    case "trigger_booking": phrase = `send the booking to ${v}`; break;
    case "log_event": phrase = `log a system event (${v})`; break;
    case "send_webhook": phrase = `send a webhook to ${v}`; break;
    default:
      phrase = def ? `${def.label}${value ? ` ${value}` : ""}` : output.action.replace(/_/g, " ");
  }
  if (output.delayMinutes && output.delayMinutes > 0) {
    phrase += ` after ${formatDelay(output.delayMinutes)}`;
  } else if (output.delayMinutes && output.delayMinutes < 0) {
    phrase += ` ${formatDelay(output.delayMinutes)}`;
  }
  if (output.when && output.when.children.length) {
    phrase += ` if ${output.when.children.map(nodePhrase).join(logicJoin(output.when.logic))}`;
  }
  return phrase;
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                   */
/* -------------------------------------------------------------------------- */

function controlSuffixes(rule: WorkflowRule): string[] {
  const suffixes: string[] = [];
  if (rule.controls.mode === "armed") suffixes.push("Arm live actions.");
  if (rule.controls.maxFiresPerHour !== 25) {
    suffixes.push(`Cap at ${rule.controls.maxFiresPerHour} fires per hour.`);
  }
  return suffixes;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function composeRuleText(rule: WorkflowRule): string {
  const conds = rule.conditions.children;
  const condPhrase = conds.length
    ? `if ${conds.map(nodePhrase).join(logicJoin(rule.conditions.logic))}`
    : "";
  const actionsPhrase = rule.actions.length
    ? `${conds.length ? "then " : ""}${rule.actions.map(actionPhrase).join(" and ")}`
    : "";
  const elsePhrase = rule.else?.length
    ? `; otherwise, ${rule.else.map(actionPhrase).join(" and ")}`
    : "";

  // The trigger phrase is chosen LAST so the natural dual form can check the
  // rest of the sentence for competing subject words.
  const rest = [condPhrase, actionsPhrase, elsePhrase].filter(Boolean).join(", ");
  const parts = [`When ${triggerPhrase(rule, rest)}`, condPhrase, actionsPhrase].filter(Boolean);

  let text = parts.join(", ") + elsePhrase + ".";
  const suffixes = controlSuffixes(rule);
  if (suffixes.length) text += ` ${suffixes.join(" ")}`;
  return text;
}
