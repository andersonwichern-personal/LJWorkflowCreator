export {};

// Phase 8 §7 — exercises the REAL scheduled-action logic
// (lib/scheduledActions.ts): runAt derivation (negative offsets), invalid
// anchors, and supersede-and-reinsert planning that never touches history.

import {
  ScheduledActionRow,
  computeRunAt,
  planReschedule,
} from "../lib/scheduledActions";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

// 1. computeRunAt: derived, signed, calendar-minute math.
const anchor = "2026-07-21T00:00:00.000Z";
t("negative offset (-7200 min = 5 days before)", computeRunAt(anchor, -7200) === "2026-07-16T00:00:00.000Z", computeRunAt(anchor, -7200));
t("zero offset lands on the anchor", computeRunAt(anchor, 0) === anchor);
t("positive offset (+90 min after)", computeRunAt(anchor, 90) === "2026-07-21T01:30:00.000Z", computeRunAt(anchor, 90));
t("offset crosses a day boundary backwards", computeRunAt(anchor, -1) === "2026-07-20T23:59:00.000Z");

let threw = false;
try {
  computeRunAt("not-a-date", -60);
} catch {
  threw = true;
}
t("invalid anchor throws", threw);

// 2. planReschedule: supersedes ONLY matching pending rows.
function row(overrides: Partial<ScheduledActionRow> & { id: string }): ScheduledActionRow {
  return {
    workflowId: "wf-1",
    requestId: "REQ-100",
    actionIndex: 0,
    anchorField: "maturity_date",
    offsetMinutes: -7200,
    runAt: computeRunAt("2026-07-10T00:00:00.000Z", -7200),
    status: "pending",
    supersedes: null,
    ...overrides,
  };
}

const rows: ScheduledActionRow[] = [
  row({ id: "sa-pending-a" }),
  row({ id: "sa-pending-b", actionIndex: 1, offsetMinutes: -60 }),
  row({ id: "sa-fired", status: "fired" }),
  row({ id: "sa-canceled", status: "canceled" }),
  row({ id: "sa-superseded", status: "superseded" }),
  row({ id: "sa-other-request", requestId: "REQ-999" }),
  row({ id: "sa-other-field", anchorField: "review_date" }),
];

const newAnchor = "2026-08-01T12:00:00.000Z";
const plan = planReschedule(rows, "REQ-100", "maturity_date", newAnchor);

t("supersedes exactly the two matching pending rows", plan.supersede.length === 2 && plan.supersede.includes("sa-pending-a") && plan.supersede.includes("sa-pending-b"), JSON.stringify(plan.supersede));
for (const untouched of ["sa-fired", "sa-canceled", "sa-superseded", "sa-other-request", "sa-other-field"]) {
  t(`${untouched} is untouched`, !plan.supersede.includes(untouched));
}
t("one replacement per superseded row", plan.insert.length === 2, String(plan.insert.length));

const replA = plan.insert.find((r) => r.supersedes === "sa-pending-a");
const replB = plan.insert.find((r) => r.supersedes === "sa-pending-b");
t("replacements chain supersedes to the old ids", !!replA && !!replB);
t("replacement runAt is re-derived from the NEW anchor (offset -7200)", replA?.runAt === computeRunAt(newAnchor, -7200), replA?.runAt);
t("replacement runAt is re-derived per-row offset (-60)", replB?.runAt === computeRunAt(newAnchor, -60), replB?.runAt);
t("replacement preserves workflow/request/action/anchor/offset", !!replA && replA.workflowId === "wf-1" && replA.requestId === "REQ-100" && replA.actionIndex === 0 && replA.anchorField === "maturity_date" && replA.offsetMinutes === -7200);
t("replacements carry no authored id/status", plan.insert.every((r) => !("id" in r) && !("status" in r)));

// 3. Edge cases.
const empty = planReschedule([], "REQ-100", "maturity_date", newAnchor);
t("empty rows → empty plan", empty.supersede.length === 0 && empty.insert.length === 0);

const noMatch = planReschedule(rows, "REQ-100", "nonexistent_field", newAnchor);
t("no matching field → empty plan", noMatch.supersede.length === 0 && noMatch.insert.length === 0);

const again = planReschedule(rows, "REQ-100", "maturity_date", newAnchor);
t("planning is deterministic (same inputs → deep-equal plan)", JSON.stringify(again) === JSON.stringify(plan));

if (failures) {
  console.error(`\n${failures} scheduled-action assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll scheduled-action assertions passed.");
