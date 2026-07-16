# Specs: Phase 10 — AI Model Upgrade (Gemini 3.5 & Phase 9 Alignment)

**Date**: 2026-07-16
**Branch Target**: `feature/ai-model-upgrade-phase-10`
**Status**: DRAFT SPECIFICATION

---

## 1. Objectives & Scope
This phase upgrades the AI parser engine to leverage Google's latest **Gemini 3.5 Flash** models, while incorporating Phase 9's new domain vocabulary (SLA action delays and covenant review triggers) directly into the model's system context and few-shot examples.

Specifically, we will:
1. **Update Model Candidates**: Add `gemini-3.5-flash` and `gemini-3.5-flash-lite` to the candidate list in `app/api/workflows/parse-ai/route.ts` to prioritize the upgraded models.
2. **Promote Phase 9 Vocab in Prompt Context**: Include SLA delays (`delayMinutes`) and `SCHEDULED COVENANT REVIEW` (with its variables `compliance_status`, `covenant_type`, and `days_since_financials_pulled`) in the few-shot examples inside `buildSystemInstruction()`.
3. **Add Fallback / Retry Safety**: Ensure the model selection loop handles the new models cleanly and falls back gracefully to the heuristic parser if the API key is missing or calls fail.
4. **Create Verification Tests**: Create `scripts/assert-ai-upgrade.ts` to test schema generation for delays and covenant reviews.

---

## 2. Technical Specifications

### 2.1 Model Registry Update (`app/api/workflows/parse-ai/route.ts`)
Update `GEMINI_MODELS` to place `gemini-3.5-flash` and `gemini-3.5-flash-lite` at the front of the candidate array:
```ts
const GEMINI_MODELS = [
  ...(process.env.GEMINI_MODEL?.trim() ? [process.env.GEMINI_MODEL.trim()] : []),
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
];
```

### 2.2 System Prompt & Few-Shot Expansion
Update `buildSystemInstruction()` to teach the model how to parse delays and covenants:
* **SLA Delay parsing**: Teach it to parse expressions like `"notify Wael after 2 days"`, `"escalate to committee in 24 hours"`, or `"change stage to Rejected with 3 days delay"` and map them to the `delayMinutes` field on `RuleOutput` (e.g., `delayMinutes: 2880`, `delayMinutes: 1440`, `delayMinutes: 4320`).
* **Scheduled Covenant Triggers**: Add a few-shot example using `SCHEDULED COVENANT REVIEW` event trigger.
  - *Example prompt*: `"when a scheduled covenant review fires, if days since financials pulled is worse than 90 days, notify Omar"`
  - *Example parsed JSON*:
    ```json
    {
      "rule": {
        "schemaVersion": 3,
        "triggers": [{ "event": "SCHEDULED COVENANT REVIEW" }],
        "conditions": {
          "logic": "AND",
          "children": [
            { "field": "days_since_financials_pulled", "operator": "gt", "value": "90" }
          ]
        },
        "actions": [{ "action": "notify", "params": { "value": { "level": "instance", "id": "u-omar", "label": "Omar" } } }],
        "controls": { "mode": "shadow", "oncePerRequest": true, "maxFiresPerHour": 25, "missingData": "no_match", "priority": 100 }
      },
      "notes": ["Configured covenant review trigger.", "Added condition for financials pulled offset exceeding 90 days."],
      "suggestions": [],
      "unresolved": [],
      "uncovered": []
    }
    ```

---

## 3. Verification Plan
- Create `scripts/assert-ai-upgrade.ts` containing mock tests for the new parser behavior, verifying:
  - Natural language descriptions containing delay phrases correctly map to `delayMinutes`.
  - Covenant triggers and covenant variables are correctly parsed.
- Run `npm run test` to verify the whole suite (now 519+ assertions).
