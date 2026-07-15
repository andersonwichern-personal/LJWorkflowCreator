/**
 * Approval Authority evaluator (alignment doc §7).
 *
 * Pure, testable decisioning over the configured authority matrix: given a
 * request's amount + risk grade + product, return which level owns it, whether
 * it auto-approves, and the escalation chain when nothing covers it.
 *
 * Honesty guardrail: the admin platform has no authority ladder today — this
 * evaluator runs over verified request attributes, and its output feeds
 * assignment/notification. A hard approval gate is `backend-required`.
 */

/** Minimal shape shared by client AuthorityRecord and Prisma ApprovalAuthority. */
export interface AuthorityLevel {
  id: string;
  name: string;
  limit: string | number;
  riskGrade: string;
  product: string;
  userIds: string[];
  /** Phase 3: configured ApprovalRequirement topology (raw Json; null → legacy any-of userIds). */
  requirement?: unknown;
  escalationId: string | null;
  autoApprove: boolean;
}

/* -------------------------------------------------------------------------- */
/* ApprovalRequirement (Phase 3) — quorums, sequences, maker-checker          */
/* -------------------------------------------------------------------------- */

export interface ApproverRef {
  id: string;
  label: string;
}

export type ApprovalRequirement =
  | { type: "any_of"; approvers: ApproverRef[] }
  | { type: "n_of"; count: number; approvers: ApproverRef[] }
  | { type: "all_of"; approvers: ApproverRef[] }
  | { type: "sequence"; steps: ApprovalRequirement[] };

export type ApprovalVerdict = "approve" | "decline" | "abstain";

export interface DecisionContext {
  /** Recorded votes, one per approver seat (later entries win on duplicates). */
  decisions: { approverId: string; verdict: ApprovalVerdict }[];
  /** Maker-checker: approver ids barred from voting (requester, rule author). */
  exclusions: string[];
  /** Active delegations: the delegate votes in place of the original seat. */
  delegations: { fromId: string; toId: string }[];
}

export interface RequirementStatus {
  satisfied: boolean;
  /** Eligible approvers whose vote is still needed (current step only for sequences). */
  outstanding: ApproverRef[];
  /** True when the requirement can no longer be satisfied (declines/exclusions). */
  declined: boolean;
  /** Sequences: index of the step currently gating progress. */
  step?: number;
}

/** Gated step-by-step review paths are capped at 5 steps. */
export const MAX_SEQUENCE_STEPS = 5;

/**
 * Resolve the effective approver seats for a quorum: apply maker-checker
 * exclusions (on both the original seat and its delegate — a delegation never
 * launders an excluded voter back in), substitute active delegations, and
 * dedupe. The engine never invents eligibility: an empty result means the
 * requirement is undecidable, not vacuously satisfied.
 */
function effectiveApprovers(approvers: ApproverRef[], ctx: DecisionContext): ApproverRef[] {
  const excluded = new Set(ctx.exclusions);
  const delegated = new Map(ctx.delegations.map((d) => [d.fromId, d.toId]));
  const seen = new Set<string>();
  const out: ApproverRef[] = [];
  for (const seat of approvers) {
    if (excluded.has(seat.id)) continue;
    const toId = delegated.get(seat.id);
    const effective = toId ? { id: toId, label: seat.label } : seat;
    if (excluded.has(effective.id) || seen.has(effective.id)) continue;
    seen.add(effective.id);
    out.push(effective);
  }
  return out;
}

function evaluateQuorum(
  approvers: ApproverRef[],
  need: number,
  ctx: DecisionContext
): RequirementStatus {
  const eligible = effectiveApprovers(approvers, ctx);
  if (eligible.length === 0) {
    // Maker-checker deadlock (or empty config): nobody may act, so the
    // requirement can never be satisfied — surface it, don't auto-approve.
    return { satisfied: false, outstanding: [], declined: true };
  }

  const verdicts = new Map(ctx.decisions.map((d) => [d.approverId, d.verdict]));
  let approvals = 0;
  const outstanding: ApproverRef[] = [];
  for (const a of eligible) {
    const v = verdicts.get(a.id);
    if (v === "approve") approvals++;
    else if (v === undefined) outstanding.push(a); // decline/abstain = responded
  }

  const satisfied = approvals >= need;
  // Declined once the remaining undecided seats can no longer reach quorum.
  const declined = !satisfied && approvals + outstanding.length < need;
  return { satisfied, outstanding: satisfied ? [] : outstanding, declined };
}

/**
 * Evaluate an ApprovalRequirement against the recorded decisions.
 *
 * Quorums (`any_of` / `n_of` / `all_of`) count approvals from effective seats
 * only — excluded voters' ballots never count, delegates vote in place of
 * their delegators. Sequences gate step by step: votes for a later step are
 * ignored (neither approve nor decline) until every earlier step is satisfied.
 */
export function evaluateRequirement(
  req: ApprovalRequirement,
  ctx: DecisionContext
): RequirementStatus {
  switch (req.type) {
    case "any_of":
      return evaluateQuorum(req.approvers, 1, ctx);
    case "n_of":
      return evaluateQuorum(req.approvers, Math.max(1, Math.floor(req.count)), ctx);
    case "all_of":
      return evaluateQuorum(
        req.approvers,
        Math.max(1, effectiveApprovers(req.approvers, ctx).length),
        ctx
      );
    case "sequence": {
      const steps = req.steps.slice(0, MAX_SEQUENCE_STEPS);
      if (steps.length === 0) {
        return { satisfied: false, outstanding: [], declined: true, step: 0 };
      }
      for (let i = 0; i < steps.length; i++) {
        const status = evaluateRequirement(steps[i], ctx);
        if (!status.satisfied) {
          return { ...status, step: i };
        }
      }
      return { satisfied: true, outstanding: [], declined: false, step: steps.length - 1 };
    }
  }
}

function normalizeApprover(raw: unknown): ApproverRef {
  if (typeof raw === "string") return { id: "", label: raw };
  if (raw && typeof raw === "object") {
    const o = raw as { id?: unknown; label?: unknown };
    const id = typeof o.id === "string" ? o.id : "";
    const label = typeof o.label === "string" ? o.label : id;
    return { id, label };
  }
  return { id: "", label: String(raw ?? "") };
}

/**
 * Coerce stored Json (or a legacy `userIds` name array) into a well-formed
 * ApprovalRequirement. Legacy arrays become `any_of` with unresolved ids
 * (`id: ""`) so the labels survive until a directory lookup maps them.
 */
export function normalizeRequirement(raw: unknown): ApprovalRequirement {
  if (Array.isArray(raw)) {
    return { type: "any_of", approvers: raw.map(normalizeApprover) };
  }
  if (raw && typeof raw === "object") {
    const o = raw as { type?: unknown; approvers?: unknown; count?: unknown; steps?: unknown };
    const approvers = Array.isArray(o.approvers) ? o.approvers.map(normalizeApprover) : [];
    switch (o.type) {
      case "any_of":
        return { type: "any_of", approvers };
      case "all_of":
        return { type: "all_of", approvers };
      case "n_of":
        return {
          type: "n_of",
          count: Math.max(1, Math.floor(Number(o.count) || 1)),
          approvers,
        };
      case "sequence": {
        const steps = Array.isArray(o.steps) ? o.steps : [];
        return {
          type: "sequence",
          steps: steps.slice(0, MAX_SEQUENCE_STEPS).map(normalizeRequirement),
        };
      }
    }
  }
  return { type: "any_of", approvers: [] };
}

/**
 * Every seat that may ultimately vote on a requirement: all steps flattened,
 * maker-checker exclusions removed, delegations substituted. Used by the API
 * layer to gate who is allowed to record a decision at all.
 */
export function effectiveApproverSeats(
  req: ApprovalRequirement,
  ctx: DecisionContext
): ApproverRef[] {
  if (req.type === "sequence") {
    const out: ApproverRef[] = [];
    const seen = new Set<string>();
    for (const step of req.steps.slice(0, MAX_SEQUENCE_STEPS)) {
      for (const a of effectiveApproverSeats(step, ctx)) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        out.push(a);
      }
    }
    return out;
  }
  return effectiveApprovers(req.approvers, ctx);
}

/** Every approver seat referenced by a requirement (all steps, deduped by label). */
export function requirementApprovers(req: ApprovalRequirement): ApproverRef[] {
  if (req.type === "sequence") {
    const out: ApproverRef[] = [];
    const seen = new Set<string>();
    for (const step of req.steps) {
      for (const a of requirementApprovers(step)) {
        const key = a.id || a.label;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(a);
      }
    }
    return out;
  }
  return req.approvers;
}

/** Human-readable topology summary for reasons, cards, and the audit trail. */
export function describeRequirement(req: ApprovalRequirement): string {
  switch (req.type) {
    case "any_of":
      return req.approvers.length <= 1
        ? req.approvers[0]?.label ?? "no approvers configured"
        : `any of ${req.approvers.map((a) => a.label).join(", ")}`;
    case "n_of":
      return `${req.count} of ${req.approvers.map((a) => a.label).join(", ")}`;
    case "all_of":
      return `all of ${req.approvers.map((a) => a.label).join(", ")}`;
    case "sequence":
      return req.steps.map((s, i) => `step ${i + 1}: ${describeRequirement(s)}`).join(" → ");
  }
}

/**
 * The requirement an authority level enforces: its configured topology when
 * set, otherwise the legacy `userIds` roster as an any-of quorum.
 */
export function authorityRequirement(level: AuthorityLevel): ApprovalRequirement | null {
  if (level.requirement != null) return normalizeRequirement(level.requirement);
  const roster = Array.isArray(level.userIds) ? level.userIds : [];
  return roster.length ? normalizeRequirement(roster) : null;
}

export interface AuthorityDecision {
  /** The level that owns this request (lowest covering, or the covering escalation target). */
  authority: AuthorityLevel | null;
  lane: "auto-approve" | "manual" | "escalate" | "none";
  /** Escalation path walked when no level covered the request directly. */
  escalationChain: AuthorityLevel[];
  /** Human-readable explanation for the audit trail / matrix preview. */
  reason: string;
  /**
   * Phase 3: the approval topology the owning level enforces (normalized from
   * its configured requirement, falling back to legacy userIds). Null when no
   * level owns the request or the level has no approvers configured.
   */
  requirement: ApprovalRequirement | null;
}

export interface AuthorityInput {
  amount: number;
  riskGrade: string;
  product: string; // "Term Loan" | "Line of Credit"
}

const GRADE_ORDER = ["A", "B", "C", "D", "E"];

function gradeIndex(grade: string): number {
  const i = GRADE_ORDER.indexOf(grade.toUpperCase().trim());
  return i === -1 ? GRADE_ORDER.length : i; // unknown grades are worst-case
}

function limitOf(a: AuthorityLevel): number {
  return Number(a.limit);
}

function fmt(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

/** Does a level's matrix (limit + min grade + product) cover the request? */
export function covers(level: AuthorityLevel, input: AuthorityInput): boolean {
  const productOk = level.product === "All" || level.product === input.product;
  const limitOk = limitOf(level) >= input.amount;
  // level.riskGrade is the *minimum acceptable* grade: a level graded "C" covers A–C.
  const gradeOk = gradeIndex(input.riskGrade) <= gradeIndex(level.riskGrade);
  return productOk && limitOk && gradeOk;
}

/**
 * Decide which authority owns a request.
 *
 * Levels are evaluated smallest limit first (the service already returns them
 * that way; we re-sort defensively). If none covers, walk `escalationId` from
 * the largest product-relevant level and surface the resolved chain.
 */
export function decideAuthority(
  input: AuthorityInput,
  authorities: AuthorityLevel[]
): AuthorityDecision {
  const sorted = [...authorities].sort((a, b) => limitOf(a) - limitOf(b));

  if (sorted.length === 0) {
    return {
      authority: null,
      lane: "none",
      escalationChain: [],
      reason: "No authority levels are configured.",
      requirement: null,
    };
  }

  const describe = `${fmt(input.amount)} / grade ${input.riskGrade} / ${input.product}`;

  // 1. Lowest level whose matrix covers the request.
  const covering = sorted.find((a) => covers(a, input));
  if (covering) {
    const lane = covering.autoApprove ? "auto-approve" : "manual";
    const requirement = authorityRequirement(covering);
    return {
      authority: covering,
      lane,
      escalationChain: [],
      reason:
        lane === "auto-approve"
          ? `${describe} is within ${covering.name}'s lane (limit ${fmt(limitOf(covering))}, min grade ${covering.riskGrade}) — auto-approved.`
          : `${describe} is owned by ${covering.name} (limit ${fmt(limitOf(covering))}, min grade ${covering.riskGrade}) — manual review by ${
              requirement
                ? describeRequirement(requirement)
                : (Array.isArray(covering.userIds) ? covering.userIds : []).join(", ") || "its members"
            }.`,
      requirement,
    };
  }

  // 2. Nothing covers — walk the escalation chain from the largest relevant level.
  const byId = new Map(sorted.map((a) => [a.id, a]));
  const start =
    [...sorted].reverse().find((a) => a.product === "All" || a.product === input.product) ??
    sorted[sorted.length - 1];

  const chain: AuthorityLevel[] = [];
  const visited = new Set<string>([start.id]);
  let cursor: AuthorityLevel | undefined = start.escalationId
    ? byId.get(start.escalationId)
    : undefined;
  while (cursor && !visited.has(cursor.id)) {
    chain.push(cursor);
    visited.add(cursor.id);
    if (covers(cursor, input)) {
      return {
        authority: cursor,
        lane: "escalate",
        escalationChain: chain,
        reason: `${describe} exceeds ${start.name} (limit ${fmt(limitOf(start))}) — escalates to ${cursor.name} (limit ${fmt(limitOf(cursor))}).`,
        requirement: authorityRequirement(cursor),
      };
    }
    cursor = cursor.escalationId ? byId.get(cursor.escalationId) : undefined;
  }

  return {
    authority: null,
    lane: "none",
    escalationChain: chain,
    reason: `${describe} is not covered by any configured level${
      chain.length ? ` (escalation chain ${[start, ...chain].map((a) => a.name).join(" → ")} exhausted)` : ""
    } — needs a new authority level.`,
    requirement: null,
  };
}
