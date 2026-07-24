/**
 * GENERATED from packages/workflow-brain/src/consultant.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/workflow-brain contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * consultant — the structured consultant turn (fully deterministic this wave).
 *
 * planConsultantTurn assembles one complete, honest advisory turn from
 * deterministic inputs only: interpretRule for the understanding,
 * clarificationsFor for the questions, the recommendations analyzers for the
 * evidence-backed advice, and describePatch for every previewed change. No
 * model text reaches any field, so the same envelope + snapshot + rule always
 * produce the byte-same turn.
 *
 * Consent is exact and stale-safe: acceptRecommendation applies ONLY the ops
 * that were previewed, refuses when the snapshotId or ruleVersion the
 * recommendation was computed against has drifted (the same freshness test the
 * brainState reducer applies), refuses tampered recommendation objects (the id
 * is a content hash and is re-verified), and re-runs validateRule on the
 * patched rule so a patch can never smuggle in a new blocking error.
 *
 * Prohibited by construction, not by policy prose: no invented facts, no
 * flattery, no arming/activation advice, no promises of timed execution
 * (delays and per-action gates are persisted but not executed by the current
 * runtime — they surface as watchouts), no customer content in contextUsed,
 * and no questions beyond the parser's own clarifications.
 */

import type { RecommendationRef } from "./brainState";
import { applyRulePatch, describePatch, RulePatchOp } from "./proposals";
import {
  AnalyzerInput,
  ConsultantFact,
  Recommendation,
  deriveFacts,
  deriveRecommendations,
  recommendationId,
} from "./recommendations";
import { clarificationsFor } from "../core/clarifications";
import { interpretRule } from "../core/interpretation";
import { validateRule } from "../core/ruleValidation";
import type { ParseEnvelope } from "../core/parserProvenance";
import { WorkflowRule } from "../core/vocabulary";

/* -------------------------------------------------------------------------- */
/* Turn contracts                                                             */
/* -------------------------------------------------------------------------- */

export interface ConsultantQuestion {
  /** Clarification id (`kind:index`) — stable within one parse generation. */
  id: string;
  question: string;
  options: string[];
  /** Clause ids this open question blocks (from the envelope's clause links). */
  blocksClauses: string[];
  /** Higher = blocks more of the description; drives ordering. */
  priority: number;
}

export interface ConsultantAlternative {
  id: string;
  title: string;
  tradeoff: string;
}

export interface ConsultantTurn {
  understanding: string;
  facts: ConsultantFact[];
  /** At most two — one focused ask beats a questionnaire. */
  questions: ConsultantQuestion[];
  recommendations: Recommendation[];
  watchouts: string[];
  /** Only when a REAL tradeoff exists — otherwise empty, never filler. */
  alternatives: ConsultantAlternative[];
  proposedChanges: Array<{ recommendationId: string; ops: RulePatchOp[]; preview: string }>;
  /** Exactly one next step. */
  nextBestAction: string;
  /** Source/version provenance only — never labels or customer content. */
  contextUsed: Array<{ source: string; version: string }>;
  suggestedName?: string;
  /** Rule is valid and every proposed patch applies cleanly to it. */
  canApply: boolean;
  /** Host four-eyes policy — pass-through, the Brain never grants approvals. */
  requiresApproval: boolean;
}

/* -------------------------------------------------------------------------- */
/* Turn assembly                                                              */
/* -------------------------------------------------------------------------- */

function djb2(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (((h << 5) + h) ^ text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function gapCount(envelope: ParseEnvelope): number {
  return envelope.unresolved.length + envelope.uncovered.length + envelope.ambiguities.length;
}

/** Honest reading: never overstate; when there is no rule, say what IS known. */
function planUnderstanding(rule: WorkflowRule | null, envelope: ParseEnvelope): string {
  if (!rule) {
    const parts = ["No workflow rule is drafted yet from this description."];
    if (envelope.uncovered.length > 0) {
      parts.push(`${envelope.uncovered.length} phrase(s) could not be mapped to the workflow vocabulary.`);
    }
    if (envelope.unresolved.length > 0) {
      parts.push(`${envelope.unresolved.length} name(s) still need to be confirmed.`);
    }
    if (envelope.ambiguities.length > 0) {
      parts.push(`${envelope.ambiguities.length} part(s) can be read more than one way.`);
    }
    return parts.join(" ");
  }
  const summary = interpretRule(rule).summary;
  const gaps = gapCount(envelope);
  if (gaps === 0) return summary;
  return `${summary} This reading is incomplete: ${gaps} item(s) still need confirmation before the rule can run.`;
}

const CLARIFICATION_STATUS: Record<string, string> = {
  ambiguity: "ambiguous",
  unresolved: "unresolved",
  uncovered: "uncovered",
};

/** Questions come ONLY from real clarifications; at most two, most-blocking first. */
function planQuestions(envelope: ParseEnvelope): ConsultantQuestion[] {
  const links = envelope.clauseLinks ?? [];
  const all = clarificationsFor(envelope).map((c) => {
    const blocksClauses = links
      .filter((l) => l.status === CLARIFICATION_STATUS[c.kind])
      .map((l) => l.clauseId);
    return { id: c.id, question: c.question, options: c.options, blocksClauses, priority: blocksClauses.length };
  });
  // Stable sort: more blocked clauses first; clarificationsFor order breaks ties
  // (ambiguities lead, since answering one re-reads the whole description).
  return all
    .map((q, index) => ({ q, index }))
    .sort((a, b) => b.q.priority - a.q.priority || a.index - b.index)
    .map((x) => x.q)
    .slice(0, 2);
}

function planWatchouts(envelope: ParseEnvelope, facts: ConsultantFact[]): string[] {
  const out: string[] = [];
  // Silent intent inversion outranks everything else a watchout can say.
  for (const fact of facts) if (fact.kind === "inverted-condition-risk") out.push(fact.message);
  for (const fact of facts) if (fact.kind === "unsupported-timing") out.push(fact.message);
  for (const fact of facts) if (fact.kind === "contradiction") out.push(`Contradiction: ${fact.message}`);
  for (const entry of envelope.unsupported ?? []) {
    out.push(`"${entry.text}" is not something this platform can run: ${entry.reason}`);
  }
  for (const fact of facts) if (fact.kind === "unconfirmed-vocabulary") out.push(fact.message);
  return out;
}

/** Alternatives exist only where a real operational tradeoff does. */
function planAlternatives(rule: WorkflowRule | null): ConsultantAlternative[] {
  if (!rule) return [];
  const out: ConsultantAlternative[] = [];
  const hasAssign = rule.actions.some((a) => a.action === "assign_user");
  const hasNotify = rule.actions.some((a) => a.action === "notify");
  if (hasAssign && !hasNotify) {
    out.push({
      id: `alt-${djb2("assign-plus-notify|actions")}`,
      title: "Notify alongside the assignment",
      tradeoff:
        "Assignment alone changes ownership silently — the assignee finds out when they next open the queue. Adding a notify makes the hand-off visible immediately, at the cost of inbox noise on high-volume rules.",
    });
  }
  return out;
}

function planNextBestAction(
  rule: WorkflowRule | null,
  envelope: ParseEnvelope,
  questions: ConsultantQuestion[],
  recommendations: Recommendation[],
  ruleValid: boolean
): string {
  if (questions.length > 0) return `Answer the question: ${questions[0].question}`;
  const actionable = recommendations.find((r) => r.riskLevel === "high" || r.patch !== undefined);
  if (actionable) return `Review the recommendation "${actionable.title}" and accept or reject it.`;
  if (rule && ruleValid && gapCount(envelope) === 0) {
    return "Simulate this rule against recent requests to confirm it matches what you expect.";
  }
  return "Refine the description so a complete rule can be drafted.";
}

/** Deterministic name from the interpretRule summary (name lives OUTSIDE rule JSON). */
function suggestedNameFor(rule: WorkflowRule): string {
  const firstSentence = interpretRule(rule).summary.split(". ")[0];
  let name = firstSentence.startsWith("For ") ? firstSentence.slice(4) : firstSentence;
  name = name.charAt(0).toUpperCase() + name.slice(1);
  if (name.length > 80) name = `${name.slice(0, 79).trimEnd()}…`;
  return name;
}

export function planConsultantTurn(input: AnalyzerInput & { requiresApproval: boolean }): ConsultantTurn {
  const { rule, envelope, snapshot } = input;
  const facts = deriveFacts(input);
  const recommendations = deriveRecommendations(input, facts);
  const questions = planQuestions(envelope);

  const proposedChanges = recommendations
    .filter((rec): rec is Recommendation & { patch: RulePatchOp[] } => rec.patch !== undefined)
    .map((rec) => ({ recommendationId: rec.id, ops: rec.patch, preview: describePatch(rec.patch) }));

  const ruleValid = rule !== null && validateRule(rule).rule !== null;
  const patchesGrounded =
    rule !== null && proposedChanges.every((change) => applyRulePatch(rule, change.ops).ok);

  const turn: ConsultantTurn = {
    understanding: planUnderstanding(rule, envelope),
    facts,
    questions,
    recommendations,
    watchouts: planWatchouts(envelope, facts),
    alternatives: planAlternatives(rule),
    proposedChanges,
    nextBestAction: planNextBestAction(rule, envelope, questions, recommendations, ruleValid),
    contextUsed: snapshot.sources.map((s) => ({ source: s.source, version: s.version })),
    canApply: ruleValid && patchesGrounded,
    requiresApproval: input.requiresApproval,
  };
  if (rule) turn.suggestedName = suggestedNameFor(rule);
  return turn;
}

/* -------------------------------------------------------------------------- */
/* Consent: accept / reject                                                   */
/* -------------------------------------------------------------------------- */

export type AcceptOutcome =
  | { ok: true; rule: WorkflowRule; record: RecommendationRef }
  | {
      ok: false;
      reason: "stale-snapshot" | "stale-rule-version" | "unknown-recommendation" | "patch-refused";
      detail?: string;
    };

function errorKey(issue: { code: string; path?: string }): string {
  return `${issue.code}|${issue.path ?? ""}`;
}

/**
 * Apply the EXACT previewed patch of a recommendation — nothing is re-derived
 * or re-generated at accept time. Refuses stale consent (snapshot or rule
 * version drift, mirroring the brainState reducer), unknown or tampered
 * recommendations (content-hash id mismatch, or no cited evidence), refused
 * patches, and patches whose result introduces a NEW validation error the
 * input rule did not already have.
 */
export function acceptRecommendation(
  rec: Recommendation,
  rule: WorkflowRule,
  current: { snapshotId: string; ruleVersion: number }
): AcceptOutcome {
  const { id, expiresWith, ...content } = rec;
  if (rec.evidence.length === 0 || recommendationId(content) !== id) {
    return {
      ok: false,
      reason: "unknown-recommendation",
      detail: "recommendation does not match its content hash or cites no evidence — it was not issued by this engine",
    };
  }
  if (expiresWith.snapshotId !== current.snapshotId) {
    return {
      ok: false,
      reason: "stale-snapshot",
      detail: `computed against snapshot ${expiresWith.snapshotId}, current is ${current.snapshotId}`,
    };
  }
  if (expiresWith.ruleVersion !== current.ruleVersion) {
    return {
      ok: false,
      reason: "stale-rule-version",
      detail: `computed against rule version ${expiresWith.ruleVersion}, current is ${current.ruleVersion}`,
    };
  }

  const record: RecommendationRef = {
    id: rec.id,
    status: "accepted",
    snapshotId: expiresWith.snapshotId,
    ruleVersion: expiresWith.ruleVersion,
  };

  if (!rec.patch) {
    // Advisory recommendation — acceptance is recorded; the rule is unchanged.
    return { ok: true, rule, record };
  }

  const before = new Set(
    validateRule(rule)
      .issues.filter((issue) => issue.severity === "error")
      .map(errorKey)
  );
  const outcome = applyRulePatch(rule, rec.patch);
  if (!outcome.ok) return { ok: false, reason: "patch-refused", detail: outcome.reason };

  const newErrors = validateRule(outcome.rule).issues.filter(
    (issue) => issue.severity === "error" && !before.has(errorKey(issue))
  );
  if (newErrors.length > 0) {
    return {
      ok: false,
      reason: "patch-refused",
      detail: `patched rule fails validation: ${newErrors.map((issue) => issue.code).join(", ")}`,
    };
  }
  return { ok: true, rule: outcome.rule, record };
}

/**
 * Record a rejection. The caller feeds this ref to the brainState reducer so
 * the same recommendation id is never re-issued as open without new evidence
 * (re-derivation over unchanged inputs re-produces the same content hash).
 */
export function rejectRecommendation(rec: Recommendation): RecommendationRef {
  return {
    id: rec.id,
    status: "rejected",
    snapshotId: rec.expiresWith.snapshotId,
    ruleVersion: rec.expiresWith.ruleVersion,
  };
}
