export {};

// Phase 7.2 — exercises the REAL A/B split primitives: deterministic hashing
// (lib/abSplit.ts) and abSplit normalization/clamping (lib/vocabulary.ts).

import { hashToPercent, routesToPeer } from "../lib/abSplit";
import { WorkflowRule, normalizeRule } from "../lib/vocabulary";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

// Synthetic request corpus — 200 ids shaped like the platform's (REQ-<n>).
const CORPUS = Array.from({ length: 200 }, (_, i) => `REQ-${1000 + i}`);

// 1. Hashing: stable, bounded, and spread across buckets.
for (const id of ["REQ-4821", "REQ-1", "", "a", "long-request-id-with-many-chars-000"]) {
  const v = hashToPercent(id);
  t(`hash(${JSON.stringify(id)}) is in [0,100)`, v >= 0 && v < 100, String(v));
  t(`hash(${JSON.stringify(id)}) is deterministic`, v === hashToPercent(id));
}
const buckets = new Set(CORPUS.map(hashToPercent));
t("hash spreads across buckets (no degenerate constant)", buckets.size >= 30, `${buckets.size} distinct`);

// 2. Routing: same request always lands on the same branch.
for (const id of CORPUS.slice(0, 20)) {
  t(`routesToPeer(${id}, 30) is stable`, routesToPeer(id, 30) === routesToPeer(id, 30));
}

// 3. Proportional allocation over the corpus (spec: ~weightPercent% to peer).
const routed30 = CORPUS.filter((id) => routesToPeer(id, 30)).length;
const share30 = (routed30 / CORPUS.length) * 100;
t("weight 30 routes roughly 30% to peer (15–45% band)", share30 >= 15 && share30 <= 45, `${share30}%`);
t("weight 0 routes nothing", CORPUS.every((id) => !routesToPeer(id, 0)));
t("weight 100 routes everything", CORPUS.every((id) => routesToPeer(id, 100)));
// Monotonic: raising the weight never un-routes a request.
const at20 = CORPUS.filter((id) => routesToPeer(id, 20));
t("routing is monotonic in weight", at20.every((id) => routesToPeer(id, 50)));

// 4. Normalization: abSplit survives round-trip, clamps, and rejects garbage.
function ruleWith(abSplit: unknown): unknown {
  return {
    schemaVersion: 3,
    triggers: [{ event: "REQUEST CREATED" }],
    conditions: { logic: "AND", children: [] },
    actions: [],
    controls: { mode: "shadow", abSplit },
  };
}
const ok: WorkflowRule = normalizeRule(ruleWith({ targetWorkflowId: "wf-9", weightPercent: 25 }));
t("abSplit round-trips through normalizeRule", ok.controls.abSplit?.targetWorkflowId === "wf-9" && ok.controls.abSplit?.weightPercent === 25);
t("weight clamps high to 99", normalizeRule(ruleWith({ targetWorkflowId: "x", weightPercent: 150 })).controls.abSplit?.weightPercent === 99);
t("weight clamps low to 1", normalizeRule(ruleWith({ targetWorkflowId: "x", weightPercent: 0.2 })).controls.abSplit?.weightPercent === 1);
t("garbage abSplit is dropped", normalizeRule(ruleWith({ targetWorkflowId: 7 })).controls.abSplit === undefined);
t("NaN weight is dropped", normalizeRule(ruleWith({ targetWorkflowId: "x", weightPercent: NaN })).controls.abSplit === undefined);
t("legacy rule (no abSplit) stays clean", normalizeRule(ruleWith(undefined)).controls.abSplit === undefined);

if (failures) {
  console.error(`\n${failures} ab-split assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll ab-split assertions passed.");
