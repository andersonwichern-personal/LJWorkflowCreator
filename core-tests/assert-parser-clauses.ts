/**
 * Clause segmentation assertions (parser AI engine — parserClauses.ts contract).
 * Run: npx tsx core-tests/assert-parser-clauses.ts
 *
 * Invariants pinned here:
 * - normalizeSource.text is EXACTLY nlParser's norm(); the offset map round-trips into raw.
 * - Clauses tile the normalized text: every non-space char is covered exactly once, with only
 *   separator punctuation (,;.) and boundary connectors (and/then) allowed between spans.
 * - Ids are pure content hashes of (source.text, span) — generation-scoped: an edit anywhere
 *   shifts spans and CHANGES ids downstream; that is intended, and asserted, behavior.
 * - Cross-check against the real parser: text nlParser reports as `uncovered` is never inside a
 *   clause this module claims as satisfied (it must land in material or unknown/unsupported
 *   clauses). Containment is directional/loose by design.
 */
import {
  normalizeSource,
  segmentInstruction,
  stableClauseId,
  ParsedClause,
} from "../packages/rule-core/src/parserClauses";
import { parseInstruction } from "../packages/rule-core/src/nlParser";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

/** Replica of nlParser's norm() — the equality target for normalizeSource.text. */
function normReplica(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

const kinds = (cs: ParsedClause[]) => cs.map((c) => c.kind);
const texts = (cs: ParsedClause[]) => cs.map((c) => c.text);

/* ---- normalizeSource: offset map ------------------------------------------ */

{
  const raw = "  When   a LOAN is    Approved,   Assign   to Wael  ";
  const src = normalizeSource(raw);
  t("normalize: text equals norm()", src.text === normReplica(raw), src.text);
  t("normalize: collapses to expected text", src.text === "when a loan is approved, assign to wael");
  let mapOk = true;
  for (let i = 0; i < src.text.length; i++) {
    if (src.text[i] === " ") continue;
    if (raw[src.toRaw(i)].toLowerCase() !== src.text[i]) mapOk = false;
  }
  t("normalize: property raw[toRaw(i)] matches every non-space char", mapOk);
  const idx = src.text.indexOf("wael");
  const r = src.toRaw(idx);
  t("normalize: toRaw round-trips a targeted word", raw.slice(r, r + 4) === "Wael", raw.slice(r, r + 4));
  t("normalize: toRaw(0) maps past the trimmed lead", raw[src.toRaw(0)] === "W");
}

{
  const raws = [
    "A\t\tB\ncc  DD ",
    "   ",
    "",
    "one  two   THREE",
    " Mixed \r\n Whitespace\tEverywhere ",
  ];
  t(
    "normalize: text === norm() over varied whitespace/case inputs",
    raws.every((raw) => normalizeSource(raw).text === normReplica(raw))
  );
  t("normalize: empty input → empty text, toRaw(0) = 0", normalizeSource("   ").text === "" && normalizeSource("   ").toRaw(0) === 0);
}

/* ---- tiling invariant helper ---------------------------------------------- */

function assertTiling(name: string, input: string) {
  const { source, clauses } = segmentInstruction(input);
  const covered = new Array(source.text.length).fill(0);
  for (const c of clauses) for (let i = c.span.start; i < c.span.end; i++) covered[i]++;
  const overlap = covered.some((n) => n > 1);
  let gap = "";
  for (let i = 0; i < covered.length; i++) if (covered[i] === 0) gap += source.text[i];
  const residue = gap.replace(/\band\b|\bthen\b/g, "").replace(/[\s.,;]/g, "");
  t(`tiling: ${name}`, !overlap && residue === "", `overlap=${overlap} residue="${residue}"`);
  t(
    `tiling slices: ${name}`,
    clauses.every((c) => c.text === source.text.slice(c.span.start, c.span.end))
  );
}

/* ---- single sentence: trigger + action ------------------------------------ */

{
  const { clauses } = segmentInstruction("when a loan is approved, assign to Wael");
  t(
    "basic: trigger + action-primary",
    kinds(clauses).join("|") === "trigger|action-primary",
    kinds(clauses).join("|")
  );
  t(
    "basic: exact clause texts",
    texts(clauses).join("|") === "when a loan is approved|assign to wael",
    texts(clauses).join("|")
  );
  assertTiling("basic trigger+action", "when a loan is approved, assign to Wael");
}

/* ---- trigger-level or stays INSIDE the trigger clause ---------------------- */

{
  const { clauses } = segmentInstruction("when a loan is approved or rejected, notify Omar");
  t(
    "trigger-or: one trigger clause holds the whole pair",
    clauses[0].kind === "trigger" && clauses[0].text === "when a loan is approved or rejected",
    texts(clauses).join("|")
  );
  t(
    "trigger-or: no clause splits the or-pair",
    clauses.filter((c) => c.text.includes("approved or rejected")).length === 1 &&
      kinds(clauses).join("|") === "trigger|action-primary"
  );
  assertTiling("trigger-level or", "when a loan is approved or rejected, notify Omar");
}

/* ---- condition OR vs trigger or ------------------------------------------- */

{
  const input = "when a loan is approved and risk grade is C or D, notify Omar";
  const { clauses } = segmentInstruction(input);
  t(
    "condition-or: kinds trigger|condition|action-primary",
    kinds(clauses).join("|") === "trigger|condition|action-primary",
    kinds(clauses).join("|")
  );
  const cond = clauses.find((c) => c.kind === "condition");
  t("condition-or: condition clause keeps 'c or d'", !!cond && cond.text.includes("c or d"), cond?.text);
  t("condition-or: trigger clause unchanged", clauses[0].text === "when a loan is approved");
  assertTiling("condition-or", input);
}

/* ---- action gate → action + action-guard ---------------------------------- */

{
  const { clauses } = segmentInstruction("notify sara if loan amount is over 250k");
  t(
    "guard: action-primary + action-guard",
    kinds(clauses).join("|") === "action-primary|action-guard",
    kinds(clauses).join("|")
  );
  t(
    "guard: guard clause covers the gate text",
    clauses[1].text === "if loan amount is over 250k",
    clauses[1].text
  );
  assertTiling("bare gated action", "notify sara if loan amount is over 250k");
}

{
  const input = "when a loan is approved, notify sara if loan amount is over 250k";
  const { clauses } = segmentInstruction(input);
  t(
    "guard: with trigger → trigger|action-primary|action-guard",
    kinds(clauses).join("|") === "trigger|action-primary|action-guard",
    kinds(clauses).join("|")
  );
  assertTiling("gated action with trigger", input);
}

/* ---- alternate lane -------------------------------------------------------- */

{
  const input = "when a loan is approved, notify sara, otherwise escalate to credit committee";
  const { clauses } = segmentInstruction(input);
  t(
    "alternate: otherwise clause → action-alternate",
    kinds(clauses).join("|") === "trigger|action-primary|action-alternate",
    kinds(clauses).join("|")
  );
  t(
    "alternate: marker stays attached to its clause",
    clauses[2].text === "otherwise escalate to credit committee",
    clauses[2].text
  );
  assertTiling("alternate lane", input);
}

/* ---- explicit no-op -------------------------------------------------------- */

{
  const { clauses } = segmentInstruction("when a loan is approved, notify sara, otherwise do nothing");
  const noop = clauses[clauses.length - 1];
  t("no-op: 'otherwise do nothing' → no-op", noop.kind === "no-op", noop.kind);
  t("no-op: intentional statement is material", noop.material === true);
}

{
  const { clauses } = segmentInstruction("otherwise do nothing");
  t(
    "no-op: bare variant classifies and stays material",
    clauses.length === 1 && clauses[0].kind === "no-op" && clauses[0].material === true,
    JSON.stringify(clauses.map((c) => ({ kind: c.kind, material: c.material })))
  );
}

/* ---- negation -------------------------------------------------------------- */

{
  const { clauses } = segmentInstruction("when a loan is approved, don't notify omar");
  const neg = clauses[1];
  t(
    "negation: prohibition clause keeps the action lane and sets negated",
    neg.kind === "action-primary" && neg.negated === true,
    JSON.stringify({ kind: neg.kind, negated: neg.negated })
  );
  t(
    "negation: flag only on the prohibition clause",
    clauses.filter((c) => c.negated).length === 1
  );
  assertTiling("negation", "when a loan is approved, don't notify omar");
}

/* ---- controls --------------------------------------------------------------- */

{
  const { clauses } = segmentInstruction("shadow mode, cap at 10 fires per hour");
  t(
    "controls: shadow mode + rate cap → control clauses",
    kinds(clauses).join("|") === "control|control",
    kinds(clauses).join("|")
  );
}

{
  const input = "when a loan is approved, arm this rule, once per request, and cap 10 fires per hour";
  const { clauses } = segmentInstruction(input);
  t(
    "controls: arm/once-per/cap all classify as control",
    kinds(clauses).join("|") === "trigger|control|control|control",
    kinds(clauses).join("|")
  );
  assertTiling("controls", input);
}

/* ---- timing: inline stays in the action; standalone becomes timing ---------- */

{
  const input = "when a loan is rejected, change stage to closed after 2 days";
  const { clauses } = segmentInstruction(input);
  t(
    "timing: inline delay stays inside the action clause",
    kinds(clauses).join("|") === "trigger|action-primary" &&
      clauses[1].text === "change stage to closed after 2 days",
    JSON.stringify(texts(clauses))
  );
  t("timing: no standalone timing clause emitted inline", clauses.every((c) => c.kind !== "timing"));
}

{
  const { clauses } = segmentInstruction("when a loan is rejected, change stage to closed, after 2 days");
  t(
    "timing: comma-separated delay clause → timing",
    kinds(clauses).join("|") === "trigger|action-primary|timing",
    kinds(clauses).join("|")
  );
}

{
  const { clauses } = segmentInstruction("when a loan is approved, remind wael 3 days before the deadline");
  t(
    "timing: nlParser's remind form stays one action clause",
    kinds(clauses).join("|") === "trigger|action-primary" &&
      clauses[1].text === "remind wael 3 days before the deadline",
    JSON.stringify(texts(clauses))
  );
}

/* ---- unsupported semantics --------------------------------------------------- */

{
  const { clauses } = segmentInstruction("every monday send a report");
  t(
    "unsupported: schedule language → unsupported with reason",
    clauses.length === 1 &&
      clauses[0].kind === "unsupported" &&
      (clauses[0].unsupportedReason ?? "").includes("recurring"),
    JSON.stringify(clauses[0])
  );
  t("unsupported: schedule clause is material", clauses[0].material === true);
}

{
  const { clauses } = segmentInstruction("when a loan is approved, check again daily");
  const u = clauses[1];
  t(
    "unsupported: 'daily' recurrence → unsupported",
    u.kind === "unsupported" && (u.unsupportedReason ?? "").includes("recurring"),
    JSON.stringify(u)
  );
}

{
  const { clauses } = segmentInstruction("keep escalating until someone responds");
  t(
    "unsupported: escalation loop → unsupported with loop reason",
    clauses.length === 1 &&
      clauses[0].kind === "unsupported" &&
      (clauses[0].unsupportedReason ?? "").includes("loops"),
    JSON.stringify(clauses[0])
  );
}

{
  const { clauses } = segmentInstruction("when a loan is approved, remind wael in 3 business days");
  t(
    "unsupported: business-day calendar math → unsupported",
    clauses[1].kind === "unsupported" && (clauses[1].unsupportedReason ?? "").includes("business-day"),
    JSON.stringify(clauses[1])
  );
}

{
  const { clauses } = segmentInstruction("when a loan is approved, ask the credit bureau");
  t(
    "unsupported: external decision → unsupported",
    clauses[1].kind === "unsupported" && (clauses[1].unsupportedReason ?? "").includes("external"),
    JSON.stringify(clauses[1])
  );
  t(
    "unsupported: reason present only on unsupported clauses",
    clauses.every((c) => (c.kind === "unsupported") === (c.unsupportedReason !== undefined))
  );
}

/* ---- unknown vs noise -------------------------------------------------------- */

{
  const { clauses } = segmentInstruction("when a loan is approved, fly it to the moon base");
  const u = clauses[1];
  t("unknown: no-evidence clause → unknown", u.kind === "unknown", u.kind);
  t("unknown: material when it carries content words", u.material === true);
}

{
  const { clauses } = segmentInstruction("please and the");
  t(
    "noise: pure connector clause → unknown, NOT material",
    clauses.length === 1 && clauses[0].kind === "unknown" && clauses[0].material === false,
    JSON.stringify(clauses.map((c) => ({ kind: c.kind, material: c.material })))
  );
}

/* ---- exception clause + split conservatism ----------------------------------- */

{
  const input = "when a loan is approved, assign to wael unless risk grade is e";
  const { clauses } = segmentInstruction(input);
  t(
    "unless: exception clause splits off and classifies by its condition evidence",
    kinds(clauses).join("|") === "trigger|action-primary|condition" &&
      clauses[2].text === "unless risk grade is e",
    JSON.stringify(texts(clauses))
  );
  assertTiling("unless", input);
}

{
  const { clauses } = segmentInstruction("add tag terms and conditions");
  t(
    "conservatism: mid-phrase 'and' without independent evidence never splits",
    clauses.length === 1 && clauses[0].kind === "action-primary",
    JSON.stringify(texts(clauses))
  );
}

/* ---- full-pipeline kinds ------------------------------------------------------- */

{
  const input =
    "when a loan is approved and risk grade is c or d, notify sara if loan amount is over 250k, otherwise do nothing";
  const { clauses } = segmentInstruction(input);
  t(
    "pipeline: trigger|condition|action-primary|action-guard|no-op",
    kinds(clauses).join("|") === "trigger|condition|action-primary|action-guard|no-op",
    kinds(clauses).join("|")
  );
  assertTiling("full pipeline", input);
}

/* ---- tiling over further varied inputs ---------------------------------------- */

assertTiling("pill 1", "If there is a system error and booking status is Error, assign to Wael");
assertTiling("pill 2", "When a loan is approved and loan amount is at least 250k, assign to Underwriting Team");
assertTiling("pill 3", "When a Fiserv loan booking status is Error, notify Booking Team and add tag booking-failed");
assertTiling("pill 4", "When a loan is rejected, change stage to Closed");

{
  const { clauses } = segmentInstruction(
    "When a Fiserv loan booking status is Error, notify Booking Team and add tag booking-failed"
  );
  t(
    "pill 3: trigger clause = matchEvent's trigger clause; two primary actions",
    kinds(clauses).join("|") === "trigger|action-primary|action-primary",
    kinds(clauses).join("|")
  );
}

/* ---- determinism + id stability ------------------------------------------------- */

{
  const input =
    "when a loan is approved and risk grade is c or d, notify sara if loan amount is over 250k, otherwise do nothing";
  const a = segmentInstruction(input);
  const b = segmentInstruction(input);
  t("stability: two runs are deep-equal", JSON.stringify(a.clauses) === JSON.stringify(b.clauses));
  t(
    "stability: every id matches a stableClauseId recomputation",
    a.clauses.every((c) => c.id === stableClauseId(a.source.text, c.span))
  );
  t("stability: id format cl-<8 hex>", a.clauses.every((c) => /^cl-[0-9a-f]{8}$/.test(c.id)));
}

{
  t(
    "stableClauseId: deterministic for equal args",
    stableClauseId("abc def", { start: 0, end: 3 }) === stableClauseId("abc def", { start: 0, end: 3 })
  );
  t(
    "stableClauseId: span-sensitive",
    stableClauseId("abc def", { start: 0, end: 3 }) !== stableClauseId("abc def", { start: 4, end: 7 })
  );
  t(
    "stableClauseId: text-sensitive",
    stableClauseId("abc def", { start: 0, end: 3 }) !== stableClauseId("abc xyz", { start: 0, end: 3 })
  );
}

{
  // Generation-scoped ONLY: an edit anywhere in the text shifts spans and changes downstream ids.
  const a = segmentInstruction("when a loan is approved, assign to wael");
  const b = segmentInstruction("when the loan is approved, assign to wael");
  const actionA = a.clauses.find((c) => c.kind === "action-primary");
  const actionB = b.clauses.find((c) => c.kind === "action-primary");
  t(
    "stability: ids change under upstream edits (generation-scoped by design)",
    !!actionA && !!actionB && actionA.id !== actionB.id
  );
}

/* ---- rawSpan --------------------------------------------------------------------- */

{
  const raw = "  WHEN a Loan   IS approved,   NOTIFY omar  ";
  const { source, clauses } = segmentInstruction(raw);
  const action = clauses.find((c) => c.kind === "action-primary");
  t(
    "rawSpan: raw slice normalizes back to the clause text",
    !!action && normReplica(source.raw.slice(action.rawSpan.start, action.rawSpan.end)) === action.text,
    action && source.raw.slice(action.rawSpan.start, action.rawSpan.end)
  );
  t(
    "rawSpan: every clause round-trips through raw",
    clauses.every((c) => normReplica(source.raw.slice(c.rawSpan.start, c.rawSpan.end)) === c.text)
  );
}

/* ---- empty input ------------------------------------------------------------------ */

{
  t("empty: no clauses for empty input", segmentInstruction("").clauses.length === 0);
  t("empty: no clauses for whitespace input", segmentInstruction("   \t  ").clauses.length === 0);
}

/* ---- cross-check with the real parser --------------------------------------------- */
/* Every fragment nlParser reports as `uncovered` must land in clauses that are material or
 * unknown/unsupported — segmentation never classifies text the parser failed on as satisfied.
 * Containment is span-overlap based and intentionally loose (directional, not equality). */

function crossCheck(name: string, input: string) {
  const r = parseInstruction(input);
  const { source, clauses } = segmentInstruction(input);
  let ok = true;
  let why = "";
  for (const frag of r.uncovered) {
    const at = source.text.indexOf(frag);
    const overlapping = clauses.filter((c) =>
      at >= 0 ? c.span.start < at + frag.length && at < c.span.end : c.text.includes(frag)
    );
    const accounted = overlapping.some(
      (c) => c.material || c.kind === "unknown" || c.kind === "unsupported"
    );
    if (!accounted) {
      ok = false;
      why = `fragment "${frag}" landed only in satisfied clauses`;
    }
  }
  t(`cross-check: ${name}`, ok, why);
}

crossCheck("assign + unknown tail", "when a loan is approved, assign to wael and request tax returns");
crossCheck("unknown clause", "when a loan is approved, fly it to the moon base");
crossCheck("unparsed else clause", "when a loan is approved, notify sara otherwise fly to the moon");
crossCheck("unsplit condition tail", "when a loan is approved and the moon is full, assign to wael");
crossCheck("unknown action phrase", "when a loan is approved, take it to the vet immediately");

/* ---- exit -------------------------------------------------------------------------- */

if (failures) {
  console.error(`\n${failures} clause assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll clause segmentation assertions passed.");
