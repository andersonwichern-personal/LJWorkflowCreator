export {};

// Phase 7.1 — exercises the REAL analytics aggregation the API route serves
// (lib/executionAnalytics.ts). Pure math: no DB, no clock, no randomness.

import {
  AnalyticsRow,
  computeExecutionAnalytics,
  matchRatePct,
  mockLatencyMinutes,
} from "../lib/executionAnalytics";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const rows: AnalyticsRow[] = [
  { workflowId: "wf-a", requestId: "REQ-1", status: "FIRED" },
  { workflowId: "wf-a", requestId: "REQ-2", status: "SHADOW" },
  { workflowId: "wf-a", requestId: "REQ-3", status: "CONDITIONS_NOT_MET" },
  { workflowId: "wf-b", requestId: "REQ-1", status: "FIRED" },
  { workflowId: "wf-b", requestId: "REQ-4", status: "ERROR" },
];

const a = computeExecutionAnalytics(rows);

// Totals grouped by status.
t("evaluations counts every row", a.totals.evaluations === 5);
t("fired counts FIRED rows", a.totals.fired === 2);
t("shadow counts SHADOW rows", a.totals.shadow === 1);
t("errors counts ERROR rows", a.totals.errors === 1);

// Hotspots keyed by workflowId.
t("hotspot counts wf-a executions", a.hotspots["wf-a"] === 3);
t("hotspot counts wf-b executions", a.hotspots["wf-b"] === 2);
t("hotspots have no phantom keys", Object.keys(a.hotspots).length === 2);

// Mock latency: deterministic, inside the 15–90 spectrum, averaged per distinct request.
for (const id of ["REQ-1", "REQ-2", "x", "a-very-long-request-identifier-000"]) {
  const v = mockLatencyMinutes(id);
  t(`latency for ${id} is in [15,90]`, v >= 15 && v <= 90, String(v));
  t(`latency for ${id} is deterministic`, v === mockLatencyMinutes(id));
}
const distinct = ["REQ-1", "REQ-2", "REQ-3", "REQ-4"];
const expectedAvg = Math.round(
  distinct.map(mockLatencyMinutes).reduce((s, v) => s + v, 0) / distinct.length
);
t("average latency averages distinct requests once", a.averageLatencyMinutes === expectedAvg);
t("average latency in [15,90]", a.averageLatencyMinutes >= 15 && a.averageLatencyMinutes <= 90);

// Match rate.
t("match rate = fired/evaluations", matchRatePct(a) === Math.round((2 / 5) * 100));

// Empty log → all zeros, no divide-by-zero.
const empty = computeExecutionAnalytics([]);
t("empty log yields zero totals", empty.totals.evaluations === 0 && empty.totals.fired === 0);
t("empty log yields zero latency", empty.averageLatencyMinutes === 0);
t("empty log yields zero match rate", matchRatePct(empty) === 0);
t("empty log yields empty hotspots", Object.keys(empty.hotspots).length === 0);

// Determinism end-to-end: same rows → identical result.
t(
  "aggregation is deterministic",
  JSON.stringify(a) === JSON.stringify(computeExecutionAnalytics(rows))
);

if (failures) {
  console.error(`\n${failures} analytics assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll analytics assertions passed.");
