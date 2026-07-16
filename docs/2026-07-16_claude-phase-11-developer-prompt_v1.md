# Developer Task: Phase 11 Instance Reference Hardening & ID Enforcement

Target Branch: `feature/id-enforcement-phase-11`

You are the Lead Developer. Your task is to update the rule linter and the AI parser route to strictly check assignee, template, stage, and retailer IDs, ensuring that no fabricated or mismatching IDs are allowed to pass. Do NOT follow Codex; write clean, standalone TypeScript.

---

## 1. Rule Linter Refactoring (`lib/ruleLinter.ts`)
*   Update `LintContext` to support array objects `{ id, label }` for `users`, `stages`, and `retailers` (while keeping backward compatibility for `string[]`).
*   Implement a `validateRef(value, registry, typeName, path, issues)` helper:
    *   If `value` is a legacy string, check if the label matches the registry. If it does, raise a `BROKEN_REF` warning to suggest upgrading. If it doesn't match, raise a `BROKEN_REF` error.
    *   If `value` is a category or instance ScopeRef, check if the ID (or label) exists in the registry. If not, raise a `BROKEN_REF` error.
*   Update `lintBrokenRefs` to call `validateRef` for:
    *   Condition leaves: `template` (registry `ctx.templates`), `stage` (registry `ctx.stages`), `retailer` (registry `ctx.retailers`), `team_member` (registry `ctx.users`).
    *   Actions/Else: `assign_user`/`notify` assignee (registry `ctx.users`), `assign_authority` target (registry `ctx.authorityIds`).
    *   Trigger scopes: template scope (registry `ctx.templates`).

---

## 2. Workflow Creator Context Update (`components/WorkflowCreator.tsx`)
*   Update `lintContext` (around L372) to map stage, user, and retailer instances into full `{ id, label }` objects from the live overlay, preserving static `ASSIGNEES` fallbacks.

---

## 3. AI Parser Hardening (`app/api/workflows/parse-ai/route.ts`)
*   Refactor the assignee ID check in `enforceKnownAssignees`:
    *   If live users are configured (some `u.id !== ""`), reject any assignee with a fabricated ID (mismatching `knownIds`).
    *   If live users are unconfigured (all `id === ""`), verify the label exists in `knownLower`, and coerce any non-empty ID to `""` to keep it clean.

---

## 4. Test Verification (`scripts/assert-id-enforcement.ts`)
*   Create a test script `scripts/assert-id-enforcement.ts` testing:
    *   A rule containing an instance ref with a fabricated ID triggers a `BROKEN_REF` linter error.
    *   A rule containing a legacy string user/stage triggers a `BROKEN_REF` warning to upgrade.
    *   The parser correctly rejects fabricated assignee IDs when live users are loaded, and coerces them to `""` when not loaded.
*   Wire the script into `package.json`'s `test` script.
*   Verify `npm run test` and `npm run build && npm run lint` pass successfully.
