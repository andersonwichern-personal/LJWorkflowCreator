/**
 * The one rule validator (hardening plan §3.2). Runs on the client pre-save AND
 * inside the Prisma service — a single implementation so the two can never drift.
 *
 * `validateRule(raw)` normalizes the input to v3, then reports structural
 * problems as typed issues:
 *   - severity "error"   → blocks save (the service throws; the UI disables Save).
 *   - severity "warning" → allowed, surfaced in the UI issues panel.
 *
 * When any error is present, `rule` is null (the caller must not persist it).
 */

import {
  WorkflowRule,
  RuleOutput,
  ConditionLeaf,
  normalizeRule,
  RULE_SCHEMA_VERSION,
  getEvent,
  getAction,
  OPERATORS,
  FIELDS,
  paramKeyFor,
  isValuelessOperator,
  isFormFieldRef,
  condFieldKey,
  condFieldKind,
  condFieldLabel,
  condFieldDef,
  walkLeaves,
  allowedFieldsForTriggers,
  triggersAllowFormFields,
} from "./vocabulary";
import { groupDepth } from "./conditionTree";

export interface RuleIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
}

export function validateRule(raw: unknown): { rule: WorkflowRule | null; issues: RuleIssue[] } {
  const issues: RuleIssue[] = [];
  const err = (code: string, message: string, path?: string) =>
    issues.push({ severity: "error", code, message, path });
  const warn = (code: string, message: string, path?: string) =>
    issues.push({ severity: "warning", code, message, path });

  // Schema version mismatch — a version newer than we understand (checked on the
  // raw input, because normalize always stamps the current version).
  const rawVersion = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof rawVersion === "number" && rawVersion > RULE_SCHEMA_VERSION) {
    err(
      "SCHEMA_VERSION_UNKNOWN",
      `Unknown rule schema version ${rawVersion} (max supported ${RULE_SCHEMA_VERSION}).`,
      "schemaVersion"
    );
  }

  const rule = normalizeRule(raw);
  const events = rule.triggers.map((t) => t.event);
  const allEventsKnown = events.length > 0 && events.every((e) => getEvent(e));
  const allowedKeys = new Set(allowedFieldsForTriggers(events).map((f) => f.key));

  /* ---- triggers ---- */
  if (rule.triggers.length === 0) {
    err("EMPTY_TRIGGERS", "A rule needs at least one trigger event.", "triggers");
  }
  rule.triggers.forEach((t, i) => {
    const ev = getEvent(t.event);
    if (!ev) err("UNKNOWN_EVENT", `Unknown trigger event "${t.event}".`, `triggers[${i}]`);
    else if (ev.confidence === "unconfirmed")
      warn("UNCONFIRMED_TOKEN", `Trigger "${t.event}" is unconfirmed against the live platform.`, `triggers[${i}]`);
  });

  /* ---- condition tree ---- */
  const depth = groupDepth(rule.conditions);
  if (depth > 4) {
    err("GROUP_DEPTH_EXCEEDED", `Condition nesting depth ${depth} exceeds the maximum of 4.`, "conditions");
  } else if (depth > 2) {
    warn("DEPTH_OVER_UI_CAP", `Condition nesting depth ${depth} is deeper than the builder's 2-level limit.`, "conditions");
  }

  walkLeaves(rule.conditions).forEach((leaf: ConditionLeaf, i) => {
    const path = `conditions.leaf[${i}]`;
    const isFF = isFormFieldRef(leaf.field);
    const label = condFieldLabel(leaf.field);

    // Unknown attribute key (form-field refs are always ID-bound → known).
    if (!isFF && !FIELDS[leaf.field as string]) {
      err("UNKNOWN_FIELD", `Unknown condition field "${leaf.field as string}".`, path);
      return;
    }

    const kind = condFieldKind(leaf.field);

    // Operator valid for the field kind.
    if (!OPERATORS[kind].some((o) => o.value === leaf.operator)) {
      err("INVALID_OPERATOR", `Operator "${leaf.operator}" is not valid for ${label}.`, path);
    }

    // Numeric field with a non-numeric, non-empty value (empty-ops exempt).
    if (kind === "numeric" && !isValuelessOperator(leaf.operator) && leaf.value.trim() !== "" && isNaN(Number(leaf.value))) {
      err("NON_NUMERIC_VALUE", `${label} needs a number, got "${leaf.value}".`, path);
    }

    // Attribute field outside the multi-trigger intersection (skip when an event
    // is unknown — the intersection is meaningless and UNKNOWN_EVENT already fired).
    if (!isFF && allEventsKnown && !allowedKeys.has(leaf.field as string)) {
      err(
        "FIELD_NOT_ALLOWED_FOR_TRIGGERS",
        `${label} is not available on ${events.length > 1 ? "all selected triggers" : `the "${events[0]}" trigger`}.`,
        path
      );
    }

    // Unconfirmed attribute field.
    if (condFieldDef(leaf.field)?.confidence === "unconfirmed") {
      warn("UNCONFIRMED_TOKEN", `Condition "${label}" is unconfirmed against the live platform.`, path);
    }

    // Live form field under a trigger set that doesn't universally allow them.
    if (isFF && !triggersAllowFormFields(events)) {
      warn(
        "FORM_FIELD_TRIGGER_MISMATCH",
        `Form field "${label}" isn't available on all of this rule's triggers.`,
        path
      );
    }
  });

  /* ---- actions ---- */
  const checkAction = (act: RuleOutput, path: string) => {
    const def = getAction(act.action);
    if (!def) {
      err("UNKNOWN_ACTION", `Unknown action "${act.action}".`, path);
      return;
    }
    if (def.confidence === "unconfirmed") {
      warn("UNCONFIRMED_TOKEN", `Action "${def.label}" is unconfirmed against the live platform.`, path);
    }
    if (def.paramKind === "enum" && def.paramOptions) {
      const val = act.params[paramKeyFor(def.key)];
      if (val && !def.paramOptions.includes(val)) {
        err("INVALID_ACTION_PARAM", `"${val}" is not a valid ${def.paramLabel ?? "value"} for ${def.label}.`, path);
      }
    }
  };
  rule.actions.forEach((a, i) => checkAction(a, `actions[${i}]`));
  (rule.else ?? []).forEach((a, i) => checkAction(a, `else[${i}]`));

  if (rule.controls.mode === "armed" && rule.actions.length === 0) {
    err("NO_ACTIONS_WHEN_ARMED", "An armed rule must have at least one action (shadow rules may observe without acting).", "actions");
  }

  /* ---- else + controls ---- */
  if (rule.else !== undefined && rule.else.length === 0) {
    warn("EMPTY_ELSE", "The Otherwise branch is empty — remove it or add an action.", "else");
  }
  if (rule.controls.maxFiresPerHour < 1) {
    err("INVALID_RATE_LIMIT", "Fires-per-hour limit must be at least 1.", "controls.maxFiresPerHour");
  }

  const hasError = issues.some((i) => i.severity === "error");
  return { rule: hasError ? null : rule, issues };
}
