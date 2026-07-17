/**
 * GENERATED from packages/rule-core/src/interpretation.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/rule-core contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * interpretation — plain-language reading of a canonical rule (composer
 * roadmap MVP 2).
 *
 * Deterministic prose generated FROM the rule itself — never from the user's
 * description and never by a model — so what the client reviews is exactly
 * what the runtime will execute. The client-facing vocabulary deliberately
 * avoids the internal grammar: no "When", "If", "Then", "Otherwise",
 * condition groups, operators, or JSON.
 */
import {
  WorkflowRule,
  RuleOutput,
  condFieldKind,
  condFieldLabel,
  getAction,
  getEvent,
  isValuelessOperator,
  opLabel,
  paramKeyFor,
  scopeLabel,
  walkLeaves,
} from "./vocabulary";

export interface Interpretation {
  /** One/two-sentence plain-language reading of the whole rule. */
  summary: string;
  /** Short verifiable statements, one per rule component. */
  checklist: string[];
}

/** Client phrasing for trigger events — subject of the summary sentence. */
const EVENT_SUBJECTS: Record<string, string> = {
  "LOAN APPROVED": "approved loans",
  "LOAN REJECTED": "rejected loans",
  "LOAN BOOKED": "booked loans",
  "OFFER ACCEPTED": "accepted offers",
  "OFFER MADE": "new offers",
  "OFFER REJECTED": "rejected offers",
  "SYSTEM ERROR": "requests that hit a system error",
  "REQUEST CREATED": "new requests",
  "REQUEST SUBMITTED": "submitted requests",
  "DOCUMENT UPLOADED": "requests with a newly uploaded document",
  "DOCUMENT APPROVED": "requests with an approved document",
  "DOCUMENT REJECTED": "requests with a rejected document",
  "SIGNATURE COMPLETED": "requests with a completed signature",
  "CHECKLIST COMPLETED": "requests with a completed checklist",
};

/** What the trigger means as a verifiable check. */
const EVENT_CHECKS: Record<string, string> = {
  "LOAN APPROVED": "Approval status will be checked.",
  "LOAN REJECTED": "Rejection status will be checked.",
  "OFFER ACCEPTED": "Offer acceptance will be checked.",
  "SYSTEM ERROR": "System errors will be watched.",
};

/** Numeric fields that read as money. */
const CURRENCY_FIELD = /amount|limit|exposure|balance|income/i;

function formatValue(fieldKey: string, raw: string): string {
  if (CURRENCY_FIELD.test(fieldKey) && /^\d+(\.\d+)?$/.test(raw)) {
    return `$${Number(raw).toLocaleString("en-US")}`;
  }
  return raw;
}

function subjectFor(rule: WorkflowRule): string {
  const subjects = rule.triggers.map((t) => {
    const key = t.event;
    return EVENT_SUBJECTS[key] ?? `requests where “${(getEvent(key)?.label ?? key).toLowerCase()}” occurs`;
  });
  return subjects.join(" or ");
}

interface LeafPhrases {
  summary: string;
  checklist: string;
}

/** Sentence-case for checklist voice ("loan amount" → "Loan amount"). */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function phraseLeaf(leaf: { field: unknown; operator: string; value: unknown }): LeafPhrases {
  const kind = condFieldKind(leaf.field as never);
  const label = cap(condFieldLabel(leaf.field as never));
  const op = opLabel(kind, leaf.operator as never);
  const fieldKey = typeof leaf.field === "string" ? leaf.field : label;
  if (isValuelessOperator(leaf.operator as never)) {
    return { summary: `where ${label.toLowerCase()} ${op}`, checklist: `${label} ${op} — this will be checked.` };
  }
  const value = formatValue(fieldKey, scopeLabel(leaf.value as never) || "(needs a value)");
  // "is at least $250,000" → summary "of $250,000 or more" for money; the
  // checklist keeps the requirement voice: "must be at least".
  if (kind === "numeric" && leaf.operator === "gte" && CURRENCY_FIELD.test(fieldKey)) {
    return { summary: `of ${value} or more`, checklist: `${label} must be at least ${value}.` };
  }
  const requirement = op.startsWith("is ") ? `must be ${op.slice(3)}` : op === "is" ? "must be" : `must ${op}`;
  return { summary: `where ${label.toLowerCase()} ${op} ${value}`, checklist: `${label} ${requirement} ${value}.` };
}

function phraseAction(output: RuleOutput): LeafPhrases {
  const def = getAction(output.action);
  const key = paramKeyFor(output.action);
  const param = def?.paramKind === "none" ? "" : scopeLabel(output.params[key]) || "";
  const target = param || "(needs an answer)";
  switch (output.action) {
    case "assign_user":
      return { summary: `assign the request to ${target}`, checklist: `${target} will be assigned the request.` };
    case "notify":
      return { summary: `notify ${target}`, checklist: `${target} will be notified.` };
    case "change_stage":
      return { summary: `move it to ${target}`, checklist: `The request will move to ${target}.` };
    case "close_request":
      return { summary: "close the request", checklist: "The request will be closed." };
    case "add_tag":
      return { summary: `tag it “${target}”`, checklist: `The tag “${target}” will be added.` };
    default: {
      const label = def?.label ?? output.action.replace(/_/g, " ");
      const phrase = param ? `${label} ${param}` : label;
      return { summary: phrase, checklist: `Will ${phrase}.` };
    }
  }
}

/** Plain-language interpretation of a canonical rule. Deterministic. */
export function interpretRule(rule: WorkflowRule): Interpretation {
  const subject = subjectFor(rule);
  const leaves = walkLeaves(rule.conditions).map(phraseLeaf);
  const actions = rule.actions.map(phraseAction);
  const elseActions = (rule.else ?? []).map(phraseAction);

  const condSummary = leaves.map((l) => l.summary).join(rule.conditions.logic === "OR" ? " or " : " and ");
  const actionSummary = actions.length
    ? actions.map((a) => a.summary).join(" and ")
    : "take no action yet (none defined)";
  const elseSummary = elseActions.length
    ? `All other requests: ${elseActions.map((a) => a.summary).join(" and ")}.`
    : "All other requests will be left unchanged.";

  const summary = `For ${subject}${condSummary ? ` ${condSummary}` : ""}, ${actionSummary}. ${elseSummary}`;

  const checklist: string[] = [];
  for (const t of rule.triggers) {
    checklist.push(EVENT_CHECKS[t.event] ?? `Applies to ${EVENT_SUBJECTS[t.event] ?? (getEvent(t.event)?.label ?? t.event).toLowerCase()}.`);
  }
  checklist.push(...leaves.map((l) => l.checklist));
  checklist.push(...actions.map((a) => a.checklist));
  if (elseActions.length) {
    checklist.push(...elseActions.map((a) => `Requests that do not qualify: ${a.summary}.`));
  } else {
    checklist.push("Requests that do not qualify will remain unchanged.");
  }
  return { summary, checklist };
}
