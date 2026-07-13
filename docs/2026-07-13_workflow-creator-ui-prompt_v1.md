# Prompt: Workflow Creator Frontend Scaffolding (Hybrid UI)

**Instructions for Claude**: Read this file to catch up on the context, and execute the implementation described below.

---

### Context & Progress So Far

Antigravity (Gemini/Overseer) has completed the backend and database scaffolding for the Workflow Creator:
1.  **Configuration**: Restored Next.js / Prisma base configuration files and updated `.env.local` to connect to the new greenfield Supabase project (`ref: xylgtegaukbzeutugdxw`, `region: us-east-2`).
2.  **Database**: Defined the `Workflow` model in [schema.prisma](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/prisma/schema.prisma) and applied migration `20260713182733_add_workflows_table`. This table enforces Row Level Security (RLS) and sets up a tenant-scoped policy (`auth.jwt() ->> 'org_id' = org_id`), with a mock for local shadow database compatibility.
3.  **Service**: Created the `WorkflowService` in [workflow.ts](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/lib/services/workflow.ts) which provides CRUD methods (`createWorkflow`, `getWorkflowById`, `listWorkflows`, `updateWorkflow`, `deleteWorkflow`, `toggleWorkflow`). Every by-ID CRUD operation strictly scopes queries by `orgId` to guarantee tenant isolation.
4.  **API Routes**: Created the route handlers at [route.ts](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/app/api/workflows/route.ts) (list and create) and [route.ts (dynamic)](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/app/api/workflows/[id]/route.ts) (get, update, delete) to bridge the frontend and service layers.
5.  **Validation**: A standalone test script successfully verified all database CRUD operations, and `npm run build` compiled with **zero lint or type errors**.

---

### Goal

Build out the Workflow Creator UI. Implement the hybrid design of Proposals 1 and 3 following the durable grounding in [2026-07-13_workflow-creator-foundation-brief.md](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/docs/2026-07-13_workflow-creator-foundation-brief.md).

Please load and apply the `/Users/andersonwichern/Claude Files/.agents/skills/landjourney-knowledge` skill before starting.

---

### Core Functional Requirements

1.  **Plain-English Rule Token Engine (Proposal 3 Skin)**
    *   Present rules as a readable sentence block: `WHEN [Event Token] IF [Condition Token(s)] THEN [Action Token(s)]`.
    *   Bracketed tokens must be styled interactively (colored pill buttons with transitions) and clickable.
    *   Clicking a token opens a popover or modal picker to edit it.
    *   Support multiple conditions linked by `AND` / `OR` logical operators.
2.  **Dynamic Specification Binding (Proposal 1 Spine)**
    *   The selected `WHEN` event must dynamically limit the condition fields and operators available. For instance, choosing the `SYSTEM ERROR` event should restrict options to relevant fields (like `bookstatus`), preventing invalid rule configs.
3.  **Verified Vocabulary Enforcement**
    *   Strictly implement Section 4 of the foundation brief:
        *   **Events**: `SYSTEM ERROR`, `LOAN APPROVED`, `LOAN REJECTED`, `OFFER ACCEPTED`, `FISERV LOAN`, `FMAC LOAN`.
        *   **Conditions**: `bookstatus` (Not Sent, In Flight, Sent, Confirmed, Error), `queue`, `uwstatus`, `retailer`, `stage`, etc.
        *   **Actions**: `assign_user` (NOT the fabricated `assign_authority`).
    *   Aspirational tokens must be gated or labeled as "unconfirmed" in the picker UI.
4.  **Integrated AI Chat Box (Proposal 3 Skin)**
    *   Add a chat input field.
    *   Allow users to write instructions (e.g. *"If there is a system error and bookstatus is Error, assign to Wael"*).
    *   Write a client-side parser to translate user input into the structured `WHEN/IF/THEN` JSON state.
5.  **Persistence Integration**
    *   Interface with `/api/workflows` to fetch, save, update, toggle, and delete workflows. Use a fixed tenant context for the demo (e.g., `orgId = "test-org-uuid-999"`).
    *   Provide a sidebar or dashboard list of saved workflows with an `enabled` toggle switch.
6.  **Premium Aesthetics & Design**
    *   Style with TailwindCSS. Use sleek dark/light mode accents, glassmorphic panels, soft animations, and refined typography.
    *   Do not use placeholder images or elements.

---

### Step-by-Step Instructions

1.  Checkout feature branch: `feature/workflow-creator-ui`.
2.  Remove/overwrite old page logic and implement the designer canvas in `app/page.tsx`.
3.  Ensure state syncs with the Supabase API endpoints.
4.  Run `npm run build` and `npm run lint` to verify clean compilation.
5.  Keep this branch unmerged. Report your changes to Antigravity (Gemini/Overseer) for review.
