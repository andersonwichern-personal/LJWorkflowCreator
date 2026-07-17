// Rule-core regression coverage retained as a drift guard.
/**
 * Phase 8 §1 — trigger correctness.
 *
 * The tension this locks down: a QUALIFIED subject ("document upload …",
 * "loan application …") names its event outright and must never raise the
 * disambiguation prompt, while a BARE verb ("… is approved") still must, since
 * loan and document approval are both live readings.
 */

import { parseInstruction } from "../src/app/core/nlParser";

console.log("Starting NLP Parser assertions...");

let failures = 0;

/** A qualified phrase must resolve to exactly one event, with no prompt. */
function checkTrigger(instruction: string, expected: string) {
  const result = parseInstruction(instruction);
  const actual = result.rule?.triggers[0]?.event;
  if (actual === expected && result.ambiguities.length === 0) {
    console.log(`PASS: "${instruction}" → ${expected}`);
    return;
  }
  failures++;
  console.error(
    `FAIL: "${instruction}"\n  expected trigger ${expected} with no ambiguity` +
      `\n  actual trigger ${actual ?? "(none)"}, ambiguities: ${JSON.stringify(result.ambiguities)}`
  );
}

/** A bare/generic phrase must ask rather than guess (hardening N3). */
function checkAmbiguous(instruction: string) {
  const result = parseInstruction(instruction);
  if (result.ambiguities.length > 0 && result.rule === null) {
    console.log(`PASS: "${instruction}" → asks "${result.ambiguities[0].question}"`);
    return;
  }
  failures++;
  console.error(
    `FAIL: "${instruction}"\n  expected a trigger ambiguity prompt and no drafted rule` +
      `\n  actual rule: ${JSON.stringify(result.rule?.triggers)}`
  );
}

// Qualified subjects resolve directly — with and without the copula "is".
checkTrigger("when a document upload is approved notify wael", "DOCUMENT APPROVED");
checkTrigger("when a document upload approved notify wael", "DOCUMENT APPROVED");
checkTrigger("when a document upload is rejected notify wael", "DOCUMENT REJECTED");
checkTrigger("when a document upload rejected notify wael", "DOCUMENT REJECTED");
checkTrigger("when a loan application is approved notify wael", "LOAN APPROVED");
checkTrigger("when a loan application approved notify wael", "LOAN APPROVED");
checkTrigger("when a loan application is rejected notify sarah", "LOAN REJECTED");
checkTrigger("when a loan application rejected notify sarah", "LOAN REJECTED");
checkTrigger("when the document checklist is complete notify wael", "CHECKLIST COMPLETED");
checkTrigger("when the document checklist complete notify wael", "CHECKLIST COMPLETED");

// Generic subjects stay ambiguous: "document … approved" could be the document
// or the loan it belongs to, and a bare "approved" names no subject at all.
checkAmbiguous("when a document is approved notify wael");
checkAmbiguous("when approved notify wael");

if (failures) {
  console.error(`\n${failures} NLP Parser assertion(s) failed.`);
  process.exit(1);
}
console.log("All NLP Parser assertions passed successfully!");
process.exit(0);
