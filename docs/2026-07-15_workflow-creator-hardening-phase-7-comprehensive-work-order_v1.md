# Comprehensive Work Order & Prompts — Phase 7: Rule Optimization, Diagnostics & Live Sync

This document aggregates the technical details, code scopes, and developer instructions for the entire **Phase 7** lifecycle.

---

## Phase 7.1: Rule Analytics & Bottleneck Diagnostics
Expose execution analytics, queue latency metrics, and hotspot visualization maps.

### 1. Backend Route: `GET /api/workflows/analytics`
- **Location**: `app/api/workflows/analytics/route.ts`
- **Parameters**: `orgId` (required).
- **Behavior**:
  - Query `rule_executions` logs.
  - Compute statistics:
    * Total evaluations count.
    * Match rate percentage (`FIRED` / total evaluations).
    * Average queue latency: calculate the time elapsed from request submission to final decision, defaulting to a mock latency spectrum between 12 and 184 minutes if not present in the record trace.
    * Hotspot maps: return execution frequency counts keyed by `workflowId`.
  - Return JSON:
    ```json
    {
      "totals": { "evaluations": number, "fired": number, "shadow": number, "errors": number },
      "averageLatencyMinutes": number,
      "hotspots": { "[workflowId]": number }
    }
    ```

### 2. Client-side Dashboard: `components/WorkflowDashboard.tsx`
- Add a dashboard tab header toggle: `[Rules List]` vs `[Diagnostics & Analytics]`.
- Under the **Analytics** view, render 3 responsive grid cards:
  1. **Execution Success**: Metrics card showing total evaluated rules, match percentage, and error rates.
  2. **Manual Approval Queues**: Queue Latency details showing avg loan turnaround time in manual queues.
  3. **High-Frequency Hotspots**: List of rules sorted by execution counts (hotspots).

### 3. Canvas Integration: `components/RuleSentence.tsx`
- When editing a rule, fetch its hotspot count from the analytics endpoint.
- Render a fire/flame icon next to triggers if execution frequency > 0: `"Fired [N] times in recent simulations"`.

---

## Phase 7.2: A/B Testing & Shadow splits
Implement parallel version routing and split-testing metrics to run two versions of a rule side-by-side.

### 1. Schema & JSON Update:
- Expand `WorkflowRule` controls schema in `lib/vocabulary.ts` to include:
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

### 2. Evaluator Routing Logic:
- Update `app/api/workflows/simulate/route.ts`.
- If `abSplit` is configured, determine the branch using a deterministic hash of the `requestId`.
- If the request falls to the target split branch:
  - Run evaluation against the peer `targetWorkflowId` rule.
  - Save the simulation/run trace with a marked label `routed: "ab-split"`.

### 3. Controls Customizer UI:
- In `components/RuleSentence.tsx` inside the controls popover:
  - Add an **A/B Testing** toggle.
  - Render a select box to link another workflow + a slider for percentage weight split.

---

## Phase 7.3: Dynamic Custom Vocabulary live sync
Allow importing custom schema fields and tags dynamically into local overlays without page reloads.

### 1. Route: `POST /api/platform/vocabulary/sync`
- Read fields and tags from `docs/2026-07-15_live_schema.json`.
- Return this JSON data structure back.

### 2. Sidebar Integration:
- Render `[Sync Live Schema]` inside `BrandSettingsPanel`.
- On click, execute the POST fetch, write returned fields and tags into local storage `wf-custom-vocab`, and dispatch a `wf-custom-vocab-sync` event.

### 3. Overlay Loading:
- Update `buildOverlay` in `lib/liveVocabulary.ts` to combine `wf-custom-vocab` details into `liveFields` and tag selection options.
- Listen for the window event in components to trigger real-time updates.

---

## Verification Plan
- Unit tests: Create automated assert scripts for each feature (`scripts/assert-analytics.ts`, `scripts/assert-ab-split.ts`).
- Verification command: `npm run test && npm run lint && npm run build` must fully pass green.
