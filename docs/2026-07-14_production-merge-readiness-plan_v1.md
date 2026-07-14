# Production Merge Readiness & Cleanup Plan

This document outlines the analysis of our codebase structure, identifies elements that will conflict when merging this proposal branch into the real Landjourney codebase, and details the steps we have taken to cleanly isolate the Workflow Creator.

---

## 1. Conflict Analysis: The "Demo Clutter"

The proposal branch was structured as a full portal mockup so the client could experience how the Workflow Creator connects visually to the rest of the application. However, the real Landjourney codebase already contains its own production versions of these pages and layouts.

The following directories and files will directly conflict or clutter the codebase during a production merge:

### A. Conflicting App Routes (To Be Removed)
These routes replicate pages that already exist in the live Landjourney console. If merged, they would overwrite production code:
*   `app/requests/` (and its nested detail views `/requests/[id]`)
*   `app/loans/`
*   `app/offers/`
*   `app/underwriting/`
*   `app/customers/`
*   `app/booking-events/`
*   `app/system-events/`
*   `app/settings/`
*   `app/templates/`
*   `app/insights/`
*   `app/intake-links/`

### B. Conflicting Dashboard Layouts & Utilities (To Be Removed)
*   `components/shell/` (AppShell, CommandPalette, and navigation layout)
*   `components/DemoTour.tsx` (Mock walkthrough guide)
*   `components/CreateRequestWizard.tsx` (Mock intake form wizard)
*   `components/RequestDetail.tsx` (Mock request overview)
*   `components/WorkflowActivity.tsx` (Mock run logs)

---

## 2. Core Workflow Creator Components (To Be Retained)

The following files represent the actual feature implementation and must be preserved:
*   **Database Schema**: `prisma/schema.prisma` (only the `Workflow` model and its corresponding RLS migration).
*   **Database Service**: [workflow.ts](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/lib/services/workflow.ts) (`WorkflowService` for tenant-scoped operations).
*   **API Boundary**: [route.ts](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/app/api/workflows/route.ts) and dynamic handler [route.ts](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/app/api/workflows/[id]/route.ts).
*   **Workflow Canvas UI**:
    *   [WorkflowCreator.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/WorkflowCreator.tsx) (Main studio component)
    *   [RuleSentence.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/RuleSentence.tsx) (Pill tokens and sentence builder)
    *   [TokenPicker.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/TokenPicker.tsx) (Dynamic constraint popovers)
    *   [WorkflowSidebar.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/WorkflowSidebar.tsx) (Saved rules navigation sidebar)
    *   [ChatBox.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/ChatBox.tsx) (AI command input panel)
    *   [Toggle.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/Toggle.tsx) & [ThemeToggle.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/ThemeToggle.tsx)
*   **Workflow Core Logic**:
    *   [vocabulary.ts](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/lib/vocabulary.ts) (Event, Condition, and Action dictionary)
    *   [nlParser.ts](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/lib/nlParser.ts) (Deterministic natural-language sentence compiler)
    *   [api.ts](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/lib/api.ts) (Frontend Client fetch wrappers)

---

## 3. Improvements for Production Integration

To move from this clean isolated skeleton to the live production branch, implement the following steps:

1.  **Switch Context from Query Params to Sessions**:
    *   *Current*: API routes read `const orgId = searchParams.get("orgId")`.
    *   *Production*: Read the authenticated tenant session directly from the Supabase auth context:
        ```ts
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        const orgId = session?.user?.user_metadata?.org_id;
        ```
2.  **Bind Dropdowns to Live Platform API Lookup endpoints**:
    *   *Current*: The list of assignees, letter templates, and retailers are static arrays in `lib/vocabulary.ts`.
    *   *Production*: Replace these static lists with live HTTP fetches targeting your existing endpoints (e.g., `GET /api/settings/users`).
3.  **Mount the Page Directly**:
    *   Instead of wrapping it in the custom mock shell, the `WorkflowCreator` component is self-contained. In production, you will simply import it and drop it directly into your existing dashboard container layout.
