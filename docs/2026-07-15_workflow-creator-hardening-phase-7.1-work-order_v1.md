# Work Order — Phase 7.1: Rule Analytics & Bottleneck Diagnostics

**Created**: 2026-07-15
**Branch**: `feature/rule-analytics-phase-7.1`
**Baseline commit**: `c0fbb09` (main — clean tree)

## 1. Objectives & Scope
Implement Phase 7.1 diagnostics to expose execution analytics, queue latency metrics, and hotspot visualization maps without requiring live connection streams:
1. **Analytics Dashboard Tab**: Create a sub-panel in `WorkflowDashboard` displaying execution success rates, auto-approval distribution, and average queue latency metrics.
2. **Rule Hotspot Visualizer**: Overlay rule execution volumes directly on the rules canvas/editor panel (`WorkflowCreator.tsx` / `RuleSentence.tsx`).
3. **Mock Data Seeding**: Feed analytics widgets using simulated histories under Data Tiers 1 and 2.

## 2. Technical Specs & File Locations

### 2.1 Backend route: `GET /api/workflows/analytics`
- **Location**: `app/api/workflows/analytics/route.ts`
- **Parameters**: `orgId` (required).
- **Behavior**:
  - Query `rule_executions` logs.
  - Compute statistics:
    * Total evaluations count.
    * Match rate percentage (`FIRED` / total evaluations).
    * Average queue latency: calculate the time elapsed from request submission (from `PlatformRequest.dateSubmitted` converted to time) to final decision, defaulting to a mock latency spectrum between 12 and 184 minutes.
    * Hotspot maps: return execution frequency counts keyed by `workflowId`.
  - Return JSON matching:
    ```json
    {
      "totals": { "evaluations": number, "fired": number, "shadow": number, "errors": number },
      "averageLatencyMinutes": number,
      "hotspots": { "[workflowId]": number }
    }
    ```

### 2.2 Client-side changes: `components/WorkflowDashboard.tsx`
- Add a dashboard tab header toggle: `[Rules List]` vs `[Analytics Dashboard]`.
- Under the **Analytics** view, render 3 responsive grid cards:
  1. **Execution Success**: Circle/ring widget or metrics card showing total evaluated rules, match percentage, and error rates.
  2. **Manual Approval Queues**: Queue Latency details showing avg loan turnaround time in manual queues.
  3. **High-Frequency Hotspots**: List of rules sorted by execution counts (hotspots).

### 2.3 Canvas integration: `components/WorkflowCreator.tsx` & `components/RuleSentence.tsx`
- When editing a rule, fetch its hotspot count from the analytics endpoint.
- Render a fire/flame icon next to triggers and actions if execution frequency > 0, showing: `"Fired [N] times in recent simulations"`.

## 3. Verification Plan
- Unit test: Create `scripts/assert-analytics.ts` asserting backend calculation correct.
- Verification command: `npm run test && npm run lint && npm run build` passes green.
