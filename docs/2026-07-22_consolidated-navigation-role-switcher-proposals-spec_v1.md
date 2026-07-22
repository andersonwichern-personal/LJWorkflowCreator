# Technical Specification & Prompt: Navigation Consolidation, Role Switcher & Propose Workflow Scheme

**Date:** 2026-07-22  
**Target Execution Agent:** Claude Code (Hands-on Developer / CLI executor)  
**Architect & Overseer:** Gemini (Antigravity)  
**Target Repository:** `/Users/andersonwichern/Claude Files/Sweet Coding Work`  
**Spec Document:** `docs/2026-07-22_consolidated-navigation-role-switcher-proposals-spec_v1.md`  

---

## 1. Overview & Objective

Implement three interconnected UX and authorization capabilities in the Sweet Workflows Angular application:

1. **Navigation Consolidation**: Consolidate the left navigation rail under the primary **Workflows** hub, featuring collapsible/sub-item navigation (`Dashboard`, `All Workflows`, `Reviews`, `Create / Propose Workflow`) and an aligned top sub-navigation tab bar across all Workflows views.
2. **Dynamic Role Switcher**: Introduce a `UserSessionService` managing active user roles (**Admin**, **Senior Manager**, **Junior Analyst**) with an interactive role-switcher dropdown in the account rail, persisting state to `localStorage`.
3. **Propose Workflow Scheme (Maker-Checker)**: Wire role-based authorization into workflow creation and editing. When logged in as **Junior Analyst** (or maker role), direct activation is disabled and primary actions become **"Propose workflow"**, submitting changes directly to the **Reviews** queue for Admin/Manager sign-off.

---

## 2. Component Specifications & Requirements

### A. Role & Session Engine (`src/app/core/user-session.service.ts`)
Create a singleton Angular service `UserSessionService` with reactive signals:
- **Roles**:
  - `admin`: Full execution & approval authority (`canDirectlyActivate: true`, `canApproveProposals: true`, `mustProposeWorkflow: false`).
  - `senior-manager`: Review authority for analyst proposals (`canDirectlyActivate: true`, `canApproveProposals: true`, `mustProposeWorkflow: false`).
  - `junior-analyst`: Maker drafting role (`canDirectlyActivate: false`, `canApproveProposals: false`, `mustProposeWorkflow: true`).
- **Signal Seams**: Expose `activeRole`, `roleDef`, `canDirectlyActivate`, `canApproveProposals`, and `mustProposeWorkflow`.
- **Persistence**: Store and load `sweet_active_user_role` in `localStorage`.

### B. Shell & Rail UI (`src/app/app.html`, `src/app/app.ts`, `src/app/app.scss`)
- **Consolidated Navigation Rail**: Group `/dashboard`, `/workflows`, `/workflows/proposals`, and `/workflows/new` under the primary **Workflows** hub in `app.html` with a `.rail-subnav` list.
- **Role Switcher Widget**: Add `.role-switcher` pill and dropdown in `.rail-account`.
  - Displays current role badge tone (Primary / Info / Warn).
  - Toggles `.role-dropdown` allowing instant switching between Admin, Senior Manager, and Junior Analyst.

### C. Data Layer Seams (`src/app/features/workflows/data/workflows.service.ts`)
- Add `abstract createProposal(write: WorkflowWrite): Observable<SaveOutcome>` to `WorkflowsService`.
- Implement `createProposal` in `WorkflowsApiService` (`POST /rules/proposals`) and `WorkflowsMockService` (spawns pending proposal and returns `SaveOutcome`).

### D. Workflow Composer Integration (`src/app/features/workflows/pages/workflow-composer.page.ts`)
- Inject `UserSessionService`.
- Update submit button label:
  - If `session.mustProposeWorkflow()` is `true`: button renders **"Propose workflow ↗"**.
  - Else: renders **"Start observing ↗"**.
- Update `save()` method:
  - If `session.mustProposeWorkflow()`: invoke `this.service.createProposal(...)`, notify user ("*Workflow proposed! Submitted to review queue for Admin approval.*"), and navigate to `/workflows/proposals`.
  - Else: invoke `this.service.create(...)`.

### E. Reviews Queue Gating (`src/app/features/workflows/pages/proposals.page.ts`)
- Inject `UserSessionService`.
- If `session.canApproveProposals()` is `false` (Junior Analyst role): hide decision buttons (Approve / Decline) and display badge `[ Awaiting Admin / Manager Review ]`.

---

## 3. Verification & Compliance Checklist

After writing or updating components, run:
```bash
npm test         # Verify all 370 fixpoint + UX assertions pass
npm run build    # Verify production Angular bundle compiles cleanly
```

---

## Instructions for Claude

Read this specification and execute the implementation in the codebase:
1. Ensure `user-session.service.ts` is created and imported.
2. Update `app.html`, `app.ts`, and `app.scss` for the consolidated left rail and role switcher.
3. Update `workflows.service.ts`, `workflow-composer.page.ts`, and `proposals.page.ts`.
4. Run `npm test` and `npm run build` to confirm zero errors or regressions.
