# Specs: Phase 11 — Instance Reference Hardening & ID Enforcement

**Date**: 2026-07-16
**Branch Target**: `feature/id-enforcement-phase-11`
**Status**: APPROVED SPECIFICATION

---

## 1. Objectives & Scope
This phase hardens assignee and condition value validation by closing reference-checking loopholes. It ensures all template, stage, retailer, and user instance references resolve to valid database IDs when live vocabulary is configured, while allowing legacy strings to warning-degrade rather than fail.

Specifically:
1. **Rule Linter Updates**:
   - Update `LintContext` in `lib/ruleLinter.ts` to accept object registries `{ id, label }` for `users`, `stages`, and `retailers` (backward-compatible with string arrays).
   - Refactor `lintBrokenRefs` to validate scoped instance references against their IDs.
   - If an `instance` level ScopeRef ID does not exist in the registry, raise a blocking `BROKEN_REF` error.
   - If a legacy string matches a label, raise a `BROKEN_REF` warning to suggest upgrading to an ID-bound ref.
2. **Workflow Creator Context**:
   - In `components/WorkflowCreator.tsx`, populate the `lintContext` with full `{ id, label }` arrays for stages, users, and retailers from the live overlay.
3. **AI Route Handler Hardening**:
   - In `app/api/workflows/parse-ai/route.ts`, update `enforceKnownAssignees` to strictly reject fabricated assignee IDs when live users are configured.
   - If live users are unconfigured (fallback mode), coerce any non-empty fabricated assignee ID to `""` to align with the local schema.
4. **Verification Tests**:
   - Create `scripts/assert-id-enforcement.ts` verifying all the linter error/warning rules and parser ID checks.
   - Wire this file into the `test` command in `package.json`.

---

## 2. Technical Specifications

### 2.1 Linter Updates (`lib/ruleLinter.ts`)
Update `LintContext`:
```ts
export interface LintContext {
  peers?: { id: string; name: string; rule: WorkflowRule; enabled: boolean }[];
  stages?: Array<string | { id: string; label: string }>;
  users?: Array<string | { id: string; label: string }>;
  templates?: string[];
  retailers?: Array<string | { id: string; label: string }>;
  authorityIds?: string[];
  liveFieldKeys?: string[];
}
```

Implement `validateRef` helper:
```ts
function validateRef(
  value: string | ScopeRef | undefined,
  registry: Array<string | { id: string; label: string }> | undefined,
  typeName: string,
  path: string,
  issues: RuleIssue[]
) {
  if (value == null) return;
  if (!registry || registry.length === 0) return;

  const hasId = (id: string) =>
    registry.some((item) =>
      typeof item === "string" ? item === id : item.id === id
    );

  const hasLabel = (lbl: string) =>
    registry.some((item) =>
      typeof item === "string"
        ? item.toLowerCase() === lbl.toLowerCase()
        : item.label.toLowerCase() === lbl.toLowerCase()
    );

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return;
    const isIdRegistry = typeName === "Template" || typeName === "Authority Target";
    if (isIdRegistry) {
      if (!hasId(trimmed)) {
        push(issues, "error", "BROKEN_REF", `"${trimmed}" is not a known ${typeName}.`, path);
      }
    } else {
      if (!hasLabel(trimmed)) {
        push(issues, "error", "BROKEN_REF", `"${trimmed}" is not a known ${typeName}.`, path);
      } else {
        push(
          issues,
          "warning",
          "BROKEN_REF",
          `"${trimmed}" is a legacy text reference. Consider re-selecting it to upgrade to an ID-bound reference.`,
          path
        );
      }
    }
  } else if (value.level === "instance") {
    if (value.id) {
      if (!hasId(value.id)) {
        push(issues, "error", "BROKEN_REF", `${typeName} ID "${value.id}" (${value.label}) is not known.`, path);
      }
    } else if (value.label) {
      if (!hasLabel(value.label)) {
        push(issues, "error", "BROKEN_REF", `"${value.label}" is not a known ${typeName}.`, path);
      }
    }
  } else if (value.level === "category") {
    if (value.category && !hasLabel(value.category)) {
      push(issues, "error", "BROKEN_REF", `Category "${value.category}" is not a known ${typeName}.`, path);
    }
  }
}
```

Update `lintBrokenRefs` to delegate validation of condition leaves (`template`, `stage`, `retailer`, `team_member`) and actions/else params (`assign_user`, `notify`, `assign_authority`) to `validateRef`.

### 2.2 Workflow Creator Updates (`components/WorkflowCreator.tsx`)
Supply `{ id, label }` arrays to the linter context for stages, users, and retailers:
```ts
const lintContext = useMemo<LintContext>(
  () => ({
    users: [
      ...ASSIGNEES.map((label) => ({ id: "", label })),
      ...(overlay?.instances.users ?? [])
    ],
    templates: overlay?.instances.templates?.map((t) => t.id) ?? [],
    stages: overlay?.instances.stages?.map((s) => ({ id: s.id, label: s.label })) ?? [],
    retailers: overlay?.instances.retailers?.map((r) => ({ id: r.id, label: r.label })) ?? [],
    authorityIds: authorities.map((a) => a.id),
    liveFieldKeys: overlay?.liveFields?.map((f) => f.fieldId) ?? [],
    peers: workflows
      .filter((w) => w.id !== activeId)
      .map((w) => ({ id: w.id, name: w.name, rule: normalizeRule(w.ruleJson), enabled: w.enabled })),
  }),
  [overlay, authorities, workflows, activeId]
);
```

### 2.3 AI route parsing (`app/api/workflows/parse-ai/route.ts`)
Update `enforceKnownAssignees` to check for live configurations:
```ts
} else if (value.level === "instance") {
  const liveUsersConfigured = context.users.some((u) => u.id !== "");
  if (liveUsersConfigured) {
    if (!knownIds.has(value.id)) {
      heard = value.label;
    }
  } else {
    if (!knownLower.has(value.label.trim().toLowerCase())) {
      heard = value.label;
    } else if (value.id !== "") {
      value.id = "";
    }
  }
}
```

---

## 3. Verification Plan
- Create `scripts/assert-id-enforcement.ts` with assertions verifying:
  - Rules with invalid instance IDs produce `BROKEN_REF` errors.
  - Rules with legacy string values matching valid labels produce `BROKEN_REF` warnings.
  - Parser rejects fabricated assignee IDs when live users are loaded.
  - Parser coerces fabricated assignee IDs to `""` when live users are not loaded.
- Run `npm run test` (which executes all test scripts).
