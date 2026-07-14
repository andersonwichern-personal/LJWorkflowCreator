# Prompt: Phase 2 — ScopeRef: category vs instance everywhere it matters

## Task Description
Implement **Phase 2 (ScopeRef: category vs instance)** of the Hardening Plan. You will introduce structured entity scoping (`ScopeRef`) across conditions, parameters, triggers, and stages. This eliminates free-text matching vulnerability (C1), stage name collisions (C7), assignee configuration drift (A4), and reference configuration rot (G2).

You MUST perform this work on a new git branch: `feature/hardening-phase-2`.

---

## 1. Types & Helper Library (`lib/vocabulary.ts`)
*   Introduce the `ScopeRef` type:
    ```ts
    export type ScopeRef =
      | { level: "any" }
      | { level: "category"; category: string }
      | { level: "instance"; id: string; label: string };
    ```
*   Widen parameter values: `RuleOutput.params` and `ConditionLeaf.value` must support `string | ScopeRef`.
*   Implement total helper functions (with fallback rendering tests):
    *   `scopeLabel(v: string | ScopeRef): string`
    *   `scopeInstanceId(v: string | ScopeRef): string | null`
    *   `isLegacyString(v: string | ScopeRef): v is string`
*   Update `displayValue`, `plainSummary`, and `describeAction` to correctly use `scopeLabel` without causing raw `[object Object]` rendering issues.

---

## 2. Token Scope Allocations
Apply the following scopes mapping (amended by `docs/2026-07-14_workflow-creator-edge-cases-and-error-handling_v1.md`):
1.  **condition `template`**: level `any` (default), level `category` (requestType), level `instance` (`LiveTemplate.id`).
2.  **condition `retailer`**: level `any`, level `instance` (`LiveOption.id` iam retailers).
3.  **condition `customer_name`**: level `any`, level `category` (Business/Individual), level `instance` (customer id - currently disabled with hint, fallbacks to category + text).
4.  **condition `stage` / action `change_stage`**: level `any`, level `category` (4 global stages), level `instance` (`templateId:stageId` from `LiveTemplate.stages`, rendered as `Template › Stage` to eliminate stage collisions).
5.  **condition `team_member` / params `assignee`, `notify recipient`**: level `category` (existing ASSIGNEES teams), level `instance` (`LiveOption.id` iam users).
6.  **`assign_authority` param**: level `instance` (`AuthorityRecord.id`).
7.  **trigger `scope`**: level `any` (default), level `instance` (template instance).

---

## 3. UI: Two-Step Value Picker
*   **TokenPicker.tsx**: Add `scoped?: { categories: PickerOption[]; instances: PickerOption[] }` to TokenPicker. Render three distinct categories: **Any** / **By Type** / **Specific**. Instanced items support filtering with the picker's type-to-search text box. Support `onSelectScope` callback.
*   **RuleSentence.tsx**: Integrate the scoped pickers for the scoped variables, fed by the `overlay` (live template/user listings) with static list fallback options.

---

## 4. Evaluation Semantics (`lib/ruleEvaluator.ts` & `lib/ruleEngine.ts`)
*   Implement `scopeMatches(v: string | ScopeRef, actualId: string | null, actualLabel: string): boolean`:
    *   Match on `id` when actualId is present (live request data).
    *   Fallback to case-insensitive exact match against `label` when actualId is absent (mock seed data).
*   Category levels compare against the request's category attribute (`requestType`, `custtype`, global stage).
*   `any` matches vacuously.
*   Update `resolveField` comparisons to route through `scopeMatches`.

---

## 5. Reference Audit API (`app/api/workflows/audit-refs/route.ts`)
*   Create a new on-demand endpoint `GET /api/workflows/audit-refs` for the active organization:
    *   Scan all workflows and their rule configurations (leaves, actions params, trigger scopes).
    *   Verify if references exist in the live/static registries.
    *   Return `{ workflowId, path, label, status: "ok" | "missing" | "legacy-unresolved" }` (where `legacy-unresolved` represents bare string values where an instance-shaped ref is now expected).
*   Add a visual "References" indicator/panel inside the Sidebar footer.

---

## 6. NL Parser & Tests
*   **lib/nlParser.ts**: Update the parser to output `ScopeRef` shapes for resolved names/stages/entities, and match category keywords (e.g. "any origination") to category scopes.
*   **Test Scripts**:
    *   Add `scripts/assert-tree.ts` and `scripts/assert-normalize.ts` changes verifying tree structure updates.
    *   Add validation scripts verifying the audit-refs endpoints.
    *   Ensure `npm run test` contains all assertions.
