/**
 * orgPolicy — centralized safety controls (composer roadmap MVP 5).
 *
 * Clients no longer configure Shadow/Armed, once-per-request, fire caps,
 * missing-data strategy, or priority. Policy stamps them deterministically
 * from the rule's own shape (trigger frequency, action risk); the client
 * sees a read-only "Protections applied" summary and observation-first
 * activation states. The internal builder can still inspect raw controls
 * (roadmap Phase 8 role-gates that).
 */
import { WorkflowRule, RuleControls } from "./vocabulary";

export type RiskClass = "standard" | "elevated";
export type WorkflowState = "observing" | "active" | "paused";

export interface ProtectionSummary {
  title: string;
  description: string;
}

/**
 * Actions whose live effects reach money, credit, or records of decision —
 * these classify the workflow as elevated risk (approval required to go
 * live; the four-eyes gate enforces it on the write path).
 */
const ELEVATED_ACTIONS = new Set([
  "assign_authority",
  "trigger_booking",
  "make_offer",
  "set_underwriting_result",
  "close_request",
  "pull_credit",
]);

/**
 * Expected event frequency drives the volume cap (roadmap: "volume limits
 * are based on expected event frequency"). High-churn document/request
 * events get headroom; decision events are rare and capped tight.
 */
const HIGH_FREQUENCY_EVENTS = new Set([
  "REQUEST CREATED",
  "REQUEST SUBMITTED",
  "REQUEST STAGE CHANGED",
  "DOCUMENT UPLOADED",
  "EXTRACTION COMPLETED",
]);

export function riskClassification(rule: WorkflowRule): RiskClass {
  const outputs = [...rule.actions, ...(rule.else ?? [])];
  return outputs.some((output) => ELEVATED_ACTIONS.has(output.action)) ? "elevated" : "standard";
}

/** The policy-stamped controls for a rule — deterministic, never client-set. */
export function policyControls(rule: WorkflowRule): RuleControls {
  const highFrequency = rule.triggers.some((t) => HIGH_FREQUENCY_EVENTS.has(t.event));
  return {
    // New workflows always begin observing; activation is a separate,
    // deliberate step (Phase 7). The client never sees the word "shadow".
    mode: "shadow",
    // Idempotency on by default.
    oncePerRequest: true,
    // Missing data fails safely.
    missingData: "no_match",
    // Volume limit from expected event frequency.
    maxFiresPerHour: highFrequency ? 100 : 25,
    // Ordering is resolved centrally, not by a client-entered number.
    priority: 100,
  };
}

/** Return the rule with organization policy applied to its controls. */
export function applyOrgPolicy(rule: WorkflowRule): WorkflowRule {
  return { ...rule, controls: policyControls(rule) };
}

/** Read-only client summary of the protections policy applies. */
export function protectionsFor(rule: WorkflowRule): ProtectionSummary[] {
  const protections: ProtectionSummary[] = [
    {
      title: "Runs once per request",
      description: "The same request can never trigger this workflow twice.",
    },
    {
      title: "Safe with missing data",
      description: "A request missing the information this workflow checks is left alone, never guessed at.",
    },
    {
      title: "Volume monitoring",
      description: "Unusual activity pauses the workflow automatically.",
    },
    {
      title: "Starts in observation",
      description: "New workflows watch and record what they would do before anything real happens.",
    },
  ];
  if (riskClassification(rule) === "elevated") {
    protections.push({
      title: "Approval required",
      description: "This workflow's actions affect decisions or money, so going live requires a second pair of eyes.",
    });
  }
  return protections;
}

/**
 * Client-language lifecycle state for a saved workflow. Internal
 * shadow/armed + enabled flags map onto Observing / Active / Paused.
 */
export function workflowState(record: { enabled: boolean; ruleJson: WorkflowRule }): WorkflowState {
  if (!record.enabled) return "paused";
  return record.ruleJson.controls.mode === "armed" ? "active" : "observing";
}

/** Display metadata for a state chip. */
export const STATE_LABELS: Record<WorkflowState, { label: string; description: string }> = {
  observing: {
    label: "Observing",
    description: "Watching real requests and recording what it would do — no real effects yet.",
  },
  active: { label: "Active", description: "Live — actions run for real." },
  paused: { label: "Paused", description: "Not watching or acting." },
};
