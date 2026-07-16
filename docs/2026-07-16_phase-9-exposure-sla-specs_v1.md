# Work Order & Prompts — Phase 9: Aggregate Exposure & SLA Covenant Schedules

**Created**: 2026-07-16
**Branch Target**: `feature/exposure-sla-phase-9`

---

## 1. Objectives & Scope
This phase transitions the system into real-world banking operations by implementing:
1. **Aggregate Exposure Calculation**: Query and summarize total outstanding exposure across connected borrower entities.
2. **SLA & SLA Delay Actions**: Schedule post-execution tasks and timers (e.g. notify loan officer after 48 hours if status remains unchanged).
3. **Covenant & SLA Scheduled Triggers**: Support time-based triggers like recurring covenant reviews.

---

## 2. Tasks for Claude (Lead Coder)

### 2.1 Aggregate Exposure (lib/services/exposure.ts)
- Implement `calculateAggregateExposure(customerId: string): Promise<number>`:
  - Traverse the `customer_relationships` graph to find connected entities.
  - Query current requests and active loans for the customer and all connected entities.
  - Summarize total loan amounts and active lines of credit to return the total aggregate dollar exposure.
- Wire this helper into the evaluation pipeline in `lib/ruleEvaluator.ts` so rules can assert constraints like: `IF aggregate_exposure > $500,000 THEN escalate_to_committee`.

### 2.2 SLA & Timer Schedules (components/RuleSentence.tsx & lib/vocabulary.ts)
- Widen the rule schema to support timer-based delays in action execution:
  ```ts
  export interface RuleOutput {
    action: string;
    params: Record<string, any>;
    delayMinutes?: number; // Null or 0 means execute instantly
  }
  ```
- In `RuleSentence.tsx`, inside action lanes, render a tiny clock icon button. Clicking it allows setting a delay duration (e.g. `24 hours`, `3 days`) which saves as `delayMinutes` on the action parameters.

### 2.3 Covenant Recurring Triggers (lib/vocabulary.ts)
- Add a new Trigger definition: `SCHEDULED COVENANT REVIEW`.
- Add condition fields specific to covenant checks: `days_since_financials_pulled`, `covenant_type`, `compliance_status`.

---

## 3. Tasks for Codex (Supporting Autocomplete)
- Autocomplete React elements for inputting delays in actions:
  - Form inputs parsing durations (hours, days) into numeric minutes.
  - Dropdown options matching covenant check types.

---

## 4. Verification Plan
- Unit tests: Create `scripts/assert-exposure.ts` to build a mock customer relationship tree, query its exposure, and assert correctness.
- Automated pipeline validation: `npm run test && npm run lint && npm run build` must compile clean.
