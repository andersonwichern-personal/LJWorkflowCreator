/**
 * parserGrounding — deterministic entity grounding for the parser AI engine.
 *
 * Every key and value an engine (deterministic or AI) wants to put into a rule
 * is re-checked here against a VocabularySnapshot: a versioned, content-hashed
 * record of what the platform actually offers. The verdict ladder is strict:
 *
 *   - exact (case/whitespace-insensitive) match against the option list or a
 *     registry label → grounded, with the instance id when the registry holds
 *     exactly one id for that label;
 *   - two-plus registry ids behind one normalized label → duplicate, which the
 *     clarification layer must turn into a question, never a pick;
 *   - fuzzy near-misses → suggestions ONLY; fuzzy never auto-grounds;
 *   - everything else → unknown.
 *
 * Instance ScopeRefs must carry an id the registry actually issued — an id the
 * registry has never seen is a fabricated reference and is reported unknown.
 * Tenant labels are DATA, never instructions: nothing here interprets or
 * executes them. Pure and replayable by construction: no clock, no randomness,
 * no host imports — only the vocabulary and fuzzy siblings.
 */
import {
  ACTIONS,
  ASSIGNEES,
  ConditionLeaf,
  EVENTS,
  FIELDS,
  OPERATORS,
  RuleOutput,
  ScopeRef,
  WorkflowRule,
  isValuelessOperator,
  walkLeaves,
} from "./vocabulary";
import { fuzzyMatches } from "./fuzzy";

/* -------------------------------------------------------------------------- */
/* Snapshot + hash                                                            */
/* -------------------------------------------------------------------------- */

export interface VocabularySnapshot {
  /** Canonical keys only. */
  events: string[];
  fields: string[];
  actions: string[];
  operatorsByKind: Record<string, string[]>;
  /** Option labels per field/action key (live overlay or static vocabulary). */
  instanceOptions: Record<string, string[]>;
  /** ID-bearing registries per field/action key. */
  instanceRegistry: Record<string, { id: string; label: string }[]>;
  assignees: string[];
  source: string;
  version: string;
  /** stableVocabularyHash of everything above. */
  hash: string;
}

/**
 * Canonical JSON: object keys sorted recursively, arrays kept in given order.
 * Two structurally equal snapshots serialize identically no matter what key
 * insertion order produced them — the hash below depends on content only.
 */
function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${body.join(",")}}`;
}

/** FNV-1a 32-bit, inline — the core takes no crypto dependency. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic content hash over the canonical serialization. Same content →
 * same hash; any label/id/option change → a different hash. Format "v-<8 hex>".
 */
export function stableVocabularyHash(snapshot: Omit<VocabularySnapshot, "hash">): string {
  return `v-${fnv1a(canonicalJson(snapshot)).toString(16).padStart(8, "0")}`;
}

/**
 * The zero-config snapshot, built ONLY from the static vocabulary exports:
 * EVENTS/FIELDS/ACTIONS keys, option-bearing field options and action
 * paramOptions as instanceOptions, OPERATORS, ASSIGNEES. No registries — the
 * static vocabulary carries no platform ids, so nothing can pretend to.
 */
export function staticVocabularySnapshot(): VocabularySnapshot {
  const instanceOptions: Record<string, string[]> = {};
  for (const field of Object.values(FIELDS)) {
    if (field.options && field.options.length > 0) instanceOptions[field.key] = [...field.options];
  }
  for (const action of ACTIONS) {
    if (action.paramOptions && action.paramOptions.length > 0) {
      instanceOptions[action.key] = [...action.paramOptions];
    }
  }
  const operatorsByKind: Record<string, string[]> = {};
  for (const [kind, ops] of Object.entries(OPERATORS)) {
    operatorsByKind[kind] = ops.map((op) => op.value);
  }
  const body: Omit<VocabularySnapshot, "hash"> = {
    events: EVENTS.map((event) => event.key),
    fields: Object.keys(FIELDS),
    actions: ACTIONS.map((action) => action.key),
    operatorsByKind,
    instanceOptions,
    instanceRegistry: {},
    assignees: [...ASSIGNEES],
    source: "static-vocabulary",
    version: "static",
  };
  return { ...body, hash: stableVocabularyHash(body) };
}

/* -------------------------------------------------------------------------- */
/* Value grounding                                                            */
/* -------------------------------------------------------------------------- */

export type GroundingVerdict =
  | { kind: "grounded"; canonical: string; instanceId?: string }
  | { kind: "duplicate"; candidates: string[] }
  | { kind: "suggestions"; candidates: string[] }
  | { kind: "unknown" };

/** Case/whitespace-insensitive comparison key for labels. */
function normLabel(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Option labels for a registry key. assign_user/notify additionally draw from
 * the assignee roster — the parser resolves those params against the same list.
 */
function optionPool(registryKey: string, snapshot: VocabularySnapshot): string[] {
  const options = snapshot.instanceOptions[registryKey] ?? [];
  if (registryKey === "assign_user" || registryKey === "notify") {
    return [...options, ...snapshot.assignees];
  }
  return options;
}

/** Is there anything at all to ground this key against? No pool = free text. */
function hasPool(registryKey: string, snapshot: VocabularySnapshot): boolean {
  return (
    optionPool(registryKey, snapshot).length > 0 ||
    (snapshot.instanceRegistry[registryKey] ?? []).length > 0
  );
}

/**
 * Ground an author/engine-supplied text against one registry key (a condition
 * field key or an action key). Registry labels are consulted first because
 * they carry ids and expose duplicates; the plain option list grounds without
 * an id. Fuzzy matches are surfaced as suggestions and NEVER auto-ground.
 */
export function groundValue(
  registryKey: string,
  text: string,
  snapshot: VocabularySnapshot
): GroundingVerdict {
  const heard = normLabel(text);
  if (!heard) return { kind: "unknown" };

  const registry = snapshot.instanceRegistry[registryKey] ?? [];
  const exactEntries = registry.filter((entry) => normLabel(entry.label) === heard);
  const uniqueIds = [...new Set(exactEntries.map((entry) => entry.id))];
  if (uniqueIds.length > 1) {
    // Same normalized label, different platform records: the clarification
    // layer owns the choice. Candidates stay plain labels on purpose.
    return { kind: "duplicate", candidates: exactEntries.map((entry) => entry.label) };
  }
  if (uniqueIds.length === 1) {
    return { kind: "grounded", canonical: exactEntries[0].label, instanceId: uniqueIds[0] };
  }

  const options = optionPool(registryKey, snapshot);
  const exactOption = options.find((option) => normLabel(option) === heard);
  if (exactOption !== undefined) return { kind: "grounded", canonical: exactOption };

  const seen = new Set<string>();
  const pool: string[] = [];
  for (const label of [...options, ...registry.map((entry) => entry.label)]) {
    const key = normLabel(label);
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push(label);
  }
  const candidates = fuzzyMatches(text, pool);
  if (candidates.length > 0) return { kind: "suggestions", candidates };
  return { kind: "unknown" };
}

/* -------------------------------------------------------------------------- */
/* Whole-rule grounding                                                       */
/* -------------------------------------------------------------------------- */

export interface GroundingFinding {
  /** "triggers[0]" | "conditions.leaf[2]" | "actions[1]" | "else[0]" | "actions[1].when". */
  path: string;
  /** The text/key/label as the rule carries it. */
  heard: string;
  verdict: GroundingVerdict;
}

/**
 * Fabricated-id guard: an instance ScopeRef grounds iff its id exists in the
 * registry for that key. A label match alone proves nothing — labels are cheap
 * to invent; ids are issued by the platform.
 */
function instanceIdVerdict(
  registryKey: string,
  ref: Extract<ScopeRef, { level: "instance" }>,
  snapshot: VocabularySnapshot
): GroundingVerdict {
  const hit = (snapshot.instanceRegistry[registryKey] ?? []).find((entry) => entry.id === ref.id);
  if (hit) return { kind: "grounded", canonical: hit.label, instanceId: hit.id };
  return { kind: "unknown" };
}

type PushFinding = (path: string, heard: string, verdict: GroundingVerdict) => void;

/** Ground one condition leaf. Numeric and pool-less free-text fields are skipped. */
function groundLeaf(
  leaf: ConditionLeaf,
  path: string,
  snapshot: VocabularySnapshot,
  push: PushFinding
): void {
  // ID-bound live form-field refs carry their own author-time binding; the
  // static/tenant vocabulary has no say over them.
  if (typeof leaf.field !== "string") return;
  const key = leaf.field;
  if (!snapshot.fields.includes(key)) {
    push(path, key, { kind: "unknown" });
    return;
  }
  if (isValuelessOperator(leaf.operator)) return;
  const value = leaf.value;
  if (typeof value !== "string") {
    // "any" is vacuous and "category" values come from the static category
    // lists; only instance refs carry ids that must be real.
    if (value.level === "instance") push(path, value.label, instanceIdVerdict(key, value, snapshot));
    return;
  }
  if (!hasPool(key, snapshot)) return; // numeric / free-text: nothing to ground against
  push(path, value, groundValue(key, value, snapshot));
}

/** Ground one output (action key, params, per-action gate). */
function groundOutput(
  output: RuleOutput,
  path: string,
  snapshot: VocabularySnapshot,
  push: PushFinding
): void {
  if (!snapshot.actions.includes(output.action)) push(path, output.action, { kind: "unknown" });
  for (const value of Object.values(output.params)) {
    if (typeof value !== "string") {
      if (value.level === "instance") {
        push(path, value.label, instanceIdVerdict(output.action, value, snapshot));
      }
      continue;
    }
    if (!hasPool(output.action, snapshot)) continue;
    push(path, value, groundValue(output.action, value, snapshot));
  }
  if (output.when) {
    for (const leaf of walkLeaves(output.when)) groundLeaf(leaf, `${path}.when`, snapshot, push);
  }
}

/**
 * Re-check every key and entity in a rule against the snapshot. Findings carry
 * only the problems — a clean rule grounds with an empty findings list;
 * grounded verdicts are not echoed. Trigger scopes and per-action gates are
 * covered too: fabricated references have nowhere to hide.
 */
export function groundRule(
  rule: WorkflowRule,
  snapshot: VocabularySnapshot
): { findings: GroundingFinding[] } {
  const findings: GroundingFinding[] = [];
  const push: PushFinding = (path, heard, verdict) => {
    if (verdict.kind !== "grounded") findings.push({ path, heard, verdict });
  };

  rule.triggers.forEach((trigger, index) => {
    const path = `triggers[${index}]`;
    if (!snapshot.events.includes(trigger.event)) push(path, trigger.event, { kind: "unknown" });
    const scope = trigger.scope;
    if (scope && scope.level === "instance") {
      // Only template instance scopes ship today (vocabulary TriggerRef note).
      push(path, scope.label, instanceIdVerdict("template", scope, snapshot));
    }
  });

  walkLeaves(rule.conditions).forEach((leaf, index) => {
    groundLeaf(leaf, `conditions.leaf[${index}]`, snapshot, push);
  });

  rule.actions.forEach((output, index) => {
    groundOutput(output, `actions[${index}]`, snapshot, push);
  });
  (rule.else ?? []).forEach((output, index) => {
    groundOutput(output, `else[${index}]`, snapshot, push);
  });

  return { findings };
}
