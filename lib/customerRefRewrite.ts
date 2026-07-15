/**
 * Customer-reference rewriting for the merge flow (edge-cases doc §9, principle B).
 *
 * When two customer records are merged, every workflow rule whose `customer_name`
 * condition points at the merged-away (duplicate) customer must be repointed to
 * the survivor — otherwise the rule silently references a customer that is now an
 * alias. This is a *pure* transform (no DB, no I/O) so the merge service can apply
 * it inside its transaction and the test suite can exercise it without a database.
 *
 * Only `customer_name` instance refs are touched: template / retailer / stage
 * instance refs live on other fields and are never customer ids (UUID collisions
 * aside, the field guard makes the rewrite exact).
 */

import {
  ConditionGroup,
  ConditionNode,
  WorkflowRule,
  isGroup,
  isScopeRef,
  normalizeRule,
} from "@/lib/vocabulary";

function rewriteNode(
  node: ConditionNode,
  dupId: string,
  survivorId: string,
  survivorLabel: string
): { node: ConditionNode; changed: boolean } {
  if (isGroup(node)) {
    let changed = false;
    const children = node.children.map((child) => {
      const r = rewriteNode(child, dupId, survivorId, survivorLabel);
      if (r.changed) changed = true;
      return r.node;
    });
    return changed ? { node: { ...node, children }, changed: true } : { node, changed: false };
  }

  // Leaf: only customer_name instance refs pointing at the duplicate are repointed.
  const v = node.value;
  if (
    node.field === "customer_name" &&
    isScopeRef(v) &&
    v.level === "instance" &&
    v.id === dupId
  ) {
    return {
      node: { ...node, value: { level: "instance", id: survivorId, label: survivorLabel } },
      changed: true,
    };
  }
  return { node, changed: false };
}

/**
 * Return the rule with every `customer_name` instance ref for `dupId` repointed
 * to `survivorId` (label refreshed), plus whether anything changed. Reads legacy
 * v1/v2/v3 shapes via `normalizeRule`; a `changed: false` result means the caller
 * should not touch the persisted rule.
 */
export function rewriteCustomerInstanceRefs(
  ruleJson: unknown,
  dupId: string,
  survivorId: string,
  survivorLabel: string
): { rule: WorkflowRule; changed: boolean } {
  const rule = normalizeRule(ruleJson);
  const { node, changed } = rewriteNode(rule.conditions, dupId, survivorId, survivorLabel);
  if (!changed) return { rule, changed: false };
  return { rule: { ...rule, conditions: node as ConditionGroup }, changed: true };
}
