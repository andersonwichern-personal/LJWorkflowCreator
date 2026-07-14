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
  escalationId: string | null;
  autoApprove: boolean;
}

export interface AuthorityDecision {
  /** The level that owns this request (lowest covering, or the covering escalation target). */
  authority: AuthorityLevel | null;
  lane: "auto-approve" | "manual" | "escalate" | "none";
  /** Escalation path walked when no level covered the request directly. */
  escalationChain: AuthorityLevel[];
  /** Human-readable explanation for the audit trail / matrix preview. */
  reason: string;
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
    };
  }

  const describe = `${fmt(input.amount)} / grade ${input.riskGrade} / ${input.product}`;

  // 1. Lowest level whose matrix covers the request.
  const covering = sorted.find((a) => covers(a, input));
  if (covering) {
    const lane = covering.autoApprove ? "auto-approve" : "manual";
    return {
      authority: covering,
      lane,
      escalationChain: [],
      reason:
        lane === "auto-approve"
          ? `${describe} is within ${covering.name}'s lane (limit ${fmt(limitOf(covering))}, min grade ${covering.riskGrade}) — auto-approved.`
          : `${describe} is owned by ${covering.name} (limit ${fmt(limitOf(covering))}, min grade ${covering.riskGrade}) — manual review by ${
              (Array.isArray(covering.userIds) ? covering.userIds : []).join(", ") || "its members"
            }.`,
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
  };
}
