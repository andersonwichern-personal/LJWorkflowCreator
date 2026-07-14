# Prompt: Phase 1 — Schema v3 (triggers[], recursive groups, otherwise, controls)

## Task Description
Implement **Phase 1 (Schema v3)** of the Hardening Plan. You will upgrade the rule schema and evaluation engine of the Workflow Creator from version 2 to 3, introducing nested condition groups (AND/OR trees), multiple triggers per rule, an `Otherwise` (else) execution path, and safety-control parameters (shadow/armed, idempotency scoping, fire limits).

In addition, you MUST read and integrate the design choices and amendments specified in [docs/2026-07-14_workflow-creator-edge-cases-and-error-handling_v1.md](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/docs/2026-07-14_workflow-creator-edge-cases-and-error-handling_v1.md) that apply to Phase 1 (most notably Amendment 1, which expands the `oncePerRequest` control's deduplication mechanism to support request lifecycle generations and audit trail scans).

You MUST perform this work on a new git branch: `feature/hardening-phase-1`.

---

## 1. Schema Upgrades & Normalization (`lib/vocabulary.ts`)
*   Bump `RULE_SCHEMA_VERSION = 3`.
*   Upgrade `normalizeRule(raw: any): WorkflowRule` to translate legacy shapes to v3:
    *   **v3 shape**: `triggers: [{event: string}]`, `conditions: {logic: "AND" | "OR", children: ConditionNode[]}`, `actions: RuleOutput[]`, `else?: RuleOutput[]`, `controls: RuleControls`.
    *   **v2 conversion**: `{trigger: {event}, conditions: {rules}, actions}` maps to `triggers: [{event}]`, `conditions: {logic: "AND", children: rules}`, `actions`, and default controls.
    *   **v1 conversion**: `{event, conds, outputs}` maps to v2 first, then v3.
    *   *Rule Controls Defaults*: `mode: "shadow"`, `oncePerRequest: true`, `maxFiresPerHour: 25`, `missingData: "no_match"`, `priority: 100`.
*   Implement `walkLeaves(group: ConditionGroup): ConditionLeaf[]` to recursively collect leaf conditions.
*   Update `allowedFieldsForTriggers(events: string[]): FieldDef[]` to compute the intersection of available attributes across all selected triggers. Form-field triggers survive only if *all* triggers allow them (`allowsFormFields: true`).

---

## 2. Rule Validation (`lib/ruleValidation.ts`)
Create a single module exporting:
```ts
export interface RuleIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
}
export function validateRule(raw: unknown): { rule: WorkflowRule | null; issues: RuleIssue[] }
```
*   **Errors (block save)**: Schema version mismatch, empty triggers, unknown events, nested group depth > 4, unknown condition fields, invalid operators, non-numeric values in numeric fields, unknown action type, empty actions list *when* `mode === "armed"`, `maxFiresPerHour < 1`.
*   **Warnings (allowed, reported in UI)**: Unconfirmed vocabulary items, form fields mismatched with triggers, empty `else` list, group depth > 2 (violates UI limit).
*   **Prisma Service Hook**: Integrate `validateRule` into `lib/services/workflow.ts` within `createWorkflow` and `updateWorkflow` to validate rules before database execution. Throw errors immediately.

---

## 3. Tree Operators (`lib/conditionTree.ts`)
Implement pure tree manipulation functions for recursive condition structures using index-path arrays (e.g. `[0, 1]` for the 2nd child of the 1st group):
*   `addLeaf(root, path, leaf)`
*   `addGroup(root, path, group)`
*   `updateLeaf(root, path, leaf)`
*   `removeNode(root, path)`
Ensure all operations return new immutably updated tree structures (no in-place mutations).

---

## 4. Evaluator Updates (`lib/ruleEvaluator.ts` & `lib/ruleEngine.ts`)
*   **Group Recursion**: Evaluate nested `ConditionGroup`s recursively (AND resolves false if any child fails; OR resolves true if any matches). Flattens traces including a `depth` variable for indented UI rendering.
*   **Multi-Trigger Evaluation**: Evaluate matches if `rule.triggers.some(t => requestMatchesEvent(request, t.event))`.
*   **Alerting**: If `missingData` is `"alert"` and a field evaluates to null (exempting empty check operators), set `trace.alerts` and match as `false` (fail-closed).
*   **Else Actions**: Evaluate `else` actions when at least one trigger matches but the conditions fail.
*   **Re-routing**: Direct all workflow-for-event evaluation queries from `lib/ruleEngine.ts` to `lib/ruleEvaluator.ts`.

---

## 5. Parser Upgrades (`lib/nlParser.ts`)
*   Ensure the natural language parser outputs valid v3 rules (triggers list, root condition group, controls defaults).

---

## 6. UI Updates
*   **RuleSentence.tsx**:
    *   Triggers: Render dynamic list of pills joined by `or` chips, with `+ or event` action.
    *   Groups: Render child groups inline using bordered layouts: `( leaf OP leaf )` with group toggle buttons. Use `conditionTree.ts` to mutate state.
    *   Otherwise: Add collapsible section mapping `rule.else` actions.
    *   Controls: Popover panel with fields for controls parameters (Shadow/Armed toggle, priority numbers, etc.).
*   **WorkflowCreator.tsx**: Append `[shadow]` indicator or plain summaries. Allow empty actions for rules in shadow mode.
*   **WorkflowSidebar.tsx**: Render a toggle state badge showing `shadow` vs. `armed`.

---

## 7. Verification Tests
Add the following files in `scripts/`:
*   `scripts/assert-normalize.ts`: Assert v1/v2/v3 structures normalize to valid v3 shapes.
*   `scripts/assert-validation.ts`: Verify validator logs all error and warning codes.
*   `scripts/assert-tree.ts`: Test immutable tree manipulation paths.

Configure tests in `package.json`:
`"test": "tsx scripts/assert-parser.ts && tsx scripts/assert-operators.ts && tsx scripts/assert-normalize.ts && tsx scripts/assert-validation.ts && tsx scripts/assert-tree.ts"`

Ensure all tests pass and a production build compiles cleanly:
```bash
git checkout -b feature/hardening-phase-1
npm run test
npm run build && npm run lint
```
