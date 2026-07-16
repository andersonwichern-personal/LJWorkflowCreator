# Hardening Task Prompt: Phase 8 Trigger Correctness & Context-Aware Autocomplete

**Branch**: `feature/nlp-autocomplete-hardening-phase-8`

## Goal
Implement trigger disambiguation logic in `lib/nlParser.ts`, few-shot prompts in `app/api/workflows/parse-ai/route.ts`, and context-aware, fuzzy-matched sliding autocomplete windows in `components/ChatBox.tsx`. Do NOT follow Codex; write clean, standalone TypeScript.

---

## 1. NLP Trigger Disambiguation (lib/nlParser.ts)
Refactor `matchEvent()`:
* Explicitly match qualified phrases to events without raising trigger ambiguity prompt:
  - `"document upload is approved"` / `"document upload approved"` -> `DOCUMENT APPROVED`
  - `"document upload is rejected"` / `"document upload rejected"` -> `DOCUMENT REJECTED`
  - `"loan application is approved"` / `"loan application approved"` -> `LOAN APPROVED`
  - `"loan application is rejected"` / `"loan application rejected"` -> `LOAN REJECTED`
  - `"document checklist is complete"` / `"document checklist complete"` -> `CHECKLIST COMPLETED`
* Keep generic triggers ambiguous as required by base test specs:
  - `"When a document is approved..."` -> Flag ambiguity prompt ("Did you mean loan approval or document approval?").
  - `"When approved..."` -> Flag ambiguity prompt.

---

## 2. Dynamic context-aware Autocomplete (components/ChatBox.tsx)
* Import `fuzzyMatches` from `@/lib/fuzzy`.
* In `handleInputChange(text)`:
  - Identify context keyword tags:
    * Behind keyword `"when"` or `"whenever"` -> prioritize Events first.
    * Behind keyword `"if"`, `"where"`, `"and"`, `"or"` -> prioritize Fields.
    * Behind keyword `"assign"`, `"route"`, `"escalate"`, `"notify"`, `"to"` -> prioritize Assignees (Users & Teams).
  - Score candidates (Events, Fields, Assignees) by context priority.
  - Implement a sliding window of the last 1, 2, and 3 words to capture multi-word target matches (like "DOCUMENT APPROVED").
  - Match candidates using `fuzzyMatches` rather than flat substring matching.
* In `acceptSuggestion(suggestion)`:
  - Swap the matched 1-to-3 typed words window with the autocompleted option suffix.

---

## 3. Few-Shot System Prompt (app/api/workflows/parse-ai/route.ts)
Append 3 explicit input-to-JSON rule examples in `buildSystemInstruction()` (Nested splits, Else conditions, Assignee objects) to guide Gemini's schema output structure.

---

## 4. Test Verification
Create a test runner file `scripts/assert-nlp-parser.ts` to assert:
1. `"when a document upload is approved notify wael"` maps directly to trigger `DOCUMENT APPROVED` (no ambiguity).
2. `"when a loan application is rejected notify sarah"` maps directly to trigger `LOAN REJECTED` (no ambiguity).
3. `"when approved notify wael"` correctly flags a trigger ambiguity query.
Add this script to the `test` array command inside `package.json`.
