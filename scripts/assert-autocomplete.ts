/**
 * Phase 8 §2 — context-aware composer completion.
 *
 * Guards the three properties the feature is actually made of: the nearest
 * keyword picks the bucket, the sliding window captures multi-word targets, and
 * accepting a completion edits only the words it matched.
 */

import { applyCompletion, buildCandidates, contextKind, suggestCompletions } from "../lib/autocomplete";

console.log("Starting autocomplete assertions...");

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

/* -- Context: the NEAREST keyword behind the caret wins --------------------- */
// The regression this locks down: an opening "when" used to capture the whole
// sentence, so "…approved notify wa" ranked events ahead of people.
check("context: 'when' opens an event", contextKind("when a document upl"), "event");
check("context: 'notify' after a 'when' clause wins", contextKind("when a loan is approved notify wa"), "assignee");
check("context: 'and' after a 'when' clause wins", contextKind("when a loan is approved and risk gra"), "field");
check("context: 'to' wins over an earlier 'whenever'", contextKind("whenever an offer is accepted escalate to und"), "assignee");
check("context: no keyword yet", contextKind("loan amo"), null);

/* -- Candidates ------------------------------------------------------------- */
// buildOverlay() leaves instances.users empty unless the platform is
// configured, so the demo roster must still complete with a null overlay.
const candidates = buildCandidates(null);
const wael = candidates.find((c) => c.value === "Wael");
check("candidates: static demo people are assignees", wael, { value: "Wael", kind: "assignee" });
check(
  "candidates: teams are assignees",
  candidates.find((c) => c.value === "Booking Team")?.kind,
  "assignee"
);
check(
  "candidates: events are deduped across key/label",
  candidates.filter((c) => c.value === "DOCUMENT APPROVED").length,
  1
);

/* -- Sliding window --------------------------------------------------------- */
const multiWord = suggestCompletions("when a document appro", candidates);
check("window: multi-word target wins over the 1-word window", multiWord[0]?.value, "DOCUMENT APPROVED");
check("window: it reports the 2-word window it matched", multiWord[0]?.windowSize, 2);

/* -- Fuzzy, not substring --------------------------------------------------- */
const typo = suggestCompletions("notify waell", candidates);
check("fuzzy: a typo still completes", typo[0]?.value, "Wael");

/* -- Context priority decides between equally good matches ------------------ */
// "boo" substring-matches both the "Booking Team" assignee and the "booking
// status" field; behind "notify" the person must come first.
const contextual = suggestCompletions("when a loan is approved notify boo", candidates);
check("priority: 'notify boo' offers the team before the field", contextual[0]?.value, "Booking Team");

/* -- Accepting a completion ------------------------------------------------- */
// Commas are clause boundaries to nlParser, so the untouched prefix must
// survive byte-for-byte.
check(
  "accept: the prefix (and its comma) is preserved",
  applyCompletion("When a loan is approved, notify wae", { value: "Wael", kind: "assignee", windowSize: 1 }),
  "When a loan is approved, notify Wael "
);
check(
  "accept: a 2-word window is swapped whole",
  applyCompletion("when a document appro", { value: "DOCUMENT APPROVED", kind: "event", windowSize: 2 }),
  "when a DOCUMENT APPROVED "
);

/* -- Quiet until there is something to complete ----------------------------- */
check("quiet: a 1-char query offers nothing", suggestCompletions("w", candidates).length, 0);

if (failures) {
  console.error(`\n${failures} autocomplete assertion(s) failed.`);
  process.exit(1);
}
console.log("All autocomplete assertions passed successfully!");
process.exit(0);
