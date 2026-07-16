# Developer Task: Phase 10 AI Model Upgrade (Gemini 3.5 & Phase 9 Alignment)

Target Branch: `feature/ai-model-upgrade-phase-10`

You are the Lead Developer. Your task is to upgrade the candidate model list to prioritize **Gemini 3.5** models, integrate Phase 9's new SLA delays and covenant vocabulary into the parser prompt, and create verification tests. Do NOT follow Codex; write clean, standalone TypeScript.

---

## 1. Upgrade Candidate Models List (`app/api/workflows/parse-ai/route.ts`)
Modify the `GEMINI_MODELS` array to prioritize the new Gemini 3.5 models:
- Prioritize `"gemini-3.5-flash"` and `"gemini-3.5-flash-lite"` right after the optional `GEMINI_MODEL` environment override.
- Ensure the candidate loop correctly falls through on model-level unavailability (404/429/503) and degrades to the heuristic parser if all models fail.

---

## 2. Update AI Parser Prompt Context (`app/api/workflows/parse-ai/route.ts`)
Refactor `buildSystemInstruction()` to teach the model about SLA delays and covenant review rules:
- **SLA Delay Parsing**:
  - Update system instructions to explain the `delayMinutes` field on action outputs.
  - Instruct the model to parse phrases like `"after 2 days"`, `"in 24 hours"`, or `"with a 3-day delay"` and map them to `delayMinutes` (e.g. `2 days` = `2880`, `24 hours` = `1440`, `3 days` = `4320`).
- **Few-Shot Examples**:
  - Add a few-shot example that demonstrates a rule containing an action with a delay (e.g. `"notify Wael after 2 days"`).
  - Add a few-shot example for a covenant review rule using the trigger `"SCHEDULED COVENANT REVIEW"` and checking covenant-related variables like `"days_since_financials_pulled"` (e.g. `days_since_financials_pulled > 90`).

---

## 3. Test Verification (`scripts/assert-ai-upgrade.ts`)
Create a new test file `scripts/assert-ai-upgrade.ts` containing the following tests:
- Verify that a rule output with a parsed delay (e.g. `"after 2 days"`) matches `delayMinutes: 2880` when processed (you can test this by importing parser utilities or testing the output formatting).
- Verify that a rule with a `"SCHEDULED COVENANT REVIEW"` trigger compiles successfully and maps variables correctly.
- Add `tsx scripts/assert-ai-upgrade.ts` to the `test` array command inside `package.json`.
- Run `npm run test` and `npm run build && npm run lint` to verify that everything compiles cleanly and all tests pass.
