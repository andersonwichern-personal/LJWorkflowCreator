# Prompt: Live Landjourney Integration Refinements

**Instructions for Claude**: Read this file and the integration surface at `2026-07-13_workflow-creator-live-integration-surface.md` to execute the code refinements described below.

---

### Context & Goal
To keep the proposal branch compatible with live Landjourney systems, we need to adapt the `rule_json` data structure. Instead of the simple mockup format `{ event, conds, outputs }`, we must transition to a versioned schema structured around:
`{ schemaVersion, trigger, conditions, actions }`

This avoids hard-coding schemas and allows us to store stable platform references (like template/field IDs) in production.

---

### File Changes Required

Please modify the codebase on the branch `feature/workflow-creator-ui` as follows:

#### 1. Update Service Schema Validation (`lib/services/workflow.ts`)
Update the `createWorkflow` and `updateWorkflow` methods to support both the legacy mockup schema and the new live-compatible versioned schema:
```ts
// In lib/services/workflow.ts:
const rule = data.ruleJson as any;
const isNewSchema = rule.schemaVersion !== undefined;

if (isNewSchema) {
  if (!rule.trigger?.event || !rule.conditions?.rules || !Array.isArray(rule.actions)) {
    throw new Error(
      "Invalid rule JSON structure (v2). Must contain 'schemaVersion', 'trigger.event', 'conditions.rules', and 'actions'."
    );
  }
} else {
  // Legacy fallback support
  if (!rule.event || !Array.isArray(rule.conds) || !Array.isArray(rule.outputs)) {
    throw new Error(
      "Invalid rule JSON structure. Must contain 'event', 'conds', and 'outputs'."
    );
  }
}
```

#### 2. Update Vocabulary Definitions (`lib/vocabulary.ts`)
*   Refine the `WorkflowRule` type definition to match the versioned schema:
    ```ts
    export interface WorkflowRule {
      schemaVersion: number;
      trigger: {
        event: string;
      };
      conditions: {
        logic: CondLogic;
        rules: RuleCondition[];
      };
      actions: RuleOutput[];
    }
    ```
*   Update vocabulary functions like `emptyRule()`, `ruleUsesUnconfirmed()`, and UI-description rendering to extract values from the new nested properties:
    *   Change `rule.event` references to `rule.trigger.event`.
    *   Change `rule.conds` references to `rule.conditions.rules`.
    *   Change `rule.outputs` references to `rule.actions`.
    *   Change `rule.condLogic` references to `rule.conditions.logic`.

#### 3. Update the Natural Language Parser (`lib/nlParser.ts`)
Modify the `parseInstruction` output to construct the new nested schema block:
```ts
return {
  rule: {
    schemaVersion: 2,
    trigger: { event: eventKey },
    conditions: {
      logic: condLogic,
      rules: conds,
    },
    actions: outputs,
  },
  notes,
};
```

#### 4. Update Frontend Components
Update any state interactions, render maps, and picker save handlers:
*   **`components/RuleSentence.tsx`**: Replace loops over `rule.conds` with `rule.conditions.rules`, and update output actions loop from `rule.outputs` to `rule.actions`.
*   **`app/page.tsx`**: Update validation checks (e.g. check `rule.actions.length === 0` instead of `rule.outputs.length === 0`). Add a helper `normalizeRule(json)` to format any legacy database rule JSONs into the new schema structure when loading from the API.

---

### Step-by-Step Instructions

1.  Read the live integration brief and modify the files detailed above.
2.  Run `npm run build` and `npm run lint` locally to make sure all TypeScript and Next.js interfaces are fully aligned.
3.  Let Gemini (Overseer) know when complete so we can verify the changes against the live database and push the stable build to `main`!
