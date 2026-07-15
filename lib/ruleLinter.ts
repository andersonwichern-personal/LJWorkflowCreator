/**
 * Rule linting heuristics layered on top of the validator.
 *
 * The validator owns structural correctness; this module adds softer semantic
 * checks that help authors catch dead branches, rejected outcomes without a
 * notice, and prohibited-basis review conditions before save.
 */

import {
  type ConditionGroup,
  type ConditionLeaf,
  type CondLogic,
  type RuleOutput,
  type WorkflowRule,
  condFieldDef,
  condFieldKey,
  condFieldLabel,
  isFormFieldRef,
  isGroup,
  isLegacyString,
  isScopeRef,
  paramKeyFor,
  scopeInstanceId,
  scopeLabel,
  walkLeaves,
  FIELDS,
  getAction,
} from "./vocabulary";
import { validateRule, type RuleIssue } from "./ruleValidation";

export type { RuleIssue } from "./ruleValidation";

/**
 * Optional live context for reference-aware lint checks. All fields are
 * optional: without them, the reference/overlap/exposure checks are skipped
 * (they can't assert absence against a registry they weren't given).
 */
export interface LintContext {
  /** Other saved rules (for OVERLAP); the rule under lint should be excluded. */
  peers?: { id: string; name: string; rule: WorkflowRule; enabled: boolean }[];
  /** Valid request stage names (BROKEN_REF on stage conditions). */
  stages?: string[];
  /** Valid assignee/user names (BROKEN_REF on assign_user / notify). */
  users?: string[];
  /** Valid template ids (BROKEN_REF on template-scoped trigger/condition refs). */
  templates?: string[];
  /** Configured authority level ids (BROKEN_REF on assign_authority instance refs). */
  authorityIds?: string[];
  /** Field keys populated by the live template set (MISSING_DATA_EXPOSURE). */
  liveFieldKeys?: string[];
}

type LeafRef = { leaf: ConditionLeaf; path: string };

const GEO_FIELD_PATTERNS = [
  /\b(zip|postal|postcode|county|state|province|city|address|location|region|territor(?:y|ial)?|geo|lat(?:itude)?|lng|lon(?:gitude)?)\b/i,
];

const SENSITIVE_FIELD_PATTERNS = [
  /\b(age|gender|sex|race|ethnic(?:ity)?|nationality|citizenship|disabil(?:ity)?|veteran|marital|income|salary|religion|faith|pregnan(?:cy)?|dob|birth)\b/i,
];

const EXPLICIT_PROHIBITED_FIELDS = new Set([
  "custtype",
  "customer_name",
  "main_borrower",
  "role",
]);

function push(
  issues: RuleIssue[],
  severity: RuleIssue["severity"],
  code: string,
  message: string,
  path?: string
) {
  issues.push({ severity, code, message, path });
}

function leafPath(base: string, index: number): string {
  return `${base}.children[${index}]`;
}

function collectConjunctiveLeaves(group: ConditionGroup, basePath: string): LeafRef[] {
  const out: LeafRef[] = [];
  group.children.forEach((child, index) => {
    const path = leafPath(basePath, index);
    if (isGroup(child)) {
      if (child.logic === "AND") {
        out.push(...collectConjunctiveLeaves(child, path));
      }
      return;
    }
    out.push({ leaf: child, path });
  });
  return out;
}

function lintDeadConditions(group: ConditionGroup, basePath: string, parentLogic: CondLogic | null, issues: RuleIssue[]) {
  if (group.logic === "AND" && parentLogic !== "AND") {
    const leaves = collectConjunctiveLeaves(group, basePath);
    const dead = findDeadConditionHits(leaves);
    for (const hit of dead) {
      push(issues, "error", "DEAD_CONDITION", hit.message, hit.path);
    }
  }

  group.children.forEach((child, index) => {
    if (isGroup(child)) {
      lintDeadConditions(child, leafPath(basePath, index), group.logic, issues);
    }
  });
}

function findDeadConditionHits(leaves: LeafRef[]): { path: string; message: string }[] {
  const hits: { path: string; message: string }[] = [];
  const byField = new Map<string, LeafRef[]>();
  for (const ref of leaves) {
    const key = typeof ref.leaf.field === "string" ? ref.leaf.field : ref.leaf.field.key ?? condFieldLabel(ref.leaf.field);
    const list = byField.get(key) ?? [];
    list.push(ref);
    byField.set(key, list);
  }

  for (const [, refs] of byField) {
    const label = condFieldLabel(refs[0].leaf.field);
    const kind = condFieldDef(refs[0].leaf.field)?.kind ?? "text";
    if (kind === "numeric") {
      const numeric = findNumericContradiction(refs, label);
      if (numeric) {
        hits.push({ path: refs[0].path, message: numeric });
      }
    }

    const stringish = findStringContradiction(refs, label);
    if (stringish) {
      hits.push({ path: refs[0].path, message: stringish });
    }
  }

  return hits;
}

function asNumber(value: ConditionLeaf["value"]): number | null {
  if (!isLegacyString(value)) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

function findNumericContradiction(refs: LeafRef[], label: string): string | null {
  let lower = -Infinity;
  let lowerInclusive = true;
  let upper = Infinity;
  let upperInclusive = true;
  const exacts: number[] = [];

  for (const { leaf } of refs) {
    if (!isLegacyString(leaf.value)) continue;
    const value = asNumber(leaf.value);
    if (value == null) continue;

    switch (leaf.operator) {
      case "is":
        exacts.push(value);
        break;
      case "gt":
        if (value > lower || (value === lower && lowerInclusive)) {
          lower = value;
          lowerInclusive = false;
        }
        break;
      case "gte":
        if (value > lower || (value === lower && !lowerInclusive)) {
          lower = value;
          lowerInclusive = true;
        }
        break;
      case "lt":
        if (value < upper || (value === upper && upperInclusive)) {
          upper = value;
          upperInclusive = false;
        }
        break;
      case "lte":
        if (value < upper || (value === upper && !upperInclusive)) {
          upper = value;
          upperInclusive = true;
        }
        break;
    }
  }

  const distinctExacts = [...new Set(exacts)];
  if (distinctExacts.length > 1) {
    return `${label} is pinned to multiple exact values under AND logic.`;
  }

  if (distinctExacts.length === 1) {
    const exact = distinctExacts[0];
    if (exact < lower || exact > upper || (exact === lower && !lowerInclusive) || (exact === upper && !upperInclusive)) {
      return `${label} clashes with an exact value under AND logic.`;
    }
  }

  if (lower > upper) {
    return `${label} has an impossible numeric range under AND logic.`;
  }
  if (lower === upper && (!lowerInclusive || !upperInclusive)) {
    return `${label} excludes its only possible value under AND logic.`;
  }

  return null;
}

function normalizeText(value: ConditionLeaf["value"]): string | null {
  return isLegacyString(value) ? value.trim().toLowerCase() : null;
}

function findStringContradiction(refs: LeafRef[], label: string): string | null {
  const exacts = new Set<string>();
  const negated = new Set<string>();

  for (const { leaf } of refs) {
    if (leaf.operator !== "is" && leaf.operator !== "is_not") continue;
    const value = normalizeText(leaf.value);
    if (!value) continue;

    if (leaf.operator === "is") {
      exacts.add(value);
    } else {
      negated.add(value);
    }
  }

  if (exacts.size > 1) {
    return `${label} is required to equal multiple different values under AND logic.`;
  }

  for (const value of exacts.values()) {
    if (negated.has(value)) {
      return `${label} is required and excluded for the same value under AND logic.`;
    }
  }

  return null;
}

function findRejectedOutcome(actions: RuleOutput[]): { actionPath: string } | null {
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!isRejectedOutcome(action)) continue;
    return { actionPath: `actions[${i}]` };
  }
  return null;
}

function isRejectedOutcome(action: RuleOutput): boolean {
  const rejectionActions = new Set(["set_underwriting_result", "route_to_queue"]);
  if (!rejectionActions.has(action.action)) return false;
  const value = action.params[paramKeyFor(action.action)];
  return isLegacyString(value) && value.trim().toLowerCase() === "rejected";
}

function hasNotification(actions: RuleOutput[]): boolean {
  return actions.some((action) => {
    const text = [
      action.action,
      action.action.replace(/_/g, " "),
      ...(Object.values(action.params).map((value) => (isLegacyString(value) ? value : ""))),
    ]
      .join(" ")
      .toLowerCase();

    if (/\bnotify\b|\bemail\b|\bletter\b|\binbox\b|\bmessage\b/.test(text)) return true;
    if (action.action === "notify") return true;
    const def = action.action;
    return def.includes("notify") || def.includes("email") || def.includes("letter");
  });
}

function lintActions(actions: RuleOutput[], issues: RuleIssue[]) {
  const rejected = findRejectedOutcome(actions);
  if (rejected && !hasNotification(actions)) {
    push(
      issues,
      "error",
      "AUTO_REJECT_WITHOUT_NOTICE",
      "A rejected underwriting outcome needs a notification action (email, letter, or notice) alongside it.",
      rejected.actionPath
    );
  }
}

function isProhibitedBasisField(fieldKey: string, label: string, hint?: string): { kind: "geo-shaped" | "sensitive demographic" } | null {
  const haystack = `${fieldKey} ${label} ${hint ?? ""}`;
  if (EXPLICIT_PROHIBITED_FIELDS.has(fieldKey)) {
    return { kind: "sensitive demographic" };
  }
  if (GEO_FIELD_PATTERNS.some((re) => re.test(haystack))) {
    return { kind: "geo-shaped" };
  }
  if (SENSITIVE_FIELD_PATTERNS.some((re) => re.test(haystack))) {
    return { kind: "sensitive demographic" };
  }
  return null;
}

function lintProhibitedBasisReview(group: ConditionGroup, basePath: string, issues: RuleIssue[]) {
  const leaves = collectAllLeaves(group, basePath);
  for (const { leaf, path } of leaves) {
    const key = typeof leaf.field === "string" ? leaf.field : leaf.field.key ?? condFieldLabel(leaf.field);
    const def = condFieldDef(leaf.field);
    const basis = isProhibitedBasisField(key, condFieldLabel(leaf.field), def?.hint);
    if (!basis) continue;
    push(
      issues,
      "warning",
      "PROHIBITED_BASIS_REVIEW",
      `Condition uses a ${basis.kind} field (${condFieldLabel(leaf.field)}) as a review basis.`,
      path
    );
  }
}

function collectAllLeaves(group: ConditionGroup, basePath: string): LeafRef[] {
  const out: LeafRef[] = [];
  group.children.forEach((child, index) => {
    const path = leafPath(basePath, index);
    if (isGroup(child)) {
      out.push(...collectAllLeaves(child, path));
    } else {
      out.push({ leaf: child, path });
    }
  });
  return out;
}

/* -------------------------------------------------------------------------- */
/* BROKEN_REF — dangling stage / field / user / template / authority refs      */
/* -------------------------------------------------------------------------- */

function lintBrokenRefs(rule: WorkflowRule, ctx: LintContext, issues: RuleIssue[]) {
  const templateIds = ctx.templates ?? [];
  // Condition-side refs: unknown attribute fields + stages outside the live set.
  collectAllLeaves(rule.conditions, "conditions").forEach(({ leaf, path }) => {
    if (!isFormFieldRef(leaf.field) && !FIELDS[leaf.field as string]) {
      push(issues, "error", "BROKEN_REF", `Condition references an unknown field "${leaf.field as string}".`, path);
      return;
    }
    if (condFieldKey(leaf.field) === "template" && templateIds.length > 0) {
      const instId = scopeInstanceId(leaf.value);
      if (instId && !templateIds.includes(instId)) {
        push(issues, "error", "BROKEN_REF", `Template ${instId} is not a known request template.`, path);
      }
    }
    if (condFieldKey(leaf.field) === "stage" && ctx.stages && ctx.stages.length > 0) {
      const val = scopeLabel(leaf.value).trim();
      if (val && !isScopeRef(leaf.value) && !ctx.stages.some((s) => s.toLowerCase() === val.toLowerCase())) {
        push(issues, "error", "BROKEN_REF", `Stage "${val}" is not a known request stage.`, path);
      }
    }
  });

  // Action-side refs: unknown actions, unknown users, dangling authority targets.
  [...rule.actions.map((a, i) => ({ a, path: `actions[${i}]` })), ...(rule.else ?? []).map((a, i) => ({ a, path: `else[${i}]` }))].forEach(
    ({ a, path }) => {
      const def = getAction(a.action);
      if (!def) {
        push(issues, "error", "BROKEN_REF", `Unknown action "${a.action}".`, path);
        return;
      }
      if ((a.action === "assign_user" || a.action === "notify") && ctx.users && ctx.users.length > 0) {
        const val = a.params[paramKeyFor(a.action)];
        if (val && isLegacyString(val) && !ctx.users.some((u) => u.toLowerCase() === val.trim().toLowerCase())) {
          push(issues, "error", "BROKEN_REF", `"${val}" is not a known user for ${def.label}.`, path);
        }
      }
      if (a.action === "assign_authority" && ctx.authorityIds) {
        const instId = scopeInstanceId(a.params[paramKeyFor("assign_authority")]);
        if (instId && !ctx.authorityIds.includes(instId)) {
          push(issues, "error", "BROKEN_REF", `Escalation target no longer exists (authority ${instId}).`, path);
        }
      }
    }
  );

  // Trigger scopes are template instance refs in this phase.
  if (templateIds.length > 0) {
    rule.triggers.forEach((t, i) => {
      const instId = scopeInstanceId(t.scope);
      if (instId && !templateIds.includes(instId)) {
        push(issues, "error", "BROKEN_REF", `Trigger template ${instId} is not a known request template.`, `triggers[${i}].scope`);
      }
    });
  }
}

/* -------------------------------------------------------------------------- */
/* MISSING_DATA_EXPOSURE — condition fields not populated by live templates     */
/* -------------------------------------------------------------------------- */

function lintMissingDataExposure(rule: WorkflowRule, ctx: LintContext, issues: RuleIssue[]) {
  if (!ctx.liveFieldKeys || ctx.liveFieldKeys.length === 0) return;
  const live = new Set(ctx.liveFieldKeys);
  collectAllLeaves(rule.conditions, "conditions").forEach(({ leaf, path }) => {
    const key = condFieldKey(leaf.field);
    if (!live.has(key)) {
      push(
        issues,
        "warning",
        "MISSING_DATA_EXPOSURE",
        `${condFieldLabel(leaf.field)} isn't populated by the live template fields — it may never have a value to match.`,
        path
      );
    }
  });
}

/* -------------------------------------------------------------------------- */
/* GATED_TOKEN_ARMED — armed rule uses an action that can't actually execute    */
/* -------------------------------------------------------------------------- */

function lintGatedTokensArmed(rule: WorkflowRule, issues: RuleIssue[]) {
  if (rule.controls.mode !== "armed") return;
  [...rule.actions.map((a, i) => ({ a, path: `actions[${i}]` })), ...(rule.else ?? []).map((a, i) => ({ a, path: `else[${i}]` }))].forEach(
    ({ a, path }) => {
      const def = getAction(a.action);
      if (!def || def.execution.status === "executable-now") return;
      const why = def.execution.status === "mocked-surface" ? "is a mocked surface" : "has no live backend yet";
      push(
        issues,
        "warning",
        "GATED_TOKEN_ARMED",
        `"${def.label}" ${why} — arming won't execute it (it logs as ${def.execution.status}).`,
        path
      );
    }
  );
}

/* -------------------------------------------------------------------------- */
/* OVERLAP — this rule's leaves are a subset of another active armed rule's     */
/* -------------------------------------------------------------------------- */

function leafSignature(leaf: ConditionLeaf): string {
  return `${condFieldKey(leaf.field)}|${leaf.operator}|${scopeLabel(leaf.value).trim().toLowerCase()}`;
}

function lintOverlap(rule: WorkflowRule, ctx: LintContext, issues: RuleIssue[]) {
  if (!ctx.peers || ctx.peers.length === 0) return;
  const mine = new Set(walkLeaves(rule.conditions).map(leafSignature));
  if (mine.size === 0) return; // unconditional rule overlaps everything — not useful signal
  const myTriggers = new Set(rule.triggers.map((t) => t.event));

  for (const peer of ctx.peers) {
    if (!peer.enabled || peer.rule.controls.mode !== "armed") continue;
    if (!peer.rule.triggers.some((t) => myTriggers.has(t.event))) continue; // no shared trigger
    const theirs = new Set(walkLeaves(peer.rule.conditions).map(leafSignature));
    if (theirs.size === 0) continue;
    if ([...mine].every((sig) => theirs.has(sig))) {
      push(
        issues,
        "warning",
        "OVERLAP",
        `This rule's conditions are a subset of active rule "${peer.name}" — both fire on the same requests.`,
        "conditions"
      );
    }
  }
}

/** Validate first, then layer lint findings on the normalized rule. */
export function lintRule(raw: unknown, ctx: LintContext = {}): { rule: WorkflowRule | null; issues: RuleIssue[] } {
  const validation = validateRule(raw);
  if (!validation.rule) return validation;
  return { rule: validation.rule, issues: [...validation.issues, ...lintRuleIssues(validation.rule, ctx)] };
}

/** Run the linter against an already-valid rule tree. */
export function lintRuleIssues(rule: WorkflowRule, ctx: LintContext = {}): RuleIssue[] {
  const issues: RuleIssue[] = [];
  lintDeadConditions(rule.conditions, "conditions", null, issues);
  lintActions([...rule.actions, ...(rule.else ?? [])], issues);
  lintProhibitedBasisReview(rule.conditions, "conditions", issues);
  lintBrokenRefs(rule, ctx, issues);
  lintMissingDataExposure(rule, ctx, issues);
  lintGatedTokensArmed(rule, issues);
  lintOverlap(rule, ctx, issues);
  return issues;
}

/** True when any lint issue is error severity (blocks save). */
export function hasBlockingIssues(issues: RuleIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
