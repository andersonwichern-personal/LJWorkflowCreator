import { WorkflowRule, normalizeRule } from "@/lib/vocabulary";
import type { ApprovalRequirement, ApproverRef } from "@/lib/authorityEngine";

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

export function proposalPayloadRule(nextRule: unknown, fallback: WorkflowRule): WorkflowRule {
  return nextRule === undefined ? fallback : normalizeRule(nextRule);
}

export interface WorkflowSnapshot {
  enabled: boolean;
  ruleJson: unknown;
}

export interface WorkflowChange {
  enabled?: boolean;
  ruleJson?: unknown;
}

export function isLiveRule(enabled: boolean, ruleJson: unknown): boolean {
  return enabled && normalizeRule(ruleJson).controls.mode === "armed";
}

function sameRule(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeRule(a)) === JSON.stringify(normalizeRule(b));
}

export function requiresProposal(current: WorkflowSnapshot, updates: WorkflowChange): boolean {
  const nextEnabled = updates.enabled ?? current.enabled;
  const nextRule = updates.ruleJson ?? current.ruleJson;
  const logicEdited = updates.ruleJson !== undefined && !sameRule(current.ruleJson, updates.ruleJson);
  const statusChanged = nextEnabled !== current.enabled;
  if (!logicEdited && !statusChanged) return false;
  return isLiveRule(current.enabled, current.ruleJson) || isLiveRule(nextEnabled, nextRule);
}

export function proposalRequirementForAdmins(
  proposerId: string,
  admins: ApproverRef[]
): ApprovalRequirement {
  return { type: "any_of", approvers: admins.filter((a) => a.id !== proposerId) };
}

export function proposalExclusions(proposerId: string): string[] {
  return [proposerId.trim()];
}
