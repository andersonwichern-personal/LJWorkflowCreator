/**
 * GENERATED from packages/rule-core/src/parserContradictions.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/rule-core contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * parserContradictions — deterministic detection of self-contradictory rules.
 *
 * A rule the author talked themselves into a corner with ("stage is Approved
 * AND stage is Closed", "over 500k AND under 100k", "change stage to Approved
 * AND change stage to Closed") is structurally valid, so the validator lets it
 * through — but it can never do what the author meant. This module finds those
 * conflicts BEFORE the rule looks ready, using nothing but the rule itself
 * (and, when available, the segmented clauses for provenance).
 *
 * Semantics, deliberately narrow:
 * - Only leaves connected by AND logic can conflict. An OR group states
 *   alternatives, which are legitimate — OR groups produce NO findings, and an
 *   AND group nested inside an OR is its own conflict scope.
 * - Numeric ranges compare as real numbers: gte 100 + lte 100 pins a point
 *   (fine); gt 100 + lt 100 (or gt + lte on the same bound) is empty.
 * - Only single-target actions (change stage, authority, assignee) conflict on
 *   duplicate params — notifying two people is fan-out, not contradiction.
 * - negated-and-required needs the clause layer: a negated clause prohibiting
 *   an action key the parsed lane also requires.
 *
 * Deterministic on purpose: no clock, no randomness, pure data in → data out.
 */
import type { ParsedClause } from "./parserClauses";
import type { ContradictionFinding } from "./parserProvenance";
import {
  ConditionGroup,
  ConditionLeaf,
  RuleOutput,
  WorkflowRule,
  condFieldKey,
  condFieldKind,
  condFieldLabel,
  getAction,
  isGroup,
  paramKeyFor,
  scopeLabel,
} from "./vocabulary";

/** Same normalization the parser applies — evidence containment must agree with it. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word containment over normalized clause text. */
function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRe(word)}\\b`).test(text);
}

/* -------------------------------------------------------------------------- */
/* AND regions — the only scope where leaves can contradict each other        */
/* -------------------------------------------------------------------------- */

interface IndexedLeaf {
  leaf: ConditionLeaf;
  /** Existing convention: flat walkLeaves index — "conditions.leaf[i]". */
  path: string;
}

/**
 * Collect maximal AND-connected leaf sets. Leaf indices follow walkLeaves DFS
 * order (the path convention every other module uses). Nested AND groups merge
 * into their parent AND region; an OR boundary severs conflict scope — leaves
 * directly under OR join no region, and an AND child of an OR starts fresh.
 */
function walkAndRegions(
  group: ConditionGroup,
  counter: { i: number },
  regions: IndexedLeaf[][],
  inherited: IndexedLeaf[] | null
): void {
  let mine: IndexedLeaf[] | null = null;
  if (group.logic === "AND") {
    mine = inherited ?? [];
    if (mine !== inherited) regions.push(mine);
  }
  for (const child of group.children) {
    if (isGroup(child)) {
      walkAndRegions(child, counter, regions, mine);
    } else {
      const entry: IndexedLeaf = { leaf: child, path: `conditions.leaf[${counter.i++}]` };
      if (mine) mine.push(entry);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Clause provenance — best-effort evidence containment                       */
/* -------------------------------------------------------------------------- */

/**
 * Map a finding's evidence strings onto clause ids by containment: the first
 * clause (reading order) whose text carries the evidence claims it. Best
 * effort — an unmatched evidence string simply contributes no id; the paths
 * remain the authoritative pointer.
 */
function clauseIdsFor(clauses: ParsedClause[] | undefined, evidence: string[]): string[] {
  if (!clauses?.length) return [];
  const ids: string[] = [];
  for (const raw of evidence) {
    const needle = norm(raw);
    if (!needle) continue;
    const hit = clauses.find((c) => norm(c.text).includes(needle));
    if (hit && !ids.includes(hit.id)) ids.push(hit.id);
  }
  return ids;
}

/* -------------------------------------------------------------------------- */
/* Negated-clause evidence (clause layer only)                                */
/* -------------------------------------------------------------------------- */

/** The parser's own negation grammar (N4) — a clause is negated when its text leads with one. */
const NEGATION_RE = /\b(?:don't|do not|never|without)\b/;

/**
 * The clause compiler may mark negation explicitly; fall back to the parser's
 * negation grammar so this works against the frozen ParsedClause shape too.
 */
function isNegatedClause(clause: ParsedClause): boolean {
  const flagged = (clause as ParsedClause & { negated?: boolean }).negated;
  if (typeof flagged === "boolean") return flagged;
  return NEGATION_RE.test(norm(clause.text));
}

/** Phrase words that carry no evidence weight ("assign to" → ["assign"]). */
const PHRASE_STOPWORDS = new Set(["to", "the", "a", "an", "for", "from", "it", "this", "into"]);

interface ActionEvidencePhrase {
  tokens: string[];
  /** Weak single-verb synonyms only count when the action's param label is also present. */
  needsParam: boolean;
}

/** Legacy verb synonyms the parser's own grammar accepts for these actions. */
const LEGACY_VERB_SYNONYMS: Record<string, string[][]> = {
  assign_user: [["assign"], ["route"], ["escalate"]],
  assign_authority: [["assign"], ["route"], ["escalate"]],
  notify: [["notify"], ["remind"]],
  change_stage: [["change", "stage"], ["set", "stage"], ["move", "stage"]],
};

/**
 * Evidence phrases for an action key: vocabulary label/aliases + legacy verbs.
 * A lone verb ("assign", "notify") on a param-bearing action is only evidence
 * when the clause also names the action's target — "don't assign to Wael" does
 * NOT contradict assigning to Sara. Multi-word phrases ("change stage") stand
 * on their own: they prohibit the action wholesale.
 */
function actionEvidencePhrases(actionKey: string): ActionEvidencePhrase[] {
  const def = getAction(actionKey);
  const hasParam = (def?.paramKind ?? "text") !== "none";
  const phrases: ActionEvidencePhrase[] = [];
  const sources = def ? [def.label, ...(def.aliases ?? [])] : [actionKey.replace(/_/g, " ")];
  for (const raw of sources) {
    const tokens = norm(raw.replace("{param}", " "))
      .split(" ")
      .filter((w) => w && !PHRASE_STOPWORDS.has(w));
    if (tokens.length) phrases.push({ tokens, needsParam: hasParam && tokens.length < 2 });
  }
  for (const tokens of LEGACY_VERB_SYNONYMS[actionKey] ?? []) {
    phrases.push({ tokens, needsParam: hasParam && tokens.length < 2 });
  }
  return phrases;
}

/** Conservative match: every token of some evidence phrase appears in the clause. */
function clauseNamesAction(clauseText: string, action: RuleOutput): boolean {
  const text = norm(clauseText);
  const paramLabel = norm(scopeLabel(action.params[paramKeyFor(action.action)]));
  for (const phrase of actionEvidencePhrases(action.action)) {
    if (!phrase.tokens.every((tok) => hasWord(text, tok))) continue;
    if (phrase.needsParam && paramLabel && !text.includes(paramLabel)) continue;
    return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Detection                                                                  */
/* -------------------------------------------------------------------------- */

/** Actions whose param is a single target — landing twice with different values conflicts. */
const SINGLE_TARGET_ACTIONS = new Set(["change_stage", "assign_authority", "assign_user"]);

const LOWER_OPS = new Set(["gt", "gte"]);
const UPPER_OPS = new Set(["lt", "lte"]);

function opSymbol(operator: string): string {
  if (operator === "gt") return ">";
  if (operator === "gte") return ">=";
  if (operator === "lt") return "<";
  return "<=";
}

/**
 * Find every deterministic contradiction in the rule. Pure and total: an empty
 * array means "no conflict detected", never "did not look". When `clauses` is
 * provided, findings carry best-effort clauseIds (evidence containment) and the
 * negated-and-required kind becomes detectable; without clauses, clauseIds are
 * empty and that kind is skipped.
 */
export function findContradictions(
  rule: WorkflowRule,
  clauses?: ParsedClause[]
): ContradictionFinding[] {
  const findings: ContradictionFinding[] = [];

  /* ---- condition conflicts, one AND region at a time ---------------------- */
  const regions: IndexedLeaf[][] = [];
  walkAndRegions(rule.conditions, { i: 0 }, regions, null);

  for (const region of regions) {
    const byField = new Map<string, IndexedLeaf[]>();
    for (const entry of region) {
      const key = condFieldKey(entry.leaf.field);
      const list = byField.get(key);
      if (list) list.push(entry);
      else byField.set(key, [entry]);
    }

    for (const entries of byField.values()) {
      if (entries.length < 2) continue;
      const kind = condFieldKind(entries[0].leaf.field);
      const label = condFieldLabel(entries[0].leaf.field);

      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i];
          const b = entries[j];
          const aVal = scopeLabel(a.leaf.value);
          const bVal = scopeLabel(b.leaf.value);

          // mutually-exclusive-values: two "is" pins on different values.
          if (
            (kind === "enum" || kind === "orderedEnum" || kind === "text") &&
            a.leaf.operator === "is" &&
            b.leaf.operator === "is" &&
            aVal &&
            bVal &&
            norm(aVal) !== norm(bVal)
          ) {
            findings.push({
              paths: [a.path, b.path],
              clauseIds: clauseIdsFor(clauses, [aVal, bVal]),
              kind: "mutually-exclusive-values",
              message: `${label} cannot be both "${aVal}" and "${bVal}" in the same AND group.`,
            });
          }

          // mutually-exclusive-values: "is X" + "is not X" — contradictory for any kind.
          const isVsIsNot =
            (a.leaf.operator === "is" && b.leaf.operator === "is_not") ||
            (a.leaf.operator === "is_not" && b.leaf.operator === "is");
          if (isVsIsNot && aVal && bVal && norm(aVal) === norm(bVal)) {
            findings.push({
              paths: [a.path, b.path],
              clauseIds: clauseIdsFor(clauses, [aVal, label]),
              kind: "mutually-exclusive-values",
              message: `${label} cannot be both "${aVal}" and not "${aVal}" in the same AND group.`,
            });
          }

          // empty-numeric-range: a lower bound above the upper bound.
          if (kind === "numeric") {
            const lower = LOWER_OPS.has(a.leaf.operator) ? a : LOWER_OPS.has(b.leaf.operator) ? b : null;
            const upper = UPPER_OPS.has(a.leaf.operator) ? a : UPPER_OPS.has(b.leaf.operator) ? b : null;
            if (lower && upper && lower !== upper) {
              const lo = Number(scopeLabel(lower.leaf.value));
              const hi = Number(scopeLabel(upper.leaf.value));
              const strict = lower.leaf.operator === "gt" || upper.leaf.operator === "lt";
              if (Number.isFinite(lo) && Number.isFinite(hi) && (hi < lo || (hi === lo && strict))) {
                findings.push({
                  paths: [lower.path, upper.path],
                  clauseIds: clauseIdsFor(clauses, [
                    scopeLabel(lower.leaf.value),
                    scopeLabel(upper.leaf.value),
                    label,
                  ]),
                  kind: "empty-numeric-range",
                  message:
                    `${label} ${opSymbol(lower.leaf.operator)} ${scopeLabel(lower.leaf.value)} and ` +
                    `${opSymbol(upper.leaf.operator)} ${scopeLabel(upper.leaf.value)} — no value satisfies both.`,
                });
              }
            }
          }
        }
      }
    }
  }

  /* ---- duplicate-action-conflict, per lane -------------------------------- */
  const lanes: Array<[string, RuleOutput[]]> = [
    ["actions", rule.actions],
    ["else", rule.else ?? []],
  ];
  for (const [lane, outputs] of lanes) {
    for (let i = 0; i < outputs.length; i++) {
      for (let j = i + 1; j < outputs.length; j++) {
        const a = outputs[i];
        const b = outputs[j];
        if (a.action !== b.action || !SINGLE_TARGET_ACTIONS.has(a.action)) continue;
        const param = paramKeyFor(a.action);
        const aVal = scopeLabel(a.params[param]);
        const bVal = scopeLabel(b.params[param]);
        if (!aVal || !bVal || norm(aVal) === norm(bVal)) continue;
        const actionLabel = getAction(a.action)?.label ?? a.action.replace(/_/g, " ");
        findings.push({
          paths: [`${lane}[${i}]`, `${lane}[${j}]`],
          clauseIds: clauseIdsFor(clauses, [aVal, bVal]),
          kind: "duplicate-action-conflict",
          message:
            `"${actionLabel}" lands twice with different targets ("${aVal}" vs "${bVal}") — ` +
            `a single-target action can only land once per lane.`,
        });
      }
    }
  }

  /* ---- negated-and-required (needs the clause layer) ----------------------- */
  if (clauses?.length) {
    for (const clause of clauses) {
      if (!isNegatedClause(clause)) continue;
      for (const [lane, outputs] of lanes) {
        outputs.forEach((output, index) => {
          if (!clauseNamesAction(clause.text, output)) return;
          findings.push({
            paths: [`${lane}[${index}]`],
            clauseIds: [clause.id],
            kind: "negated-and-required",
            message:
              `"${clause.text}" prohibits ${output.action.replace(/_/g, " ")}, ` +
              `but the rule also requires it at ${lane}[${index}].`,
          });
        });
      }
    }
  }

  return findings;
}
