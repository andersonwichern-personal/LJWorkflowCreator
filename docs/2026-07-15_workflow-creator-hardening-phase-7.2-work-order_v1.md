# Work Order & Prompts — Phase 7.2: A/B Testing & Shadow splits

**Created**: 2026-07-15
**Branch Target**: `feature/ab-testing-phase-7.2` (derived from rule-analytics)

---

## 1. Objectives & Scope
Implement parallel version routing and split-testing metrics to let admins run two versions of a rule side-by-side:
1. **Rule JSON Schema Extension**: Add A/B split configuration controls.
2. **Evaluator Traffic Splitter**: Route requests proportionally using request ID hashes.
3. **Split UI Customizer**: Provide a percentage slider and target picker in the controls sidebar popover.

---

## 2. Tasks for Claude (Lead Coder)
1. **Schema Update**:
   - Update `WorkflowRule` controls schema in `lib/vocabulary.ts` to include:
     ```ts
     export interface RuleControls {
       mode: "shadow" | "armed";
       oncePerRequest?: boolean;
       maxFiresPerHour?: number;
       missingData?: "no_match" | "alert";
       abSplit?: {
         targetWorkflowId: string; // The peer version to split-test against
         weightPercent: number;    // e.g. 10 for 10% traffic to peer, 90 to current
       };
     }
     ```
2. **Evaluator Routing Logic**:
   - Update `app/api/workflows/simulate/route.ts` and evaluation wrappers.
   - If `abSplit` is configured, determine the branch using a deterministic hash of the `requestId` (to ensure the same request always falls down the same split path).
   - If the request falls to the target split branch:
     - Run evaluation against the peer `targetWorkflowId` rule.
     - Save the simulation/run trace with a marked label `routed: "ab-split"`.
3. **Controls Customizer UI**:
   - In `components/RuleSentence.tsx` inside the controls popover:
     - Add an **A/B Testing** toggle.
     - When active, render a dropdown containing other available workflows (exclude active one).
     - Render a numeric slider input for percentage weight (`10%`, `20%`, `50%`, etc.).
     - Persist `abSplit` properties on rule save.

---

## 3. Tasks for Codex (Supporting Autocomplete)
- Provide inline structures for:
  - Deterministic hash functions over strings (e.g., simple sum-of-characters modulo 100).
  - Slider controls matching the application's Tailwind palette and hover mechanics.
  - Dropdown listings querying available workflows excluding the active record.

---

## 4. Verification Plan
- Unit tests: Create `scripts/assert-ab-split.ts` asserting deterministic hashing and proportional split allocation over 100 simulated runs.
- Run compiles: `npm run build && npm run lint`.
