/**
 * GENERATED from packages/rule-core/src/ruleLinter.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/rule-core contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
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
  type ScopeValue,
  type WorkflowRule,
  condFieldDef,
  condFieldKey,
  condFieldLabel,
  isFormFieldRef,
  isGroup,
  isLegacyString,
  isScopeRef,
  paramKeyFor,
  scopeLabel,
  walkLeaves,
  FIELDS,
  SCOPED_FIELDS,
  SCOPED_PARAMS,
  getAction,
} from "./vocabulary";
import { validateRule, type RuleIssue } from "./ruleValidation";

export type { RuleIssue } from "./ruleValidation";

/**
 * Optional live context for reference-aware lint checks. All fields are
 * optional: without them, the reference/overlap/exposure checks are skipped
 * (they can't assert absence against a registry they weren't given).
 */
/**
 * A live registry the linter can check references against. `{ id, label }`
 * entries carry the platform id, so an instance ref can be enforced against a
 * real record; bare strings are the legacy label-only form, still accepted so
 * older callers (and tests) keep working.
 */
export type LintRegistry = Array<string | { id: string; label: string }>;

export interface LintContext {
  /** Other saved rules (for OVERLAP); the rule under lint should be excluded. */
  peers?: { id: string; name: string; rule: WorkflowRule; enabled: boolean }[];
  /** Valid request stages (BROKEN_REF on stage conditions). */
  stages?: LintRegistry;
  /** Valid assignees/users (BROKEN_REF on assign_user / notify / team_member). */
  users?: LintRegistry;
  /** Valid template ids (BROKEN_REF on template-scoped trigger/condition refs). */
  templates?: string[];
  /** Valid retailers (BROKEN_REF on retailer conditions). */
  retailers?: LintRegistry;
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

/**
 * Registries whose bare-string entries are platform ids rather than display
 * labels. A legacy free-text value on these can't be checked at all (the
 * registry holds no labels to match against), so it degrades to "unverifiable"
 * instead of a false BROKEN_REF.
 */
const ID_ONLY_REGISTRIES = new Set(["Template", "Authority Target"]);

/**
 * Check one reference against its live registry.
 *
 * - `instance` refs are the strict case: an id that the registry doesn't carry
 *   is a dangling pointer to a deleted (or fabricated) record → blocking error.
 * - `category` refs name a static type chip, never a live record, so they are
 *   checked against the token's own category list — the instance registry does
 *   not (and should not) contain them.
 * - legacy strings are label-shaped: a match still resolves, so it warns and
 *   invites an upgrade to an ID-bound ref rather than blocking the save.
 *
 * An absent or empty registry means "not loaded" — absence can't be asserted
 * against a registry we were never given, so every branch skips.
 */
function validateRef(
  value: ScopeValue | undefined,
  registry: LintRegistry | undefined,
  typeName: string,
  path: string,
  issues: RuleIssue[],
  categories?: string[]
) {
  if (value == null) return;
  if (!registry || registry.length === 0) return;

  const hasId = (id: string) =>
    registry.some((item) => (typeof item === "string" ? item === id : item.id === id));

  const hasLabel = (lbl: string) =>
    registry.some((item) =>
      typeof item === "string"
        ? item.toLowerCase() === lbl.toLowerCase()
        : item.label.toLowerCase() === lbl.toLowerCase()
    );

  if (isLegacyString(value)) {
    const trimmed = value.trim();
    if (!trimmed || ID_ONLY_REGISTRIES.has(typeName)) return;
    if (!hasLabel(trimmed)) {
      push(issues, "error", "BROKEN_REF", `"${trimmed}" is not a known ${typeName}.`, path);
      return;
    }
    push(
      issues,
      "warning",
      "BROKEN_REF",
      `"${trimmed}" is a legacy text reference. Consider re-selecting it to upgrade to an ID-bound reference.`,
      path
    );
    return;
  }

  if (!isScopeRef(value)) return;

  if (value.level === "instance") {
    if (value.id) {
      if (!hasId(value.id)) {
        push(issues, "error", "BROKEN_REF", `${typeName} ID "${value.id}" (${value.label}) is not known.`, path);
      }
    } else if (value.label && !hasLabel(value.label)) {
      push(issues, "error", "BROKEN_REF", `"${value.label}" is not a known ${typeName}.`, path);
    }
  } else if (value.level === "category") {
    const category = value.category;
    if (!category || !categories || categories.length === 0) return;
    if (!categories.some((c) => c.toLowerCase() === category.toLowerCase())) {
      push(issues, "error", "BROKEN_REF", `Category "${category}" is not a known ${typeName}.`, path);
    }
  }
}

/** Condition fields whose values point at a live registry. */
const CONDITION_REGISTRIES: Record<string, { typeName: string; of: (ctx: LintContext) => LintRegistry | undefined }> = {
  template: { typeName: "Template", of: (ctx) => ctx.templates },
  stage: { typeName: "Stage", of: (ctx) => ctx.stages },
  retailer: { typeName: "Retailer", of: (ctx) => ctx.retailers },
  team_member: { typeName: "User", of: (ctx) => ctx.users },
};

function lintBrokenRefs(rule: WorkflowRule, ctx: LintContext, issues: RuleIssue[]) {
  // Condition-side refs: unknown attribute fields + values outside the live set.
  collectAllLeaves(rule.conditions, "conditions").forEach(({ leaf, path }) => {
    if (!isFormFieldRef(leaf.field) && !FIELDS[leaf.field as string]) {
      push(issues, "error", "BROKEN_REF", `Condition references an unknown field "${leaf.field as string}".`, path);
      return;
    }
    const key = condFieldKey(leaf.field);
    const target = CONDITION_REGISTRIES[key];
    if (!target) return;
    validateRef(leaf.value, target.of(ctx), target.typeName, path, issues, SCOPED_FIELDS[key]?.categories);
  });

  // Action-side refs: unknown actions, unknown users, dangling authority targets.
  [...rule.actions.map((a, i) => ({ a, path: `actions[${i}]` })), ...(rule.else ?? []).map((a, i) => ({ a, path: `else[${i}]` }))].forEach(
    ({ a, path }) => {
      const def = getAction(a.action);
      if (!def) {
        push(issues, "error", "BROKEN_REF", `Unknown action "${a.action}".`, path);
        return;
      }
      const param = a.params[paramKeyFor(a.action)];
      const categories = SCOPED_PARAMS[a.action]?.categories;
      if (a.action === "assign_user" || a.action === "notify") {
        validateRef(param, ctx.users, "User", path, issues, categories);
      } else if (a.action === "assign_authority") {
        validateRef(param, ctx.authorityIds, "Authority Target", path, issues, categories);
      }
    }
  );

  // Trigger scopes are template instance refs in this phase.
  rule.triggers.forEach((t, i) => {
    validateRef(t.scope, ctx.templates, "Template", `triggers[${i}].scope`, issues, SCOPED_FIELDS.template?.categories);
  });
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
