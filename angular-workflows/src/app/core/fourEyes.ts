/**
 * PORTED VERBATIM from the Vercel track: lib/fourEyes.ts @ 3530c4b.
 * Shared rule-core contract (docs/agent/task.md 'Two-track doctrine').
 * Semantic changes must land on both tracks. Framework-free.
 */
/**
 * Four-eyes (maker-checker) gate — Phase 13.
 *
 * Deliberately free of any database import: the rule that decides whether a
 * change may land directly is a compliance control, so it has to be checkable
 * in isolation (and reusable by the builder UI, which has no Prisma access).
 * The service layer owns the writes; this module owns the decision.
 */

import { WorkflowRule, normalizeRule } from "@/lib/vocabulary";

/**
 * Does this write need a second pair of eyes?
 *
 * "Protected" is enabled OR armed — deliberately wider than the rule that
 * actually executes (enabled AND armed). An enabled shadow rule enforces
 * nothing today, but it is one toggle away from doing so, and treating it as a
 * free-for-all would let an author stage the logic solo and arm it later. The
 * cost is real and accepted: `enabled` defaults to true in the builder, so
 * routine drafting on a saved rule needs a peer sign-off. Draft freely by
 * leaving the rule disabled.
 *
 * Cosmetic writes (name, description) touch neither the rule nor its status
 * and pass straight through.
 */
export function shouldProposeWorkflowWrite(input: {
  currentRule: unknown;
  currentEnabled: boolean;
  nextRule?: unknown;
  nextEnabled?: boolean;
}): boolean {
  const currentRule = normalizeRule(input.currentRule);
  const nextRule = input.nextRule === undefined ? currentRule : normalizeRule(input.nextRule);
  const protectedWrite = input.nextRule !== undefined || input.nextEnabled !== undefined;
  if (!protectedWrite) return false;
  const activeNow = input.currentEnabled || currentRule.controls.mode === "armed";
  const activating = input.nextEnabled === true || nextRule.controls.mode === "armed";
  return activeNow || activating;
}

/** The rule a proposal should carry: the edit, or the untouched current rule. */
export function proposalPayloadRule(nextRule: unknown, fallback: WorkflowRule): WorkflowRule {
  return nextRule === undefined ? fallback : normalizeRule(nextRule);
}
