/**
 * Clause-coverage projection suite — pins the honesty contract of
 * parserCoverage: every material clause is accounted for, and the
 * deterministic parser NEVER fabricates a rule component (the guard that
 * catches AI candidates in the hybrid path).
 * Run: npx tsx core-tests/assert-parser-coverage.ts
 */
import { parseInstruction } from "../packages/rule-core/src/nlParser";
import { segmentInstruction } from "../packages/rule-core/src/parserClauses";
import {
  clauseCoverage,
  projectClausesOntoRule,
} from "../packages/rule-core/src/parserCoverage";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

function cover(input: string, opts?: Parameters<typeof parseInstruction>[1]) {
  const result = parseInstruction(input, opts);
  const { clauses } = segmentInstruction(input);
  const report = clauseCoverage(clauses, result);
  return { result, clauses, report };
}

const linkFor = (
  report: ReturnType<typeof clauseCoverage>,
  clauses: ReturnType<typeof segmentInstruction>["clauses"],
  contains: string
) => {
  const clause = clauses.find((c) => c.text.includes(contains));
  return clause ? report.links.find((l) => l.clauseId === clause.id) : undefined;
};

/* ---- A: simple trigger + action ------------------------------------------ */
{
  const { report, clauses } = cover("when a loan is approved, assign to Wael");
  const trigger = linkFor(report, clauses, "approved");
  const action = linkFor(report, clauses, "assign to wael");
  t("A: trigger clause claims triggers[0]", trigger?.rulePaths.includes("triggers[0]") === true);
  t("A: action clause claims actions[0]", action?.rulePaths.includes("actions[0]") === true);
  t("A: both represented", trigger?.status === "represented" && action?.status === "represented");
  t("A: nothing unaccounted", report.materialUnaccounted.length === 0);
  t("A: nothing fabricated", report.fabricated.length === 0);
}

/* ---- B: condition + else lane -------------------------------------------- */
{
  const { report, clauses } = cover(
    "when a loan is approved and risk grade is worse than B, assign to Wael, otherwise notify Omar"
  );
  const cond = linkFor(report, clauses, "risk grade");
  const elseLink = linkFor(report, clauses, "notify omar");
  t("B: condition clause claims a condition leaf", cond?.rulePaths.some((p) => p.startsWith("conditions.leaf")) === true);
  t("B: otherwise clause claims else[0]", elseLink?.rulePaths.includes("else[0]") === true);
  t("B: nothing unaccounted", report.materialUnaccounted.length === 0);
  t("B: nothing fabricated", report.fabricated.length === 0);
}

/* ---- C: intentional no-op else ------------------------------------------- */
{
  const { report, clauses } = cover("when a loan is approved, assign to Wael, otherwise do nothing");
  const noop = linkFor(report, clauses, "do nothing");
  t("C: no-op clause status is no-op", noop?.status === "no-op");
  t("C: no-op clause claims no paths", (noop?.rulePaths.length ?? -1) === 0);
  t("C: nothing unaccounted", report.materialUnaccounted.length === 0);
  t("C: nothing fabricated", report.fabricated.length === 0);
}

/* ---- D: action gate (guard) ---------------------------------------------- */
{
  const { report, clauses, result } = cover(
    "when a loan is approved, notify Wael if loan amount is over 250k"
  );
  t("D: parser produced a gated action", !!result.rule?.actions[0]?.when);
  const allPaths = report.links.flatMap((l) => l.rulePaths);
  t("D: the gate path actions[0].when is claimed", allPaths.includes("actions[0].when"));
  t("D: nothing unaccounted", report.materialUnaccounted.length === 0);
  t("D: nothing fabricated", report.fabricated.length === 0, JSON.stringify(report.fabricated));
  const claimed = new Map<string, number>();
  for (const p of allPaths) claimed.set(p, (claimed.get(p) ?? 0) + 1);
  t("D: no component is double-claimed", [...claimed.values()].every((n) => n === 1));
}

/* ---- E: unresolved entity is accounted (not silently dropped) ------------ */
{
  const { report, clauses } = cover("when a loan is approved, assign to Zorblatt");
  const action = linkFor(report, clauses, "zorblatt");
  t("E: unknown-assignee clause status is unresolved", action?.status === "unresolved");
  t("E: unresolved is ACCOUNTED (not in materialUnaccounted)", report.materialUnaccounted.length === 0);
  t("E: nothing fabricated", report.fabricated.length === 0);
}

/* ---- F: genuinely uncovered text blocks ---------------------------------- */
{
  const { report, clauses } = cover("when a loan is approved, fly it to the moon base");
  const lost = linkFor(report, clauses, "moon");
  t("F: unparseable clause status is uncovered", lost?.status === "uncovered");
  t("F: uncovered clause lands in materialUnaccounted", report.materialUnaccounted.includes(lost ? clauses.find((c) => c.text.includes("moon"))!.id : "-"));
  t("F: still nothing fabricated", report.fabricated.length === 0);
}

/* ---- G: dual trigger — one clause claims both events ---------------------- */
{
  const { report, clauses, result } = cover("when a loan is approved or rejected, notify Omar");
  t("G: two triggers parsed", result.rule?.triggers.length === 2);
  const trig = linkFor(report, clauses, "approved");
  t(
    "G: the trigger clause claims both triggers",
    trig?.rulePaths.includes("triggers[0]") === true && trig?.rulePaths.includes("triggers[1]") === true
  );
  t("G: nothing unaccounted", report.materialUnaccounted.length === 0);
  t("G: nothing fabricated", report.fabricated.length === 0);
}

/* ---- H: delay suffix ------------------------------------------------------ */
{
  const { report, result } = cover("when a loan is approved, change stage to Closed after 2 days");
  t("H: delay parsed", result.rule?.actions[0]?.delayMinutes === 2880);
  const allPaths = report.links.flatMap((l) => l.rulePaths);
  t("H: delay path claimed", allPaths.includes("actions[0].delayMinutes"));
  t("H: nothing unaccounted", report.materialUnaccounted.length === 0);
  t("H: nothing fabricated", report.fabricated.length === 0);
}

/* ---- I: negated instruction is accounted by exclusion --------------------- */
{
  const { report, clauses, result } = cover("when a loan is approved, assign to Wael, don't notify Omar");
  t("I: negation excluded the notify action", result.rule?.actions.every((a) => a.action !== "notify") === true);
  const neg = linkFor(report, clauses, "notify omar");
  t("I: negated clause status is no-op", neg?.status === "no-op");
  t("I: negated clause claims nothing", (neg?.rulePaths.length ?? -1) === 0);
  t("I: nothing unaccounted", report.materialUnaccounted.length === 0);
  t("I: nothing fabricated", report.fabricated.length === 0);
}

/* ---- J: non-default control claimed by its clause ------------------------- */
{
  const { report, result } = cover("when a loan is approved, assign to Wael, cap at 10 fires per hour");
  t("J: rate cap parsed", result.rule?.controls.maxFiresPerHour === 10);
  const allPaths = report.links.flatMap((l) => l.rulePaths);
  t("J: controls.maxFiresPerHour claimed", allPaths.includes("controls.maxFiresPerHour"));
  t("J: nothing fabricated", report.fabricated.length === 0);
}

/* ---- K: ambiguity clause -------------------------------------------------- */
{
  const { report, clauses, result } = cover("when it is approved, notify Omar");
  t("K: parser asked instead of guessing", result.ambiguities.length === 1 && result.rule === null);
  const amb = linkFor(report, clauses, "approved");
  t("K: ambiguity clause status is ambiguous", amb?.status === "ambiguous");
  t("K: no rule → no fabricated paths", report.fabricated.length === 0);
}

/* ---- L: two actions claim distinct clauses -------------------------------- */
{
  const { report, clauses, result } = cover("when a loan is approved, assign to Wael and notify Omar");
  t("L: two actions parsed", result.rule?.actions.length === 2);
  const first = linkFor(report, clauses, "wael");
  const second = linkFor(report, clauses, "omar");
  t(
    "L: each action claimed by its own clause",
    first?.rulePaths.length === 1 && second?.rulePaths.length === 1 && first.rulePaths[0] !== second.rulePaths[0]
  );
  t("L: nothing fabricated", report.fabricated.length === 0);
}

/* ---- M: determinism ------------------------------------------------------- */
{
  const input = "when a loan is approved and risk grade is worse than B, assign to Wael, otherwise notify Omar";
  const a = cover(input).report;
  const b = cover(input).report;
  t("M: identical input → byte-identical report", JSON.stringify(a) === JSON.stringify(b));
  const { result, clauses } = cover(input);
  t(
    "M: projectClausesOntoRule agrees with clauseCoverage links",
    JSON.stringify(projectClausesOntoRule(clauses, result)) === JSON.stringify(clauseCoverage(clauses, result).links)
  );
}

/* ---- N: fabrication guard sweep — deterministic parses never fabricate ---- */
{
  const sweep = [
    "when a loan is approved, assign to Wael",
    "when a document is rejected, notify Sara and add tag follow-up",
    "when an offer is accepted, close the request",
    "when a loan is approved and loan amount is over 500k, escalate to the credit committee",
    "booking status is Error, notify Operations Team",
    "when a loan is approved, change stage to Processing, otherwise do nothing",
  ];
  let fabricatedTotal = 0;
  for (const input of sweep) {
    fabricatedTotal += cover(input).report.fabricated.length;
  }
  t("N: zero fabricated components across the sweep", fabricatedTotal === 0);
}

if (failures > 0) {
  console.error(`\n${failures} clause-coverage assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll clause-coverage assertions passed.");
