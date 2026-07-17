// PORTED from scripts/assert-tree.ts (Vercel track) — drift guard for the shared rule core.
/**
 * Condition-tree operator suite (hardening plan §3.4) — pure, immutable,
 * path-addressed. Run: npx tsx scripts/assert-tree.ts
 */
import {
  addLeaf,
  addGroup,
  updateLeaf,
  removeNode,
  setGroupLogic,
  nodeAt,
  groupDepth,
  emptyGroup,
} from "../src/app/core/conditionTree";
import { ConditionGroup, ConditionLeaf, isGroup } from "../src/app/core/vocabulary";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const leaf = (field: string, value: string): ConditionLeaf => ({ field, operator: "is", value });

/* ---- addLeaf at root + immutability ---------------------------------------- */
const root0: ConditionGroup = { logic: "AND", children: [] };
const snap0 = JSON.stringify(root0);
const root1 = addLeaf(root0, [], leaf("bookstatus", "Error"));
t("addLeaf: new root has the leaf", root1.children.length === 1);
t("addLeaf: original root unmutated", JSON.stringify(root0) === snap0 && root0.children.length === 0);
t("addLeaf: returns a NEW object", root1 !== root0);

/* ---- addGroup at root + addLeaf into the sub-group ------------------------- */
const root2 = addGroup(root1, [], emptyGroup("OR"));
t("addGroup: root has a sub-group at index 1", root2.children.length === 2 && isGroup(root2.children[1]));
const root3 = addLeaf(root2, [1], leaf("core", "FISERV LOAN"));
const sub = nodeAt(root3, [1]);
t("addLeaf into sub-group [1]", !!sub && isGroup(sub) && sub.children.length === 1);
t("addLeaf into sub-group: parent leaf untouched", root3.children.length === 2 && !isGroup(root3.children[0]));
t("addLeaf into sub-group: spine rebuilt, root2 unmutated", isGroup(root2.children[1]) && (root2.children[1] as ConditionGroup).children.length === 0);

/* ---- updateLeaf ------------------------------------------------------------ */
const root4 = updateLeaf(root3, [0], leaf("bookstatus", "Confirmed"));
const updated = nodeAt(root4, [0]);
t("updateLeaf: value replaced", !!updated && !isGroup(updated) && updated.value === "Confirmed");
t("updateLeaf: original leaf unmutated", !isGroup(root3.children[0]) && (root3.children[0] as ConditionLeaf).value === "Error");
t("updateLeaf: sibling sub-group preserved by reference-safe rebuild", nodeAt(root4, [1, 0]) !== undefined);

/* ---- updateLeaf inside a sub-group ----------------------------------------- */
const root4b = updateLeaf(root3, [1, 0], leaf("core", "FMAC LOAN"));
const deep = nodeAt(root4b, [1, 0]);
t("updateLeaf [1,0]: nested leaf updated", !!deep && !isGroup(deep) && deep.value === "FMAC LOAN");

/* ---- setGroupLogic --------------------------------------------------------- */
const root5 = setGroupLogic(root4, [], "OR");
t("setGroupLogic root → OR", root5.logic === "OR");
const root5b = setGroupLogic(root4, [1], "AND");
t("setGroupLogic sub-group [1] → AND", (nodeAt(root5b, [1]) as ConditionGroup).logic === "AND");

/* ---- removeNode ------------------------------------------------------------ */
const root6 = removeNode(root3, [0]);
t("removeNode [0]: leaf removed", root6.children.length === 1 && isGroup(root6.children[0]));
t("removeNode: original unmutated", root3.children.length === 2);
const root7 = removeNode(root3, [1, 0]);
t("removeNode [1,0]: nested leaf removed", (nodeAt(root7, [1]) as ConditionGroup).children.length === 0);

/* ---- invalid paths are no-ops ---------------------------------------------- */
t("addLeaf on out-of-range group path → no-op (same ref)", addLeaf(root3, [9], leaf("x", "y")) === root3);
t("updateLeaf on missing path → no-op", updateLeaf(root3, [5], leaf("x", "y")) === root3);
t("removeNode on root [] → no-op", removeNode(root3, []) === root3);
t("addLeaf into a leaf path (not a group) → no-op", addLeaf(root3, [0], leaf("x", "y")) === root3);

/* ---- groupDepth ------------------------------------------------------------ */
t("groupDepth flat = 1", groupDepth(root1) === 1);
t("groupDepth root+subgroup = 2", groupDepth(root3) === 2);
const deep3: ConditionGroup = { logic: "AND", children: [{ logic: "AND", children: [{ logic: "AND", children: [] }] }] };
t("groupDepth nested triple = 3", groupDepth(deep3) === 3);

/* ---- nodeAt ---------------------------------------------------------------- */
t("nodeAt [] = root", nodeAt(root3, []) === root3);
t("nodeAt invalid → undefined", nodeAt(root3, [9]) === undefined);
t("nodeAt into a leaf → undefined", nodeAt(root3, [0, 0]) === undefined);

if (failures) {
  console.error(`\n${failures} tree assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll tree assertions passed.");
