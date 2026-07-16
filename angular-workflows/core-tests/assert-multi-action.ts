// PORTED from scripts/assert-multi-action.ts (Vercel track) — drift guard for the shared rule core.
/**
 * Parser upgrade suite — multi-action instructions, action delays, and capture
 * hygiene. Run: npx tsx scripts/assert-multi-action.ts
 *
 * Why this exists: the heuristic parser's action regexes used to end with
 * `(?:\s+(?:and|then|,|\.)|$)`, which CONSUMED the connector. Once "… assign to
 * Wael and add tag x" had its "and" eaten by the assign match, the tag matcher
 * could still find its own text, but any matcher relying on the connector as a
 * left boundary could not — and a trailing "." leaked into the captured name
 * ("Wael." never resolves). The connectors are now zero-width lookaheads
 * `(?=\s*(?:and|then|unless|otherwise|except|,|\.|;|$))` and captures are run
 * through stripTrailingPunct.
 *
 * The delay cases guard a specific regression: the unit must come from the
 * regex capture, never from re-scanning the whole match (a stage named
 * "monday review" contains "day" and silently turned 3 weeks into 3 days).
 */

import { parseInstruction } from "../src/app/core/nlParser";
import type { ParseResult } from "../src/app/core/nlParser";
import { paramKeyFor, scopeLabel } from "../src/app/core/vocabulary";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

/** Action keys in dispatch order. */
function actionKeys(r: ParseResult): string[] {
  return (r.rule?.actions ?? []).map((a) => a.action);
}
function actionNamed(r: ParseResult, key: string) {
  return (r.rule?.actions ?? []).find((a) => a.action === key);
}
/** An action's resolved param value, read through the action's own param key
 *  (assign_user keys on "assignee", add_tag on "value" — never assume). */
function paramValue(r: ParseResult, key: string): string {
  return scopeLabel(actionNamed(r, key)?.params?.[paramKeyFor(key)]);
}

/* -- 1. multi-action: both halves of an "and" survive ---------------------- */

const bookingFail = parseInstruction(
  "When a Fiserv booking fails with Error, assign it to Booking Team and add tag booking-failed"
);
t("multi-action: assign + add_tag both parse", actionKeys(bookingFail).join(",") === "assign_user,add_tag", actionKeys(bookingFail).join(",") || "(none)");

const assignNotify = parseInstruction(
  "If loan amount is at least 250000 and risk grade is worse than C after loan approval, assign to Underwriting Team and notify Wael"
);
t("multi-action: assign + notify both parse", actionKeys(assignNotify).join(",") === "assign_user,notify", actionKeys(assignNotify).join(",") || "(none)");

const assignClose = parseInstruction("When a loan is rejected, assign to Wael and close the request");
t("multi-action: assign + close_request both parse", actionKeys(assignClose).join(",") === "assign_user,close_request", actionKeys(assignClose).join(",") || "(none)");

const notifyTag = parseInstruction("When a loan is approved, notify Sara and add tag reviewed");
t("multi-action: notify + add_tag both parse", actionKeys(notifyTag).join(",") === "notify,add_tag", actionKeys(notifyTag).join(",") || "(none)");

/* -- 2. capture hygiene: punctuation must not leak into a resolved value --- */

const trailingDot = parseInstruction("When a loan is rejected, assign to Wael.");
t(
  "trailing '.' does not leak into the assignee",
  paramValue(trailingDot, "assign_user") === "Wael",
  JSON.stringify(actionNamed(trailingDot, "assign_user")?.params)
);
t("trailing '.' assignee resolves rather than going unresolved", trailingDot.unresolved.length === 0, JSON.stringify(trailingDot.unresolved));

const trailingDotTag = parseInstruction("When a loan is approved, add tag jumbo.");
t(
  "trailing '.' does not leak into a tag value",
  paramValue(trailingDotTag, "add_tag") === "jumbo",
  JSON.stringify(actionNamed(trailingDotTag, "add_tag")?.params)
);

/* -- 3. change_stage delays: quantity AND unit from the captures ----------- */

const days = parseInstruction("When a loan is rejected, change stage to Closed after 2 days");
t("delay: 'after 2 days' → 2880 minutes", actionNamed(days, "change_stage")?.delayMinutes === 2880, String(actionNamed(days, "change_stage")?.delayMinutes));

const hours = parseInstruction("When a loan is rejected, change stage to Closed in 24 hours");
t("delay: 'in 24 hours' → 1440 minutes", actionNamed(hours, "change_stage")?.delayMinutes === 1440, String(actionNamed(hours, "change_stage")?.delayMinutes));

const weeks = parseInstruction("When a loan is rejected, change stage to Closed in 3 weeks");
t("delay: 'in 3 weeks' → 30240 minutes", actionNamed(weeks, "change_stage")?.delayMinutes === 30240, String(actionNamed(weeks, "change_stage")?.delayMinutes));

// The regression that motivated capturing the unit: "monday" contains "day", and
// re-scanning the match text found it before "weeks" → 3 days instead of 3 weeks.
const unitEmbedded = parseInstruction("When a loan is rejected, change stage to monday review in 3 weeks");
t(
  "delay: a stage name containing 'day' does not hijack the unit",
  actionNamed(unitEmbedded, "change_stage")?.delayMinutes === 30240,
  `got ${actionNamed(unitEmbedded, "change_stage")?.delayMinutes} (want 30240)`
);

// Same hazard from the other side: gate text after the delay must not supply the unit.
const gateAfterDelay = parseInstruction("When a loan is rejected, change stage to Closed in 2 weeks if tag is holiday");
t(
  "delay: gate text containing 'day' does not hijack the unit",
  actionNamed(gateAfterDelay, "change_stage")?.delayMinutes === 20160,
  `got ${actionNamed(gateAfterDelay, "change_stage")?.delayMinutes} (want 20160)`
);
t(
  "delay + gate: the if-clause still attaches as an action gate",
  actionNamed(gateAfterDelay, "change_stage")?.when !== undefined,
  JSON.stringify(actionNamed(gateAfterDelay, "change_stage")?.when)
);

const noDelay = parseInstruction("When a loan is rejected, change stage to Closed");
t("no delay phrase → delayMinutes stays absent", actionNamed(noDelay, "change_stage")?.delayMinutes === undefined, String(actionNamed(noDelay, "change_stage")?.delayMinutes));

/* -- 4. the reminder path keeps its signed delay --------------------------- */

const remindBefore = parseInstruction("When a loan is approved, remind Wael 5 days before the maturity date");
t(
  "remind '5 days before' stays negative (-7200)",
  actionNamed(remindBefore, "notify")?.delayMinutes === -7200,
  String(actionNamed(remindBefore, "notify")?.delayMinutes)
);

/* -- 5. honesty guarantees still hold under multi-action ------------------- */

const fabricated = parseInstruction("When a loan is rejected, assign to Santa Claus and add tag escalated");
t("unknown assignee in a multi-action instruction is still unresolved, not invented", fabricated.unresolved.some((u) => u.where === "action-param" && /santa/i.test(u.heard)), JSON.stringify(fabricated.unresolved));
t("…and the sibling action still parses", actionKeys(fabricated).includes("add_tag"), actionKeys(fabricated).join(","));

if (failures) {
  console.error(`\n${failures} multi-action assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll multi-action parser assertions passed.");
