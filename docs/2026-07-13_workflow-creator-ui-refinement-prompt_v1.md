# Prompt: Workflow Creator UI & AI Refinements

**Instructions for Claude**: Read this file to catch up on the context, and execute the refinements described below.

---

### Production Software Stack & Architecture
Ensure all adjustments are fully compatible with our verified production stack:
*   **Version Control**: GitHub (private repository hosting and branch-driven Vercel previews)
*   **Front-End Hosting & CI/CD**: Vercel (production and preview pipeline)
*   **Database & RLS**: Supabase (Postgres 17 backend with Row Level Security and tenant-scoped auth policies)
*   **Domain & Gateways**: Cloudflare (SSL/Registrar and DNS proxying)
*   **Framework**: Next.js 15 (App Router with async context route params)
*   **ORM**: Prisma 7 (singleton client connection pooling using `@prisma/adapter-pg` and `pg`, credentials managed via `prisma.config.ts`)
*   **Styling**: Tailwind CSS v3 (custom theme tokens, responsive grids, and glassmorphic blur styles)

---

### Core UI & AI Refinement Goals

Please checkout the branch `feature/workflow-creator-ui-refinements` (branched from `feature/workflow-creator-ui`) and implement the following:

#### 1. AI Chat Box & Feedback System (Refining components/ChatBox.tsx)
*   **Interactive Prompts**: Add a set of clickable "quick-prompt" cards above the chat input (e.g., *"If booking has an error, assign to Wael"*, *"When offer is accepted, tag as Growmark"*). Clicking these should auto-fill the input box.
*   **Visual Parsing Output**: Improve the feedback display under the chat box. Render the extracted tokens (`event`, `conds`, `actions`) in a small, stylized log box using soft theme-matched colors to show the user exactly how the AI mapped their request before updating the canvas rules.
*   **Update-via-Chat Support**: Extend [lib/nlParser.ts](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/lib/nlParser.ts) to support updating/modifying the existing rule state rather than just replacing it from scratch.

#### 2. Token Picker Popover Polish (Refining components/TokenPicker.tsx)
*   **Search Filters**: Add search filtering inside pickers that have many options (like selecting condition fields or assignees).
*   **Interactive Helpers**: Show helper hints and descriptions for the selected event or field (using the `hint` and `blurb` metadata in [vocabulary.ts](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/lib/vocabulary.ts)) directly inside the picker, so the user knows what each token does.

#### 3. Save Indicators & State Tracking (Refining app/page.tsx)
*   **Dirty State Notice**: Display a clear, subtle warning notice next to the "Save" button if there are unsaved edits (e.g., *"Unsaved changes"* dot indicator).
*   **Optimistic Sidebar Updates**: Ensure toggling the workflow `enabled` state in the sidebar is processed optimistically, reverting the UI toggle state only if the `PATCH` API call fails.

#### 4. Design & Glassmorphism Review (Refining app/globals.css)
*   **Dark Mode Contrast**: Polish border styling for glassmorphic elements in dark mode to prevent visual clutter and improve card readability.
*   **Micro-Animations**: Add spring-like hover states to the condition logic toggle (`AND`/`OR`) and the save actions to make the editor feel premium and alive.

---

### Step-by-Step Instructions

1.  Checkout feature branch: `feature/workflow-creator-ui-refinements`.
2.  Refine the page layout, parser, and components under `components/` and `lib/`.
3.  Execute `npm run build` and `npm run lint` to verify compilation.
4.  Report your changes back to Antigravity (Gemini/Overseer) for final verification.
