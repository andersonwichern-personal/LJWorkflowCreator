/**
 * Client-side rule-matching engine (demo).
 *
 * Evaluates a saved WorkflowRule against the representative platform data so the
 * app can answer "which requests would this rule match?" and "which workflows
 * would fire on this event?". This is a *simulation* for the demo — the real
 * engine (event bus + condition evaluator + action executor) lives across the
 * backend microservices and is out of scope for the first demo.
 */

import { WorkflowRule, RuleCondition, FIELDS, getAction, paramKeyFor } from "./vocabulary";
import {
  PlatformRequest,
  SystemEvent,
  REQUESTS,
  deriveDataStatus,
  deriveProcessingStatus,
} from "./platformData";
import { WorkflowRecord } from "./api";

const UNKNOWN = Symbol("unknown");

/** Resolve a workflow condition-field key to a value on a request. */
function fieldValue(r: PlatformRequest, field: string): string | number | string[] | null | typeof UNKNOWN {
  switch (field) {
    case "bookstatus": return r.bookStatus;
    case "uwstatus": return r.uwStatus;
    case "queue": return r.uwQueue;
    case "loan_amount": return r.loanAmount;
    case "team_member": return r.teamMember;
    case "offer_queue": return r.offerQueue;
    case "stage": return r.stage;
    case "custtype": return r.customerType;
    case "main_borrower": return r.mainBorrower;
    case "core": return r.core;
    case "loan_product": return r.loanProduct;
    case "retailer": return r.retailer;
    case "program": return r.program;
    case "tags": return r.tags;
    case "data_status": return deriveDataStatus(r);
    case "processing_status": return deriveProcessingStatus(r);
    default: return UNKNOWN; // reqtype, role, doc_status, credit_score — not in demo data
  }
}

function eq(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function evalCondition(r: PlatformRequest, c: RuleCondition): boolean {
  const actual = fieldValue(r, c.field);
  if (actual === UNKNOWN || actual === null) return false;

  const kind = FIELDS[c.field]?.kind ?? "text";

  if (kind === "numeric") {
    const a = Number(actual);
    const b = Number(c.value);
    if (isNaN(a) || isNaN(b)) return false;
    switch (c.operator) {
      case "gt": return a > b;
      case "gte": return a >= b;
      case "lt": return a < b;
      case "lte": return a <= b;
      default: return a === b;
    }
  }

  // Array field (tags): "is"/"contains" mean membership; "is_not" means absence.
  if (Array.isArray(actual)) {
    const has = actual.some((v) => eq(v, c.value));
    return c.operator === "is_not" ? !has : has;
  }

  const s = String(actual);
  switch (c.operator) {
    case "is": return eq(s, c.value);
    case "is_not": return !eq(s, c.value);
    case "contains": return s.toLowerCase().includes(c.value.toLowerCase());
    default: return eq(s, c.value);
  }
}

/** Does a request's current state correspond to the rule's trigger event? */
export function requestMatchesEvent(r: PlatformRequest, eventKey: string): boolean {
  switch (eventKey) {
    case "SYSTEM ERROR": return r.bookStatus === "Error";
    case "LOAN APPROVED": return r.uwStatus === "Approved" || r.uwStatus === "Auto Approved";
    case "LOAN REJECTED": return r.uwStatus === "Rejected";
    case "OFFER ACCEPTED": return r.offerQueue === "Assigned";
    case "FISERV LOAN": return r.core === "FISERV LOAN" && r.bookStatus !== "Not Sent";
    case "FMAC LOAN": return r.core === "FMAC LOAN" && r.bookStatus !== "Not Sent";
    case "REQUEST CREATED": return true;
    case "OFFER MADE": return r.offerQueue !== null;
    default: return false;
  }
}

/** Evaluate a full rule (event + conditions) against a request. */
export function evaluateRule(rule: WorkflowRule, r: PlatformRequest): boolean {
  if (!requestMatchesEvent(r, rule.event)) return false;
  if (rule.conds.length === 0) return true;
  const results = rule.conds.map((c) => evalCondition(r, c));
  return rule.condLogic === "OR" ? results.some(Boolean) : results.every(Boolean);
}

/** All demo requests a rule would match right now. */
export function matchingRequests(rule: WorkflowRule): PlatformRequest[] {
  return REQUESTS.filter((r) => evaluateRule(rule, r));
}

/** Saved workflows that would act on a given request. */
export function workflowsForRequest(r: PlatformRequest, workflows: WorkflowRecord[]): WorkflowRecord[] {
  return workflows.filter((w) => w.enabled && evaluateRule(w.ruleJson, r));
}

/** Saved workflows that would fire on a given system event. */
export function workflowsForEvent(evt: SystemEvent, workflows: WorkflowRecord[]): WorkflowRecord[] {
  const req = REQUESTS.find((r) => r.id === evt.requestId);
  return workflows.filter((w) => {
    if (!w.enabled || w.ruleJson.event !== evt.type) return false;
    return req ? evaluateRule(w.ruleJson, req) : w.ruleJson.conds.length === 0;
  });
}

/** Human-readable list of the actions a rule would perform. */
export function describeActions(rule: WorkflowRule): string[] {
  return rule.outputs.map((o) => {
    const action = getAction(o.action);
    const label = action?.label ?? o.action;
    if (action?.paramKind === "none") return label;
    const val = o.params[paramKeyFor(o.action)] || "…";
    return `${label} ${val}`;
  });
}
