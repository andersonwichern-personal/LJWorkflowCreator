# Prompt: Build Approval Authority Structure (Option A / Unified Tab)

**Instructions for Claude**: Read this file to execute the database and frontend build for the Approval Authority settings.

---

### Goal
We want to add the **Approval Authority Structure** to the website. This allows users to define the authority levels, monetary limits, and user assignments, which can then be dynamically used in the `THEN` rules actions (e.g., `THEN escalate to [Level]`).

Since the mock dashboard shell was removed, we will implement this as a clean, unified top-level tab toggle at the top of the main entry page:
`[ Rules Canvas | Approval Authorities ]`

---

### Step-by-Step Implementation Plan

#### 1. Add database schema (`prisma/schema.prisma`)
Add the `ApprovalAuthority` model to the schema:
```prisma
model ApprovalAuthority {
  id           String             @id @default(uuid())
  orgId        String             @map("org_id")
  name         String
  limit        Decimal            @db.Decimal(12, 2)
  userIds      Json               @map("user_ids") // List of user IDs/names assigned
  escalationId String?            @map("escalation_id")
  escalation   ApprovalAuthority? @relation("EscalationRelation", fields: [escalationId], references: [id], onDelete: SetNull)
  escalatedBy  ApprovalAuthority[] @relation("EscalationRelation")
  createdAt    DateTime           @default(now()) @map("created_at")
  updatedAt    DateTime           @updatedAt @map("updated_at")

  @@map("approval_authorities")
}
```
Run migrations:
```bash
npx prisma migrate dev --name add_approval_authorities_table
```
Append the standard Row Level Security (RLS) policies in the SQL file:
```sql
ALTER TABLE approval_authorities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow tenant-scoped access by org_id" ON approval_authorities
  FOR ALL USING (auth.jwt() ->> 'org_id' = org_id) WITH CHECK (auth.jwt() ->> 'org_id' = org_id);
```

#### 2. Create the Database Service (`lib/services/authority.ts`)
Implement `ApprovalAuthorityService` with standard CRUD operations scoped by `orgId`:
*   `listAuthorities(orgId: string)`
*   `createAuthority(orgId: string, data: { name: string, limit: number, userIds: string[], escalationId?: string })`
*   `updateAuthority(orgId: string, id: string, data: Partial<{ name: string, limit: number, userIds: string[], escalationId: string | null }>)`
*   `deleteAuthority(orgId: string, id: string)`

#### 3. Create API Route Handlers
*   **`app/api/platform/authorities/route.ts`**: Handle GET (list) and POST (create) requests.
*   **`app/api/platform/authorities/[id]/route.ts`**: Handle GET, PATCH (update), and DELETE requests.
*   Extract `orgId` from the request query parameters, defaulting to `"test-org-uuid-999"` for local testing.

#### 4. Build the UI Component (`components/ApprovalAuthorities.tsx`)
Create a premium, flat slate-themed interface:
*   **List/Table**: Display all authority levels, limits, members, and target escalation levels.
*   **Create/Edit drawer**: Click a row or a "Create Level" button to open a clean form to configure:
    *   Level Name (e.g. "Senior Underwriter").
    *   Approval Limit in dollars (e.g. `250000`).
    *   Users assigned (a list of checkboxes or multiselect matching the active user list).
    *   Escalation target (a dropdown of other authority levels).
*   Save changes to the database endpoints.

#### 5. Integrate into the Rules Canvas (`lib/vocabulary.ts`)
*   In `lib/vocabulary.ts`, update the `ACTIONS` configuration for `assign_authority`.
*   Ensure its `paramOptions` dynamically load the saved authority names from the database (via your API endpoint) and fall back to `["Loan Officer", "Credit Committee"]` if no database-backed options exist.

#### 6. Wire the Navigation Tabs (`app/page.tsx`)
In `app/page.tsx`, add a clean header navigation toggling between the two core components:
```tsx
"use client";
import { useState } from "react";
import WorkflowCreator from "@/components/WorkflowCreator";
import ApprovalAuthorities from "@/components/ApprovalAuthorities";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<"rules" | "authorities">("rules");

  return (
    <div className="min-h-screen">
      <header className="mx-auto max-w-[1240px] px-4 py-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-xl font-bold">LJ Decisioning Engine</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("rules")}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              activeTab === "rules" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            Rules Canvas
          </button>
          <button
            onClick={() => setActiveTab("authorities")}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              activeTab === "authorities" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            Approval Authorities
          </button>
        </div>
      </header>
      <main className="mt-6">
        {activeTab === "rules" ? <WorkflowCreator /> : <ApprovalAuthorities />}
      </main>
    </div>
  );
}
```

---

### Step-by-Step Instructions

1.  Add the Prisma model and run migration commands.
2.  Implement the database service, API routes, and components.
3.  Test compilation by running `npm run build` and `npm run lint`.
4.  Report back when the changes are ready to compile and merge!
