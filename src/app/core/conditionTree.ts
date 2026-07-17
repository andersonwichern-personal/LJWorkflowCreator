/**
 * GENERATED from packages/rule-core/src/conditionTree.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/rule-core contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * Pure, immutable manipulation of the recursive condition tree (schema v3).
 *
 * Every function returns a NEW tree — the input is never mutated. Nodes are
 * addressed by an index-path array: `[]` is the root group, `[0]` is the root's
 * first child, `[0, 1]` is the second child of the root's first child (which
 * must itself be a group), and so on.
 *
 * The RuleSentence builder stays "dumb" by delegating all state transitions to
 * these helpers; `core-tests/assert-tree.ts` pins the immutability + path behavior.
 */

import { ConditionGroup, ConditionNode, ConditionLeaf, isGroup } from "./vocabulary";

/**
 * Rebuild only the spine from the root to the group at `path`, applying `fn` to
 * that group. Invalid paths (out of range, or a leaf where a group is required)
 * are a no-op: the original root is returned unchanged.
 */
function updateGroupAt(
  root: ConditionGroup,
  path: number[],
  fn: (g: ConditionGroup) => ConditionGroup
): ConditionGroup {
  if (path.length === 0) return fn(root);
  const [head, ...rest] = path;
  const child = root.children[head];
  if (!child || !isGroup(child)) return root; // invalid path — defensive no-op
  const newChild = updateGroupAt(child, rest, fn);
  if (newChild === child) return root; // nothing changed downstream
  const children = root.children.map((c, i) => (i === head ? newChild : c));
  return { ...root, children };
}

/** Append a leaf to the group at `path` (`[]` = root). */
export function addLeaf(root: ConditionGroup, path: number[], leaf: ConditionLeaf): ConditionGroup {
  return updateGroupAt(root, path, (g) => ({ ...g, children: [...g.children, leaf] }));
}

/** Append a sub-group to the group at `path` (`[]` = root). */
export function addGroup(root: ConditionGroup, path: number[], group: ConditionGroup): ConditionGroup {
  return updateGroupAt(root, path, (g) => ({ ...g, children: [...g.children, group] }));
}

/** Replace the leaf at `path` (full path to the leaf node) with `leaf`. */
export function updateLeaf(root: ConditionGroup, path: number[], leaf: ConditionLeaf): ConditionGroup {
  if (path.length === 0) return root; // the root is always a group, never a leaf
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  return updateGroupAt(root, parentPath, (g) => {
    if (idx < 0 || idx >= g.children.length) return g;
    const children = g.children.map((c, i) => (i === idx ? leaf : c));
    return { ...g, children };
  });
}

/** Remove the node at `path` (leaf or sub-group). Removing the root is a no-op. */
export function removeNode(root: ConditionGroup, path: number[]): ConditionGroup {
  if (path.length === 0) return root;
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  return updateGroupAt(root, parentPath, (g) => {
    if (idx < 0 || idx >= g.children.length) return g;
    return { ...g, children: g.children.filter((_, i) => i !== idx) };
  });
}

/** Set the AND/OR logic of the group at `path`. */
export function setGroupLogic(root: ConditionGroup, path: number[], logic: ConditionGroup["logic"]): ConditionGroup {
  return updateGroupAt(root, path, (g) => (g.logic === logic ? g : { ...g, logic }));
}

/** Read the node at `path` (undefined if the path is invalid). */
export function nodeAt(root: ConditionGroup, path: number[]): ConditionNode | undefined {
  let node: ConditionNode = root;
  for (const idx of path) {
    if (!isGroup(node)) return undefined;
    const next: ConditionNode | undefined = node.children[idx];
    if (!next) return undefined;
    node = next;
  }
  return node;
}

/**
 * Nesting depth of a group: a flat root group (leaves only) is depth 1; each
 * additional level of sub-group adds 1. The UI cap is 2 (root + one sub-group);
 * the validator rejects depth > 4.
 */
export function groupDepth(group: ConditionGroup): number {
  let max = 0;
  for (const child of group.children) {
    if (isGroup(child)) max = Math.max(max, groupDepth(child));
  }
  return 1 + max;
}

/** A fresh empty group (default AND). */
export function emptyGroup(logic: ConditionGroup["logic"] = "AND"): ConditionGroup {
  return { logic, children: [] };
}
