/**
 * GENERATED from packages/rule-core/src/ruleEngine.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/rule-core contract for the Angular track
 * (two-track doctrine: docs/agent/task.md). To change it, edit the package
 * and run `npm run sync:angular-core` at the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * Client-side rule-matching engine (demo).
 *
 * Evaluates a saved WorkflowRule against the representative platform data so the
 * app can answer "which requests would this rule match?" and "which workflows
 * would fire on this event?". This is a *simulation* for the demo — the real
 * engine (event bus + condition evaluator + action executor) lives across the
 * backend microservices and is out of scope for the first demo.
 */

import {
  WorkflowRule,
  getAction,
  paramKeyFor,
  scopeLabel,
} from "./vocabulary";
// Circular at module level only; both modules dereference at call time.
import { ruleMatches } from "./ruleEvaluator";
import {
  PlatformRequest,
  SystemEvent,
  REQUESTS,
  deriveDataStatus,
  deriveProcessingStatus,
} from "./platformData";
import { WorkflowRecord } from "./types";

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
    case "customer_name": return r.mainBorrower;
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

/**
 * Public resolver for the traced simulator (lib/ruleEvaluator.ts): resolve a
 * condition-field key on a request, reporting whether the field is known to
 * the demo data at all (unknown ≠ empty — the trace shows the difference).
 */
export function resolveField(
  r: PlatformRequest,
  fieldKey: string
): { known: boolean; value: string | number | string[] | null } {
  const v = fieldValue(r, fieldKey);
  if (v === UNKNOWN) return { known: false, value: null };
  return { known: true, value: v };
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

/**
 * Evaluate a full rule (multi-trigger OR + recursive condition groups) against a
 * request. Delegates to the single traced engine in lib/ruleEvaluator.ts so the
 * list-match path and the simulator can never disagree (§2.6, §3.3).
 */
export function evaluateRule(rule: WorkflowRule, r: PlatformRequest): boolean {
  return ruleMatches(rule, r);
}

/** All demo requests a rule would match right now. */
export function matchingRequests(rule: WorkflowRule): PlatformRequest[] {
  return REQUESTS.filter((r) => evaluateRule(rule, r));
}

/** Saved workflows that would act on a given request. */
export function workflowsForRequest(r: PlatformRequest, workflows: WorkflowRecord[]): WorkflowRecord[] {
  return workflows.filter((w) => w.enabled && evaluateRule(w.ruleJson, r));
}

/** Saved workflows that would fire on a given system event (multi-trigger OR). */
export function workflowsForEvent(evt: SystemEvent, workflows: WorkflowRecord[]): WorkflowRecord[] {
  const req = REQUESTS.find((r) => r.id === evt.requestId);
  return workflows.filter((w) => {
    if (!w.enabled || !w.ruleJson.triggers.some((t) => t.event === evt.type)) return false;
    return req ? evaluateRule(w.ruleJson, req) : w.ruleJson.conditions.children.length === 0;
  });
}

/** Human-readable list of the actions a rule would perform. */
export function describeActions(rule: WorkflowRule): string[] {
  return rule.actions.map((o) => {
    const action = getAction(o.action);
    const label = action?.label ?? o.action;
    if (action?.paramKind === "none") return label;
    const val = scopeLabel(o.params[paramKeyFor(o.action)]) || "…";
    return `${label} ${val}`;
  });
}
