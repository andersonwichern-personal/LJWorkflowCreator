/**
 * GENERATED from packages/workflow-brain/src/recommendations.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/workflow-brain contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * recommendations — deterministic, evidence-backed consultant analyzers.
 *
 * Facts come first: deriveFacts reads ONLY deterministic inputs (the drafted
 * rule, the parse envelope's honesty sidecars, the context snapshot) and
 * produces an evidence catalog. deriveRecommendations then builds every
 * recommendation FROM those fact objects, so a recommendation with no backing
 * evidence is impossible by construction — there is no code path that mints a
 * recommendation without holding at least one fact in its hand.
 *
 * Everything is content-addressed: ids are djb2 hashes over the item's own
 * content (kind + paths + evidence), never random and never clock-derived, so
 * re-deriving over the same inputs re-issues the same ids — which is what lets
 * the brainState reducer suppress a rejected recommendation until new evidence
 * actually changes it.
 *
 * Platform truth this module must never soften (cartographer finding R11):
 * RuleOutput.delayMinutes and RuleOutput.when are persisted but NOT executed —
 * no worker or cron exists, and the evaluator ignores `when`. Any rule using
 * them gets a high-risk unsupported-timing recommendation and the consultant
 * never promises timed or gated execution.
 */

import type { BrainContextSnapshot, RelatedWorkflowSummary } from "./context";
import type { RulePatchOp } from "./proposals";
import type { ParseEnvelope } from "../core/parserProvenance";
import {
  FIELDS,
  WorkflowRule,
  allowedFieldsForTriggers,
  condFieldDef,
  condFieldKey,
  condFieldLabel,
  defaultControls,
  defaultValueFor,
  formatDelay,
  getAction,
  getEvent,
  paramKeyFor,
  scopeLabel,
  walkLeaves,
} from "../core/vocabulary";

/* -------------------------------------------------------------------------- */
/* Contracts                                                                  */
/* -------------------------------------------------------------------------- */

export interface ConsultantFact {
  id: string;
  kind: string;
  message: string;
  rulePaths: string[];
  clauseIds: string[];
  source: "parse" | "validation" | "lint" | "coverage" | "contradiction" | "context";
}

export type RecommendationType =
  | "missing-alternate-path"
  | "unresolved-entity"
  | "broad-match"
  | "contradiction"
  | "missing-param"
  | "unsupported-timing"
  | "unconfirmed-vocabulary"
  | "no-simulation-coverage"
  | "duplicate-workflow"
  | "naming"
  | "rate-protection"
  | "inverted-condition-risk";

export interface Recommendation {
  /** Stable content hash — see {@link recommendationId}. */
  id: string;
  type: RecommendationType;
  title: string;
  /** WHY it matters operationally — lending-ops voice, concrete, no flattery. */
  rationale: string;
  /** ConsultantFact ids — every recommendation cites at least one fact. */
  evidence: string[];
  rulePaths: string[];
  clauseIds: string[];
  expectedEffect: string;
  riskLevel: "low" | "medium" | "high";
  changesBehavior: boolean;
  /** Present ONLY when a safe, exact, previewable patch exists. */
  patch?: RulePatchOp[];
  /** Freshness key — the reducer refuses accept/reject when either drifts. */
  expiresWith: { snapshotId: string; ruleVersion: number };
}

export interface AnalyzerInput {
  rule: WorkflowRule | null;
  envelope: ParseEnvelope;
  snapshot: BrainContextSnapshot;
  ruleVersion: number;
  /**
   * Raw author description, when the host has it. Used ONLY as the fallback
   * scan surface for the inverted-condition analyzer when the envelope carries
   * no clauses[] — never echoed into recommendations beyond a short excerpt.
   */
  sourceText?: string;
}

/* -------------------------------------------------------------------------- */
/* Content hashing (djb2 — deterministic, dependency-free)                    */
/* -------------------------------------------------------------------------- */

function djb2(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (((h << 5) + h) ^ text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function factId(kind: string, rulePaths: string[], clauseIds: string[], message: string): string {
  return `fact-${djb2([kind, rulePaths.join(","), clauseIds.join(","), message].join("|"))}`;
}

/**
 * Content hash over everything a recommendation asserts (type, wording,
 * evidence, paths, patch, risk posture). Excludes `id` itself and
 * `expiresWith`, so the same recommendation re-derived after an unrelated
 * accept keeps its id — which is how a rejection stays sticky until the
 * underlying evidence actually changes. acceptRecommendation re-computes this
 * to refuse tampered or fabricated recommendation objects.
 */
export function recommendationId(rec: Omit<Recommendation, "id" | "expiresWith">): string {
  return `rec-${djb2(
    JSON.stringify([
      rec.type,
      rec.title,
      rec.rationale,
      rec.evidence,
      rec.rulePaths,
      rec.clauseIds,
      rec.expectedEffect,
      rec.riskLevel,
      rec.changesBehavior,
      rec.patch ?? null,
    ])
  )}`;
}

/* -------------------------------------------------------------------------- */
/* Shared derivation helpers                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Events that fire at intake/document volume in a lending shop. A rule with no
 * conditions on one of these touches essentially every request in the pipe.
 */
/** Word-boundary scan for clauses today's grammar silently reads as positive. */
const INVERTED_CLAUSE_RE = /\b(unless|except)\b/i;

const HIGH_VOLUME_EVENTS = new Set([
  "REQUEST CREATED",
  "REQUEST SUBMITTED",
  "REQUEST STAGE CHANGED",
  "REQUEST ASSIGNED",
  "CUSTOMER CREATED",
  "DOCUMENT UPLOADED",
  "BOOKING STATUS CHANGED",
]);

function clauseIdsByStatus(envelope: ParseEnvelope, status: string): string[] {
  return (envelope.clauseLinks ?? []).filter((l) => l.status === status).map((l) => l.clauseId);
}

function unresolvedSlotPath(slot: { where: string; lane?: string; actionIndex?: number; conditionIndex?: number }): string {
  if (slot.where === "action-param") {
    return `${slot.lane === "else" ? "else" : "actions"}[${slot.actionIndex ?? 0}]`;
  }
  if (slot.where === "condition-value") return `conditions.leaf[${slot.conditionIndex ?? 0}]`;
  return "triggers[0]";
}

interface LaneOutput {
  lane: "then" | "else";
  index: number;
  output: WorkflowRule["actions"][number];
  pathBase: string;
}

function laneOutputs(rule: WorkflowRule): LaneOutput[] {
  return [
    ...rule.actions.map((output, index) => ({
      lane: "then" as const,
      index,
      output,
      pathBase: `actions[${index}]`,
    })),
    ...(rule.else ?? []).map((output, index) => ({
      lane: "else" as const,
      index,
      output,
      pathBase: `else[${index}]`,
    })),
  ];
}

function actionLabel(actionKey: string): string {
  return getAction(actionKey)?.label ?? actionKey.replace(/_/g, " ");
}

/** Overlap verdict for one related workflow (shared event + field or action overlap). */
function overlapWith(rule: WorkflowRule, related: RelatedWorkflowSummary): string | null {
  const myEvents = new Set(rule.triggers.map((t) => t.event));
  const sharedEvent = related.events.find((e) => myEvents.has(e));
  if (!sharedEvent) return null;

  const myFields = new Set(walkLeaves(rule.conditions).map((leaf) => condFieldKey(leaf.field)));
  const sharedFields = related.conditionFields.filter((f) => myFields.has(f));
  if (sharedFields.length > 0) {
    return `both fire on ${sharedEvent} and both test ${sharedFields.join(", ")}`;
  }

  const myActions = [...new Set(rule.actions.map((a) => a.action))].sort();
  const theirActions = [...new Set(related.actions)].sort();
  const sameActions =
    myActions.length > 0 &&
    myActions.length === theirActions.length &&
    myActions.every((a, i) => a === theirActions[i]);
  if (sameActions) {
    return `both fire on ${sharedEvent} with the same action set (${myActions.map(actionLabel).join(", ")})`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* deriveFacts                                                                */
/* -------------------------------------------------------------------------- */

export function deriveFacts(input: AnalyzerInput): ConsultantFact[] {
  const facts: ConsultantFact[] = [];
  const { rule, envelope, snapshot } = input;
  const add = (
    kind: string,
    message: string,
    rulePaths: string[],
    clauseIds: string[],
    source: ConsultantFact["source"]
  ) => facts.push({ id: factId(kind, rulePaths, clauseIds, message), kind, message, rulePaths, clauseIds, source });

  /* Contradictions detected over the parse. */
  for (const finding of envelope.contradictions ?? []) {
    add("contradiction", finding.message, finding.paths, finding.clauseIds, "contradiction");
  }

  /* Unresolved entities — the parser refused to guess; each one blocks readiness. */
  for (const slot of envelope.unresolved) {
    add(
      "unresolved-entity",
      `"${slot.heard}" does not match any record this tenant knows — the rule cannot run until it is confirmed.`,
      [unresolvedSlotPath(slot)],
      clauseIdsByStatus(envelope, "unresolved"),
      "parse"
    );
  }

  /* Inverted-condition risk (eval finding, gold-129/130): today's grammar reads
   * an "unless X"/"except X" clause as the POSITIVE condition X, silently
   * inverting author intent. Grammar fixes are out of scope this wave, so the
   * consultant flags the direction for human verification instead. Clauses[]
   * are the preferred scan surface; the raw description is the fallback. */
  const invertedHits: Array<{ excerpt: string; clauseId: string | null }> = [];
  for (const clause of envelope.clauses ?? []) {
    if (INVERTED_CLAUSE_RE.test(clause.text)) invertedHits.push({ excerpt: clause.text, clauseId: clause.id });
  }
  if (invertedHits.length === 0 && input.sourceText !== undefined) {
    const match = INVERTED_CLAUSE_RE.exec(input.sourceText);
    if (match) {
      invertedHits.push({ excerpt: input.sourceText.slice(match.index, match.index + 80).trim(), clauseId: null });
    }
  }
  for (const hit of invertedHits) {
    add(
      "inverted-condition-risk",
      `The description contains an "unless/except" clause ("${hit.excerpt}") — the engine currently reads 'unless/except' as a positive condition — verify the condition direction before trusting this rule.`,
      ["conditions"],
      hit.clauseId ? [hit.clauseId] : [],
      "parse"
    );
  }

  if (rule) {
    const leaves = walkLeaves(rule.conditions);
    const events = rule.triggers.map((t) => t.event);

    /* Missing alternate path: conditioned rule, silent on non-qualifying requests. */
    if (leaves.length > 0 && (rule.else === undefined || rule.else.length === 0)) {
      add(
        "missing-alternate-path",
        "Requests that hit the trigger but fail the conditions are left unchanged with no notice — the description names no alternate path.",
        ["else"],
        [],
        "coverage"
      );
    }

    /* Broad match: no conditions on a high-volume event. */
    const highVolume = events.find((e) => HIGH_VOLUME_EVENTS.has(e));
    if (leaves.length === 0 && highVolume) {
      add(
        "broad-match",
        `This rule has no conditions on "${highVolume}", a high-volume event — it will act on every matching request in the pipeline.`,
        ["conditions"],
        [],
        "coverage"
      );
    }

    /* Missing action parameters (skip ones the parser already flagged unresolved —
     * that gap is a clarification, not a second finding). */
    for (const { lane, index, output, pathBase } of laneOutputs(rule)) {
      const def = getAction(output.action);
      if (!def || def.paramKind === "none") continue;
      const alreadyUnresolved = envelope.unresolved.some(
        (slot) =>
          slot.where === "action-param" && (slot.lane ?? "then") === lane && (slot.actionIndex ?? 0) === index
      );
      if (alreadyUnresolved) continue;
      const value = output.params[paramKeyFor(output.action)];
      if (value === undefined || scopeLabel(value).trim() === "") {
        add(
          "missing-param",
          `"${def.label}" has no ${def.paramLabel || "value"} — the executor would have nothing to act on.`,
          [pathBase],
          [],
          "validation"
        );
      }
    }

    /* Unsupported timing (R11): delays and per-action gates persist but never execute. */
    for (const { output, pathBase } of laneOutputs(rule)) {
      if (typeof output.delayMinutes === "number" && output.delayMinutes !== 0) {
        add(
          "unsupported-timing",
          `"${actionLabel(output.action)}" is written with a ${formatDelay(output.delayMinutes)} delay, but delays are persisted but not executed by the current runtime — the action runs immediately. Do not promise timed behavior.`,
          [`${pathBase}.delayMinutes`],
          [],
          "validation"
        );
      }
      if (output.when !== undefined) {
        add(
          "unsupported-timing",
          `"${actionLabel(output.action)}" carries a per-action "only if" gate, which is persisted but not executed by the current runtime — the evaluator ignores it and the action fires ungated.`,
          [`${pathBase}.when`],
          [],
          "validation"
        );
      }
    }

    /* Unconfirmed vocabulary — enumerate the exact tokens. */
    const unconfirmedTokens: { path: string; text: string }[] = [];
    rule.triggers.forEach((t, i) => {
      if (getEvent(t.event)?.confidence === "unconfirmed") {
        unconfirmedTokens.push({ path: `triggers[${i}]`, text: `trigger "${t.event}"` });
      }
    });
    leaves.forEach((leaf, i) => {
      if (condFieldDef(leaf.field)?.confidence === "unconfirmed") {
        unconfirmedTokens.push({ path: `conditions.leaf[${i}]`, text: `field "${condFieldLabel(leaf.field)}"` });
      }
    });
    laneOutputs(rule).forEach(({ output, pathBase }) => {
      if (getAction(output.action)?.confidence === "unconfirmed") {
        unconfirmedTokens.push({ path: pathBase, text: `action "${actionLabel(output.action)}"` });
      }
    });
    if (unconfirmedTokens.length > 0) {
      add(
        "unconfirmed-vocabulary",
        `This rule uses vocabulary that is unconfirmed against the live platform: ${unconfirmedTokens
          .map((t) => t.text)
          .join(", ")}. It may save but never fire (or never execute) until the platform confirms these.`,
        unconfirmedTokens.map((t) => t.path),
        [],
        "validation"
      );
    }

    /* Duplicate / conflicting sibling workflows from the context snapshot. */
    for (const related of snapshot.relatedWorkflows) {
      const overlap = overlapWith(rule, related);
      if (overlap) {
        add(
          "duplicate-workflow",
          `Existing workflow "${related.name}" (${related.id}${related.enabled ? "" : ", currently disabled"}) overlaps this rule: ${overlap}.`,
          ["triggers"],
          [],
          "context"
        );
      }
    }

    /* Rate protection: broad rule still on the untouched default circuit breaker. */
    if (leaves.length === 0 && rule.controls.maxFiresPerHour === defaultControls().maxFiresPerHour) {
      add(
        "rate-protection",
        `This rule has no conditions and still carries the default ${defaultControls().maxFiresPerHour}/hour circuit breaker — a burst of events would act on everything it touches until the cap trips.`,
        ["controls.maxFiresPerHour"],
        [],
        "lint"
      );
    }

    /* Naming — a rule exists, so a reviewable name can be derived for it. */
    add(
      "naming",
      "A drafted rule exists; a descriptive name derived from what it actually does keeps the workflow list auditable.",
      [],
      [],
      "coverage"
    );
  }

  return facts;
}

/* -------------------------------------------------------------------------- */
/* deriveRecommendations                                                      */
/* -------------------------------------------------------------------------- */

/** Ranking tiers: blocking-adjacent first, advisory last; ties break on id. */
const RANK_TIER: Record<RecommendationType, number> = {
  contradiction: 0,
  "unresolved-entity": 0,
  "inverted-condition-risk": 1,
  "unsupported-timing": 1,
  "duplicate-workflow": 2,
  "broad-match": 3,
  "missing-param": 4,
  "unconfirmed-vocabulary": 4,
  "missing-alternate-path": 4,
  "rate-protection": 4,
  naming: 4,
  "no-simulation-coverage": 4,
};

const DELAY_PATH_RE = /^(actions|else)\[(\d+)\]\.delayMinutes$/;

interface RecDraft {
  type: RecommendationType;
  title: string;
  rationale: string;
  evidence: string[];
  rulePaths: string[];
  clauseIds: string[];
  expectedEffect: string;
  riskLevel: Recommendation["riskLevel"];
  changesBehavior: boolean;
  patch?: RulePatchOp[];
}

export function deriveRecommendations(input: AnalyzerInput, facts: ConsultantFact[]): Recommendation[] {
  const { rule, snapshot } = input;
  const drafts: RecDraft[] = [];
  const byKind = (kind: string) => facts.filter((f) => f.kind === kind);

  for (const fact of byKind("contradiction")) {
    drafts.push({
      type: "contradiction",
      title: "Resolve contradictory conditions",
      rationale: `${fact.message} As written, no request can ever satisfy this rule, so it would sit armed-looking but inert.`,
      evidence: [fact.id],
      rulePaths: fact.rulePaths,
      clauseIds: fact.clauseIds,
      expectedEffect: "Once one side of the contradiction is corrected, the rule can actually match requests.",
      riskLevel: "high",
      changesBehavior: true,
    });
  }

  for (const fact of byKind("unresolved-entity")) {
    drafts.push({
      type: "unresolved-entity",
      title: "Confirm the unrecognized name",
      rationale: `${fact.message} The parser does not guess at people, teams, or records — answer the open clarification instead.`,
      evidence: [fact.id],
      rulePaths: fact.rulePaths,
      clauseIds: fact.clauseIds,
      expectedEffect: "The rule references a real, verifiable record and can pass the readiness gate.",
      riskLevel: "high",
      changesBehavior: false,
    });
  }

  const invertedFacts = byKind("inverted-condition-risk");
  if (invertedFacts.length > 0) {
    drafts.push({
      type: "inverted-condition-risk",
      title: "Verify the direction of the unless/except condition",
      rationale:
        "The engine currently reads 'unless/except' as a positive condition — verify the condition direction before trusting this rule. A rule that fires exactly when it was meant to hold back is the most expensive kind of wrong.",
      evidence: invertedFacts.map((f) => f.id),
      rulePaths: [...new Set(invertedFacts.flatMap((f) => f.rulePaths))],
      clauseIds: [...new Set(invertedFacts.flatMap((f) => f.clauseIds))],
      expectedEffect:
        "A human confirms whether the drafted condition matches the intended exception, and rewrites the description in positive terms if it does not.",
      riskLevel: "high",
      changesBehavior: false,
    });
  }

  for (const fact of byKind("unsupported-timing")) {
    const delayMatch = fact.rulePaths.length === 1 ? DELAY_PATH_RE.exec(fact.rulePaths[0]) : null;
    const patch: RulePatchOp[] | undefined = delayMatch
      ? [
          {
            op: "set-delay",
            lane: delayMatch[1] === "else" ? "else" : "then",
            index: Number(delayMatch[2]),
            delayMinutes: null,
          },
        ]
      : undefined;
    drafts.push({
      type: "unsupported-timing",
      title: delayMatch ? "Remove the delay that will not run" : "Remove the per-action gate that will not run",
      rationale: `${fact.message} A banker reading the saved rule will assume the timing holds; the platform gives them no reason to doubt it.`,
      evidence: [fact.id],
      rulePaths: fact.rulePaths,
      clauseIds: fact.clauseIds,
      expectedEffect: delayMatch
        ? "The saved rule matches what actually happens today: the action runs immediately, and nobody is promised a wait that never occurs."
        : "The saved rule stops implying a gate the evaluator ignores.",
      riskLevel: "high",
      changesBehavior: false,
      patch,
    });
  }

  for (const fact of byKind("duplicate-workflow")) {
    drafts.push({
      type: "duplicate-workflow",
      title: "Check the overlapping workflow before saving another",
      rationale: `${fact.message} Two rules acting on the same requests double-fire assignments and notifications, and ops ends up reconciling which one "won".`,
      evidence: [fact.id],
      rulePaths: fact.rulePaths,
      clauseIds: fact.clauseIds,
      expectedEffect: "Either this rule is narrowed, the sibling is retired, or the overlap is a documented, deliberate choice.",
      riskLevel: "medium",
      changesBehavior: false,
    });
  }

  for (const fact of byKind("broad-match")) {
    let patch: RulePatchOp[] | undefined;
    if (rule) {
      const allowed = allowedFieldsForTriggers(rule.triggers.map((t) => t.event));
      const scopeField = allowed.find((f) => f.key === "custtype");
      if (scopeField) {
        patch = [
          {
            op: "add-condition",
            path: [],
            leaf: { field: scopeField.key, operator: "is", value: defaultValueFor(FIELDS[scopeField.key]) },
          },
        ];
      }
    }
    drafts.push({
      type: "broad-match",
      title: "Scope this rule before it touches the whole pipeline",
      rationale: `${fact.message} Broad rules are where runaway automation starts — one bad day of intake volume becomes a hundred unwanted actions.`,
      evidence: [fact.id],
      rulePaths: fact.rulePaths,
      clauseIds: fact.clauseIds,
      expectedEffect: patch
        ? "A customer-type condition narrows the blast radius; adjust the previewed value to the segment you actually mean."
        : "A scoping condition narrows the rule to the requests you actually mean.",
      riskLevel: "medium",
      changesBehavior: true,
      patch,
    });
  }

  for (const fact of byKind("missing-param")) {
    drafts.push({
      type: "missing-param",
      title: "Fill in the empty action value",
      rationale: `${fact.message} The consultant will not invent a recipient or value on your behalf.`,
      evidence: [fact.id],
      rulePaths: fact.rulePaths,
      clauseIds: fact.clauseIds,
      expectedEffect: "The action names a concrete target and can be verified before the rule is trusted.",
      riskLevel: "medium",
      changesBehavior: false,
    });
  }

  for (const fact of byKind("unconfirmed-vocabulary")) {
    drafts.push({
      type: "unconfirmed-vocabulary",
      title: "This rule leans on unconfirmed platform vocabulary",
      rationale: `${fact.message} Treat it as a draft of intent, not a live control, until those tokens are confirmed.`,
      evidence: [fact.id],
      rulePaths: fact.rulePaths,
      clauseIds: fact.clauseIds,
      expectedEffect: "Everyone reviewing the rule knows exactly which parts are proven and which are aspirational.",
      riskLevel: "medium",
      changesBehavior: false,
    });
  }

  for (const fact of byKind("missing-alternate-path")) {
    drafts.push({
      type: "missing-alternate-path",
      title: "Say what happens to requests that do not qualify",
      rationale: `${fact.message} If non-qualifying requests should be routed, tagged, or watched, that intent belongs in the description — the consultant will not pick a recipient for you.`,
      evidence: [fact.id],
      rulePaths: fact.rulePaths,
      clauseIds: fact.clauseIds,
      expectedEffect: "Either an explicit otherwise-path exists, or leaving those requests untouched is a recorded decision.",
      riskLevel: "low",
      changesBehavior: false,
    });
  }

  for (const fact of byKind("rate-protection")) {
    drafts.push({
      type: "rate-protection",
      title: "Keep shadow mode and a deliberate rate cap on this broad rule",
      rationale: `${fact.message} Shadow mode plus a cap you chose on purpose is the honest posture until real volume has been observed.`,
      evidence: [fact.id],
      rulePaths: fact.rulePaths,
      clauseIds: fact.clauseIds,
      expectedEffect: "The rule observes real traffic safely; arming remains a separate human decision made through the controls.",
      riskLevel: "low",
      changesBehavior: false,
    });
  }

  for (const fact of byKind("naming")) {
    drafts.push({
      type: "naming",
      title: "Name the workflow after what it does",
      rationale: `${fact.message} "Untitled workflow #7" is how audits go long.`,
      evidence: [fact.id],
      rulePaths: fact.rulePaths,
      clauseIds: fact.clauseIds,
      expectedEffect: "The suggested name on this turn can be used as-is or edited — the name lives outside the rule JSON, so no patch applies.",
      riskLevel: "low",
      changesBehavior: false,
    });
  }

  const recs: Recommendation[] = drafts.map((draft) => ({
    ...draft,
    id: recommendationId(draft),
    expiresWith: { snapshotId: snapshot.snapshotId, ruleVersion: input.ruleVersion },
  }));

  recs.sort((a, b) => {
    const tier = RANK_TIER[a.type] - RANK_TIER[b.type];
    if (tier !== 0) return tier;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return recs;
}
