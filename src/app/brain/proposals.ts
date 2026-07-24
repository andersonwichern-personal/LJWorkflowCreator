/**
 * GENERATED from packages/workflow-brain/src/proposals.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/workflow-brain contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * proposals — exact, deterministic rule patches for the Workflow Consultant.
 *
 * A recommendation that changes a rule never carries prose instructions — it
 * carries a RulePatchOp[] program. The SAME ops the author previewed are the
 * ops that get applied on acceptance; there is no re-generation step where an
 * AI could drift from what was shown. applyRulePatch is pure (the input rule
 * is never mutated) and atomic: every op applies, or none do and the caller
 * gets a precise refusal reason.
 *
 * Hard limits enforced here, not merely documented:
 * - `set-control` can never arm a rule. Arming is an activation decision made
 *   through the existing controls surface, not something a consultant proposes.
 * - Removing the last action of the "then" lane while the rule is armed is
 *   refused (mirrors the validator's NO_ACTIONS_WHEN_ARMED error).
 * - Trigger ops only accept event keys the vocabulary knows.
 * - Delays are bounded by MAX_DELAY_MINUTES, exactly like the authoring UI.
 * - ScopeRef values pass through structurally untouched — never stringified.
 */

import {
  CondLogic,
  MAX_DELAY_MINUTES,
  RuleCondition,
  RuleOutput,
  WorkflowRule,
  condFieldKind,
  condFieldLabel,
  formatDelay,
  getAction,
  getEvent,
  isGroup,
  isValuelessOperator,
  opLabel,
  paramKeyFor,
  scopeLabel,
} from "../core/vocabulary";
import { addLeaf, nodeAt, removeNode, setGroupLogic, updateLeaf } from "../core/conditionTree";

/* -------------------------------------------------------------------------- */
/* Op vocabulary                                                              */
/* -------------------------------------------------------------------------- */

export type RulePatchOp =
  | { op: "add-trigger"; event: string }
  | { op: "remove-trigger"; index: number }
  | { op: "set-trigger"; index: number; event: string }
  /** `path` addresses the GROUP the leaf is appended to (conditionTree paths; [] = root). */
  | { op: "add-condition"; path: number[]; leaf: RuleCondition }
  /** `path` addresses the leaf itself. */
  | { op: "update-condition"; path: number[]; leaf: RuleCondition }
  | { op: "remove-condition"; path: number[] }
  | { op: "set-logic"; path: number[]; logic: CondLogic }
  | { op: "add-action"; lane: "then" | "else"; output: RuleOutput; index?: number }
  | { op: "update-action"; lane: "then" | "else"; index: number; output: RuleOutput }
  | { op: "remove-action"; lane: "then" | "else"; index: number }
  | { op: "set-delay"; lane: "then" | "else"; index: number; delayMinutes: number | null }
  | {
      op: "set-control";
      key: "mode" | "oncePerRequest" | "maxFiresPerHour" | "missingData" | "priority";
      value: string | number | boolean;
    };

export type PatchOutcome =
  | { ok: true; rule: WorkflowRule; summary: string }
  | { ok: false; reason: string };

/* -------------------------------------------------------------------------- */
/* Application                                                                */
/* -------------------------------------------------------------------------- */

/** Deep clone via JSON — rule JSON is plain data and ScopeRefs survive intact. */
function cloneRule(rule: WorkflowRule): WorkflowRule {
  return JSON.parse(JSON.stringify(rule)) as WorkflowRule;
}

function laneOf(rule: WorkflowRule, lane: "then" | "else"): RuleOutput[] | undefined {
  return lane === "then" ? rule.actions : rule.else;
}

/** Apply one op to a working copy. Returns a refusal reason string on failure. */
function applyOne(rule: WorkflowRule, op: RulePatchOp): string | null {
  switch (op.op) {
    case "add-trigger": {
      if (!getEvent(op.event)) return `unknown trigger event "${op.event}"`;
      rule.triggers.push({ event: op.event });
      return null;
    }

    case "remove-trigger": {
      if (op.index < 0 || op.index >= rule.triggers.length) {
        return `no trigger #${op.index + 1} to remove`;
      }
      if (rule.triggers.length === 1) {
        return "a rule needs at least one trigger event; removing the last one is not a patch";
      }
      rule.triggers.splice(op.index, 1);
      return null;
    }

    case "set-trigger": {
      if (op.index < 0 || op.index >= rule.triggers.length) return `no trigger #${op.index + 1} to change`;
      if (!getEvent(op.event)) return `unknown trigger event "${op.event}"`;
      // Keep any existing trigger scope (a ScopeRef) untouched.
      rule.triggers[op.index] = { ...rule.triggers[op.index], event: op.event };
      return null;
    }

    case "add-condition": {
      const node = nodeAt(rule.conditions, op.path);
      if (!node || !isGroup(node)) return `condition path [${op.path.join(",")}] is not a group`;
      rule.conditions = addLeaf(rule.conditions, op.path, op.leaf);
      return null;
    }

    case "update-condition": {
      const node = op.path.length === 0 ? undefined : nodeAt(rule.conditions, op.path);
      if (!node || isGroup(node)) return `condition path [${op.path.join(",")}] is not a leaf`;
      rule.conditions = updateLeaf(rule.conditions, op.path, op.leaf);
      return null;
    }

    case "remove-condition": {
      if (op.path.length === 0) return "the root condition group cannot be removed";
      if (!nodeAt(rule.conditions, op.path)) return `no condition at path [${op.path.join(",")}]`;
      rule.conditions = removeNode(rule.conditions, op.path);
      return null;
    }

    case "set-logic": {
      const node = nodeAt(rule.conditions, op.path);
      if (!node || !isGroup(node)) return `logic path [${op.path.join(",")}] is not a group`;
      rule.conditions = setGroupLogic(rule.conditions, op.path, op.logic);
      return null;
    }

    case "add-action": {
      if (!getAction(op.output.action)) return `unknown action "${op.output.action}"`;
      const lane = laneOf(rule, op.lane) ?? [];
      const at = op.index ?? lane.length;
      if (at < 0 || at > lane.length) return `cannot insert at ${op.lane} position ${at + 1}`;
      lane.splice(at, 0, op.output);
      if (op.lane === "else") rule.else = lane;
      return null;
    }

    case "update-action": {
      const lane = laneOf(rule, op.lane);
      if (!lane || op.index < 0 || op.index >= lane.length) {
        return `the ${op.lane} lane has no action #${op.index + 1}`;
      }
      if (!getAction(op.output.action)) return `unknown action "${op.output.action}"`;
      lane[op.index] = op.output;
      return null;
    }

    case "remove-action": {
      const lane = laneOf(rule, op.lane);
      if (!lane || op.index < 0 || op.index >= lane.length) {
        return `the ${op.lane} lane has no action #${op.index + 1}`;
      }
      if (op.lane === "then" && lane.length === 1 && rule.controls.mode === "armed") {
        return "an armed rule must keep at least one action (NO_ACTIONS_WHEN_ARMED); switch it to shadow through the controls first";
      }
      lane.splice(op.index, 1);
      // An empty Otherwise lane is a lint warning (EMPTY_ELSE) — drop the lane
      // entirely instead of leaving an empty stub behind.
      if (op.lane === "else" && lane.length === 0) delete rule.else;
      return null;
    }

    case "set-delay": {
      const lane = laneOf(rule, op.lane);
      if (!lane || op.index < 0 || op.index >= lane.length) {
        return `the ${op.lane} lane has no action #${op.index + 1}`;
      }
      if (op.delayMinutes === null) {
        delete lane[op.index].delayMinutes;
        return null;
      }
      if (!Number.isFinite(op.delayMinutes)) return "delay must be a finite number of minutes";
      if (Math.abs(op.delayMinutes) > MAX_DELAY_MINUTES) {
        return `delay exceeds the ${MAX_DELAY_MINUTES}-minute (90-day) maximum`;
      }
      lane[op.index].delayMinutes = op.delayMinutes;
      return null;
    }

    case "set-control": {
      switch (op.key) {
        case "mode":
          if (op.value === "armed") {
            return "arming is an activation decision made through the existing controls, not a consultant patch";
          }
          if (op.value !== "shadow") return `unknown mode "${String(op.value)}"`;
          rule.controls.mode = "shadow";
          return null;
        case "oncePerRequest":
          if (typeof op.value !== "boolean") return "oncePerRequest takes true or false";
          rule.controls.oncePerRequest = op.value;
          return null;
        case "maxFiresPerHour":
          if (typeof op.value !== "number" || !Number.isFinite(op.value) || op.value < 1) {
            return "fires-per-hour limit must be a number of at least 1";
          }
          rule.controls.maxFiresPerHour = op.value;
          return null;
        case "missingData":
          if (op.value !== "no_match" && op.value !== "alert") {
            return `unknown missing-data policy "${String(op.value)}"`;
          }
          rule.controls.missingData = op.value;
          return null;
        case "priority":
          if (typeof op.value !== "number" || !Number.isFinite(op.value)) {
            return "priority must be a finite number";
          }
          rule.controls.priority = op.value;
          return null;
      }
    }
  }
}

/**
 * Apply a patch program atomically. Ops apply in order against a working copy;
 * the first refusal aborts the whole patch and the input rule is untouched
 * (it is never mutated in any case). On success the summary is the same
 * deterministic text {@link describePatch} produces — what was previewed is
 * what happened.
 */
export function applyRulePatch(rule: WorkflowRule, ops: RulePatchOp[]): PatchOutcome {
  if (ops.length === 0) return { ok: false, reason: "empty patch — nothing to apply" };
  const working = cloneRule(rule);
  for (let i = 0; i < ops.length; i++) {
    const refusal = applyOne(working, ops[i]);
    if (refusal !== null) {
      return { ok: false, reason: `op ${i + 1} (${ops[i].op}): ${refusal}` };
    }
  }
  return { ok: true, rule: working, summary: describePatch(ops) };
}

/* -------------------------------------------------------------------------- */
/* Description — deterministic preview text FROM THE OPS                      */
/* -------------------------------------------------------------------------- */

/** Display phrase for a condition leaf, total over legacy strings and ScopeRefs. */
function leafPhrase(leaf: RuleCondition): string {
  const kind = condFieldKind(leaf.field);
  const label = condFieldLabel(leaf.field);
  const operator = opLabel(kind, leaf.operator);
  if (isValuelessOperator(leaf.operator)) return `${label} ${operator}`;
  return `${label} ${operator} ${scopeLabel(leaf.value) || "(no value)"}`;
}

/** Display phrase for an action output ("assign to Wael", "add tag booking-failed"). */
function actionText(output: RuleOutput): string {
  const def = getAction(output.action);
  const label = def?.label ?? output.action.replace(/_/g, " ");
  if (def?.paramKind === "none") return label;
  const param = scopeLabel(output.params[paramKeyFor(output.action)]);
  return param ? `${label} ${param}` : `${label} (no value)`;
}

function condPathText(path: number[]): string {
  return path.length === 0 ? "the root group" : `group [${path.join(".")}]`;
}

function describeOne(op: RulePatchOp): string {
  switch (op.op) {
    case "add-trigger":
      return `add trigger "${op.event}"`;
    case "remove-trigger":
      return `remove trigger #${op.index + 1}`;
    case "set-trigger":
      return `change trigger #${op.index + 1} to "${op.event}"`;
    case "add-condition":
      return `add condition "${leafPhrase(op.leaf)}" to ${condPathText(op.path)}`;
    case "update-condition":
      return `change condition [${op.path.join(".")}] to "${leafPhrase(op.leaf)}"`;
    case "remove-condition":
      return `remove condition [${op.path.join(".")}]`;
    case "set-logic":
      return `set ${condPathText(op.path)} to ${op.logic === "OR" ? "match ANY condition (OR)" : "match ALL conditions (AND)"}`;
    case "add-action":
      return `add ${op.lane === "else" ? "otherwise-" : ""}action "${actionText(op.output)}"`;
    case "update-action":
      return `replace ${op.lane === "else" ? "otherwise-" : ""}action #${op.index + 1} with "${actionText(op.output)}"`;
    case "remove-action":
      return `remove ${op.lane === "else" ? "otherwise-" : ""}action #${op.index + 1}`;
    case "set-delay":
      return op.delayMinutes === null
        ? `clear the written delay on ${op.lane === "else" ? "otherwise-" : ""}action #${op.index + 1}`
        : `set the written delay on ${op.lane === "else" ? "otherwise-" : ""}action #${op.index + 1} to ${formatDelay(op.delayMinutes)}`;
    case "set-control":
      return `set control ${op.key} to ${String(op.value)}`;
  }
}

/**
 * Deterministic human-readable preview of a patch program, derived from the
 * ops themselves — never from model text. Same ops, same string, every time.
 */
export function describePatch(ops: RulePatchOp[]): string {
  return ops.map(describeOne).join("; ");
}

/* -------------------------------------------------------------------------- */
/* Touch report                                                               */
/* -------------------------------------------------------------------------- */

function touchOf(op: RulePatchOp): string {
  switch (op.op) {
    case "add-trigger":
      return "triggers";
    case "remove-trigger":
    case "set-trigger":
      return `triggers[${op.index}]`;
    case "add-condition":
    case "update-condition":
    case "remove-condition":
    case "set-logic":
      // Linter path convention: "conditions" + .children[i] per tree step.
      return op.path.length === 0 ? "conditions" : `conditions${op.path.map((i) => `.children[${i}]`).join("")}`;
    case "add-action":
      return op.index === undefined ? (op.lane === "else" ? "else" : "actions") : `${op.lane === "else" ? "else" : "actions"}[${op.index}]`;
    case "update-action":
    case "remove-action":
      return `${op.lane === "else" ? "else" : "actions"}[${op.index}]`;
    case "set-delay":
      return `${op.lane === "else" ? "else" : "actions"}[${op.index}].delayMinutes`;
    case "set-control":
      return `controls.${op.key}`;
  }
}

/** Rule paths a patch program touches (existing path conventions), deduplicated in op order. */
export function patchTouches(ops: RulePatchOp[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    const touch = touchOf(op);
    if (!out.includes(touch)) out.push(touch);
  }
  return out;
}
