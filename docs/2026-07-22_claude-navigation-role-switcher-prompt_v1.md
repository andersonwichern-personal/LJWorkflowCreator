# Prompt for Claude Code: Workflows Tab Navigation & Role Switcher Implementation

Copy and paste the following prompt into Claude Code:

```text
Please implement the following UI and feature requirements in the Angular Workflows application:

1. CONSOLIDATE LEFT RAIL & TOP TAB NAVIGATION:
   - In `src/app/app.html`, consolidate the left navigation rail so that "Workflows" is the primary hub item.
   - Beneath "Workflows" in the left panel, provide sub-navigation items:
     - Dashboard (`/dashboard`)
     - All Workflows (`/workflows`)
     - Reviews (`/workflows/proposals`)
     - Create / Propose Workflow (`/workflows/new`)
   - On the Workflows page views (`workflows-list.page.ts`, `proposals.page.ts`, `workflow-composer.page.ts`), include a visible top-level sub-navigation tab bar so users can easily switch between:
     - "Dashboard"
     - "All Workflows"
     - "Reviews" (with pending proposal count badge)
     - "Create / Propose Workflow"

2. DYNAMIC ROLE SWITCHER (Admin → Senior Manager → Junior Analyst):
   - In `src/app/core/user-session.service.ts`, implement a reactive `UserSessionService` that manages active user roles:
     - **Admin**: Full authority. Direct activation enabled, can approve/decline proposals.
     - **Senior Manager**: Managerial review authority. Can review proposals and draft workflows.
     - **Junior Analyst**: Maker drafting role. Direct activation is gated; all workflow creations or edits generate a proposal for review.
   - In `src/app/app.html` & `app.scss`, build an interactive Role Switcher dropdown pill in the left rail account bar allowing the user to select between Admin, Senior Manager, and Junior Analyst. Persist choice to `localStorage`.

3. PROPOSE A WORKFLOW SCHEME:
   - In `src/app/features/workflows/data/workflows.service.ts`, ensure `createProposal` is supported.
   - In `src/app/features/workflows/pages/workflow-composer.page.ts`, when logged in as Junior Analyst (or maker role), change the primary action button to **"Propose workflow ↗"**. Submitting creates a `WorkflowProposal` and redirects to the Reviews queue (`/workflows/proposals`).
   - In `src/app/features/workflows/pages/proposals.page.ts`, hide approval/decline decision buttons for Junior Analysts and show a `[ Awaiting Admin / Manager Review ]` badge instead.

4. VERIFY & BUILD:
   - Run `npm test` to ensure all fixpoint and UX tests pass.
   - Run `npm run build` to verify the production bundle builds without errors.
```
