import { parseInstruction } from "../lib/nlParser";
import { EVENTS } from "../lib/vocabulary";

console.log("Starting NLP Parser assertions...");

// Assertion 1: Document approval trigger maps without ambiguity
const res1 = parseInstruction("when a document upload is approved notify wael");
if (res1.rule?.triggers[0].event !== "DOCUMENT APPROVED") {
  console.error("Assertion 1 Failed: Expected trigger event to be DOCUMENT APPROVED, got:", res1.rule?.triggers[0].event);
  process.exit(1);
} else {
  console.log("PASS: Unambiguous document approval maps directly to DOCUMENT APPROVED.");
}

// Assertion 2: Loan rejection trigger maps without ambiguity
const res2 = parseInstruction("when a loan application is rejected notify sarah");
if (res2.rule?.triggers[0].event !== "LOAN REJECTED") {
  console.error("Assertion 2 Failed: Expected trigger event to be LOAN REJECTED, got:", res2.rule?.triggers[0].event);
  process.exit(1);
} else {
  console.log("PASS: Unambiguous loan rejection maps directly to LOAN REJECTED.");
}

// Assertion 3: Genuine trigger ambiguity is still caught and prompts the user
const res3 = parseInstruction("when approved assign to wael");
if (res3.ambiguities.length === 0) {
  console.error("Assertion 3 Failed: Expected ambiguity to be flagged for bare 'approved' input");
  process.exit(1);
} else {
  console.log("PASS: Ambiguity is flagged for bare approved event.");
}

console.log("All NLP Parser assertions passed successfully!");
process.exit(0);
