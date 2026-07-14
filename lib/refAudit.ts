/**
 * Broken-reference audit (Phase 2 §4.5, fixes G2 "reference rot").
 *
 * Pure scanner: walks every workflow's rule (trigger scopes, condition leaves,
 * action params on then + else) collecting instance-shaped references and
 * classifying each against the instance registries:
 *   - "ok"                — instance id found in its registry
 *   - "missing"           — instance id absent from a *live* registry (rot)
 *   - "legacy-unresolved" — a bare string sits on an instance-shaped slot
 * Category/any refs and free-text-shaped fields produce no entries.
 *
 * When the platform bridge isn't configured there is nothing authoritative to
 * verify ids against — instance refs then report "ok" and the response carries
 * `verified: false` so the UI can say so honestly.
 */

import {
  WorkflowRule,
  ScopeValue,
  SCOPED_FIELDS,
  SCOPED_PARAMS,
  isLegacyString,
  scopeLabel,
  walkLeaves,
  paramKeyFor,
  isFormFieldRef,
  normalizeRule,
} from "./vocabulary";
import type { ScopedInstances } from "./liveVocabulary";

export interface RefAuditEntry {
  workflowId: string;
  workflowName: string;
  /** Human path, e.g. "conditions.leaf[2]" or "actions[0].assignee". */
  path: string;
  label: string;
  status: "ok" | "missing" | "legacy-unresolved";
}

export interface RefAuditResult {
  /** True when instance ids were checked against live registries. */
  verified: boolean;
  entries: RefAuditEntry[];
  counts: { ok: number; missing: number; legacyUnresolved: number };
}

interface WorkflowRow {
  id: string;
  name: string;
  ruleJson: unknown;
}

/** Registry lookup for a scope spec's instance source. */
function registryFor(source: string | null, reg: Partial<ScopedInstances> | null): { id: string }[] | null {
  if (!source || !reg) return null;
  const list = (reg as unknown as Record<string, { id: string }[]>)[source];
  return Array.isArray(list) ? list : null;
}

/**
 * Verification is PER SOURCE: a source with no registry (or an empty one —
 * indistinguishable from "not fetched") is unverifiable and reports "ok";
 * a populated registry verifies by id. This lets DB-backed sources
 * (authorities) verify even when the live platform bridge is down.
 */
function classify(
  value: ScopeValue,
  instanceSource: string | null,
  reg: Partial<ScopedInstances> | null
): RefAuditEntry["status"] | null {
  if (isLegacyString(value)) {
    // A bare string on an instance-shaped slot = legacy-unresolved. Empty
    // strings are "not yet filled in", not a reference — skip them.
    return instanceSource && value.trim() !== "" ? "legacy-unresolved" : null;
  }
  if (value.level !== "instance") return null; // any/category — nothing to rot
  const list = registryFor(instanceSource, reg);
  if (!list || list.length === 0) return "ok"; // unverifiable — never false-alarm
  return list.some((o) => o.id === value.id) ? "ok" : "missing";
}

export function auditWorkflowRefs(
  workflows: WorkflowRow[],
  registry: Partial<ScopedInstances> | null
): RefAuditResult {
  const verified =
    !!registry && Object.values(registry).some((l) => Array.isArray(l) && l.length > 0);
  const entries: RefAuditEntry[] = [];

  const push = (wf: WorkflowRow, path: string, value: ScopeValue, instanceSource: string | null) => {
    const status = classify(value, instanceSource, registry);
    if (!status) return;
    entries.push({ workflowId: wf.id, workflowName: wf.name, path, label: scopeLabel(value), status });
  };

  for (const wf of workflows) {
    const rule: WorkflowRule = normalizeRule(wf.ruleJson);

    // Trigger scopes (template instances only, §4.2).
    rule.triggers.forEach((t, i) => {
      if (t.scope) push(wf, `triggers[${i}].scope`, t.scope as ScopeValue, "templates");
    });

    // Condition leaves on scoped attribute fields (form fields are ID-bound
    // separately and audited by their own registry in a later phase).
    walkLeaves(rule.conditions).forEach((leaf, i) => {
      if (isFormFieldRef(leaf.field)) return;
      const spec = SCOPED_FIELDS[leaf.field as string];
      if (!spec) return;
      push(wf, `conditions.leaf[${i}]`, leaf.value, spec.instanceSource);
    });

    // Action params (then + else lanes).
    const lanes: Array<[string, WorkflowRule["actions"]]> = [
      ["actions", rule.actions],
      ["else", rule.else ?? []],
    ];
    for (const [lane, list] of lanes) {
      list.forEach((a, i) => {
        const spec = SCOPED_PARAMS[a.action];
        if (!spec) return;
        const key = paramKeyFor(a.action);
        const val = a.params[key];
        if (val === undefined) return;
        push(wf, `${lane}[${i}].${key}`, val, spec.instanceSource);
      });
    }
  }

  return {
    verified,
    entries,
    counts: {
      ok: entries.filter((e) => e.status === "ok").length,
      missing: entries.filter((e) => e.status === "missing").length,
      legacyUnresolved: entries.filter((e) => e.status === "legacy-unresolved").length,
    },
  };
}
