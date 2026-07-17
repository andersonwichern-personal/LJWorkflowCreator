/**
 * revisions — conversational edits to a canonical rule (composer roadmap
 * MVP 3 / Phase 3 editing behavior).
 *
 * Deterministic intent grammar over the EXISTING rule: each recognized
 * instruction patches the rule mechanically; anything not recognized changes
 * NOTHING and says so. Honest-unsupported always beats a guess — a revision
 * that silently did the wrong thing is worse than one that asks you to
 * rephrase (same doctrine as the parse gate).
 */
import { fuzzyMatches } from "./fuzzy";
import { ParseOptions, parseActionFragment } from "./nlParser";
import {
  WorkflowRule,
  RuleOutput,
  ScopeValue,
  condFieldKind,
  condFieldLabel,
  getAction,
  paramKeyFor,
  scopeLabel,
} from "./vocabulary";

export type RevisionResult =
  | { status: "applied"; rule: WorkflowRule; summary: string }
  | { status: "ambiguous"; reason: string }
  | { status: "unrecognized"; reason: string };

function clone(rule: WorkflowRule): WorkflowRule {
  return JSON.parse(JSON.stringify(rule));
}

interface LeafRef {
  leaf: { field: unknown; operator: string; value: unknown };
  parent: { children: unknown[] };
  index: number;
}

function numericLeaves(rule: WorkflowRule): LeafRef[] {
  const out: LeafRef[] = [];
  const visit = (group: { children: unknown[] }) => {
    group.children.forEach((child, index) => {
      const node = child as Record<string, unknown>;
      if (Array.isArray(node["children"])) visit(node as { children: unknown[] });
      else if (condFieldKind(node["field"] as never) === "numeric") {
        out.push({ leaf: node as LeafRef["leaf"], parent: group, index });
      }
    });
  };
  visit(rule.conditions);
  return out;
}

/** "$500,000" / "500k" / "1.2m" → canonical digit string. */
function parseAmount(digits: string, suffix: string | undefined): string {
  const base = Number(digits.replace(/,/g, ""));
  const factor = suffix?.toLowerCase() === "m" ? 1_000_000 : suffix?.toLowerCase() === "k" ? 1_000 : 1;
  return String(base * factor);
}

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Resolve a conversational replacement through the same vocabulary-aware
 * action grammar used for initial parsing. Free-text action parameters (for
 * example tags) remain free text; people, teams, stages, and authorities must
 * resolve to a confirmed option before the existing rule can be changed.
 */
function resolveReplacement(
  output: RuleOutput,
  replacement: string,
  eventKey: string | undefined,
  opts: ParseOptions | undefined
): ScopeValue | null {
  const phrase =
    output.action === "assign_user"
      ? `assign to ${replacement}`
      : output.action === "notify"
        ? `notify ${replacement}`
        : output.action === "change_stage"
          ? `change stage to ${replacement}`
          : output.action === "assign_authority"
            ? `escalate to ${replacement}`
            : null;

  if (phrase) {
    const fragment = parseActionFragment(phrase, eventKey, opts);
    if (fragment.unresolved.length) return null;
    const resolved = fragment.outputs.find((candidate) => candidate.action === output.action);
    const value = resolved?.params[paramKeyFor(output.action)];
    return value && scopeLabel(value) ? value : null;
  }

  const definition = getAction(output.action);
  if (!definition || definition.paramKind === "none") return null;
  if (definition.paramKind === "enum" && definition.paramOptions) {
    return definition.paramOptions.find((option) => eq(option, replacement)) ?? null;
  }
  return replacement;
}

/** Apply one conversational revision to the rule. */
export function applyRevision(
  rule: WorkflowRule,
  instruction: string,
  opts?: ParseOptions
): RevisionResult {
  const text = instruction.trim().replace(/[.!]+$/, "");
  if (!text) return { status: "unrecognized", reason: "Say what you'd like to change." };

  // 1. Else-lane addition: "Otherwise notify Sara" / "For other requests, escalate to Ops".
  const elseMatch = /^(?:otherwise|(?:for\s+)?(?:all\s+)?other(?:\s+requests?)?)[,:]?\s+(.+)$/i.exec(text);
  if (elseMatch) {
    const fragment = parseActionFragment(elseMatch[1], rule.triggers[0]?.event);
    if (fragment.unresolved.length) {
      return {
        status: "unrecognized",
        reason: `I couldn't confirm “${fragment.unresolved[0].heard}” — name the person or team exactly.`,
      };
    }
    if (!fragment.outputs.length) {
      return { status: "unrecognized", reason: `I couldn't turn “${elseMatch[1]}” into an action.` };
    }
    const next = clone(rule);
    next.else = [...(next.else ?? []), ...fragment.outputs];
    return { status: "applied", rule: next, summary: "Added what happens to non-qualifying requests." };
  }

  // 2. Substitution: "Notify Sara instead of Wael" / "Underwriting Team instead of Ops".
  if (/\binstead\s+of\b/i.test(text)) {
    const parts = /^(?:(?:notify|assign(?:\s+(?:it|this|the request))?(?:\s+to)?|escalate\s+to|send\s+(?:it\s+)?to)\s+)?(.+?)\s+instead\s+of\s+(.+)$/i.exec(text);
    if (parts) {
      const next = clone(rule);
      const replacement = parts[1].trim();
      const target = parts[2].trim();
      let replaced = 0;
      const lanes: RuleOutput[][] = [next.actions, next.else ?? []];
      for (const lane of lanes) {
        for (const output of lane) {
          const key = paramKeyFor(output.action);
          const current = scopeLabel(output.params[key]);
          if (current && (eq(current, target) || fuzzyMatches(target, [current]).length > 0)) {
            const resolved = resolveReplacement(output, replacement, rule.triggers[0]?.event, opts);
            if (!resolved) {
              return {
                status: "unrecognized",
                reason: `I couldn't confirm “${replacement}” for this action — choose a known person, team, stage, or authority.`,
              };
            }
            output.params[key] = resolved;
            replaced++;
          }
        }
      }
      if (replaced > 0) {
        return {
          status: "applied",
          rule: next,
          summary: `Replaced ${target} with ${replacement}${replaced > 1 ? ` (${replaced} places)` : ""}.`,
        };
      }
      return { status: "unrecognized", reason: `I couldn't find “${target}” in this workflow.` };
    }
  }

  // 3. Numeric change: "Change the threshold to $500,000" / "set loan amount to 300k".
  const amountMatch =
    /^(?:change|set|make|update|raise|lower)\s+(?:the\s+)?(.*?)\s*(?:to|=)\s*\$?([\d][\d,]*(?:\.\d+)?)\s*([km])?$/i.exec(
      text
    );
  if (amountMatch) {
    const fieldWords = amountMatch[1].trim();
    const value = parseAmount(amountMatch[2], amountMatch[3]);
    const candidates = numericLeaves(rule);
    const generic = !fieldWords || /^(threshold|amount|limit|value|it)$/i.test(fieldWords);
    const filtered = generic
      ? candidates
      : candidates.filter(
          (c) => fuzzyMatches(fieldWords, [condFieldLabel(c.leaf.field as never)]).length > 0
        );
    if (filtered.length === 1) {
      const next = clone(rule);
      // Re-locate the chosen leaf in the clone by its position in walk order.
      const target = numericLeaves(next)[candidates.indexOf(filtered[0])];
      target.leaf.value = value;
      return {
        status: "applied",
        rule: next,
        summary: `${condFieldLabel(target.leaf.field as never)} is now compared against ${value}.`,
      };
    }
    if (filtered.length > 1) {
      const labels = filtered.map((c) => condFieldLabel(c.leaf.field as never)).join(" or ");
      return { status: "ambiguous", reason: `Which one — ${labels}?` };
    }
    return { status: "unrecognized", reason: "I couldn't find a numeric check to change." };
  }

  // 4. Removal: "Remove the tag" / "delete the notify step".
  const removeMatch = /^(?:remove|drop|delete)\s+(?:the\s+)?(.+)$/i.exec(text);
  if (removeMatch) {
    const target = removeMatch[1].trim();
    const next = clone(rule);
    const actionIndex = next.actions.findIndex((output) => {
      const key = paramKeyFor(output.action);
      const label = output.action.replace(/_/g, " ");
      const param = scopeLabel(output.params[key]);
      return (
        fuzzyMatches(target, [label]).length > 0 ||
        (param !== "" && fuzzyMatches(target, [param]).length > 0) ||
        label.includes(target.toLowerCase())
      );
    });
    if (actionIndex >= 0) {
      if (next.actions.length === 1) {
        return {
          status: "unrecognized",
          reason: "A workflow needs an outcome. Add the replacement action before removing its only action.",
        };
      }
      const removed = next.actions.splice(actionIndex, 1)[0];
      return {
        status: "applied",
        rule: next,
        summary: `Removed: ${removed.action.replace(/_/g, " ")}.`,
      };
    }
    return { status: "unrecognized", reason: `I couldn't find “${target}” to remove.` };
  }

  // 5. Additive fragment: "also notify Operations" / bare "notify Ops".
  const additive = /^(?:also\s+|and\s+)?(.+)$/i.exec(text);
  if (additive) {
    const fragment = parseActionFragment(additive[1], rule.triggers[0]?.event);
    if (fragment.outputs.length && !fragment.unresolved.length) {
      const next = clone(rule);
      next.actions = [...next.actions, ...fragment.outputs];
      return { status: "applied", rule: next, summary: "Added the new action." };
    }
    if (fragment.unresolved.length) {
      return {
        status: "unrecognized",
        reason: `I couldn't confirm “${fragment.unresolved[0].heard}” — name the person or team exactly.`,
      };
    }
  }

  return {
    status: "unrecognized",
    reason:
      "I didn't understand that change — nothing was modified. Try “Change the threshold to $500,000”, “Notify Sara instead of Wael”, or rebuild from an edited description.",
  };
}
