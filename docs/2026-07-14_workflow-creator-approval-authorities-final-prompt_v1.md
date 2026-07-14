# Prompt: Build Approval Authorities & Refine Vocabulary

**Instructions for Claude**: Read this file to implement the database, service layer, API handlers, and UI for the Approval Authorities, and to refine the Workflow Creator vocabulary.

---

### Redesign & Logic Specifications

1.  **UI Layout (Option B)**: Implement a clean tab header navigation at the top of the homepage (`app/page.tsx`) toggling between:
    *   **Rules Canvas** (`<WorkflowCreator />`)
    *   **Approval Authorities** (`<ApprovalAuthorities />`)
2.  **Approval Logic (Option C)**: Build the authority matrix mapping to **Amount + Risk Grade + Product** and supporting **Auto-Approval lanes**.
3.  **Vocabulary Refinements**: Expand inputs/actions in `lib/vocabulary.ts` per the live-system mapping document.

---

### Step-by-Step Instructions

#### Step 1: Database Additions
Add the `ApprovalAuthority` model to [schema.prisma](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/prisma/schema.prisma):
```prisma
model ApprovalAuthority {
  id           String             @id @default(uuid())
  orgId        String             @map("org_id")
  name         String
  limit        Decimal            @db.Decimal(12, 2)
  riskGrade    String             @map("risk_grade") // Minimum risk grade, e.g. "A", "B", "C", "D", "E"
  product      String             @map("product")    // "Term Loan" | "Line of Credit" | "All"
  userIds      Json               @map("user_ids")   // JSON array of user names/IDs assigned
  escalationId String?            @map("escalation_id")
  autoApprove  Boolean            @default(false)    @map("auto_approve")
  createdAt    DateTime           @default(now())    @map("created_at")
  updatedAt    DateTime           @updatedAt         @map("updated_at")

  escalation   ApprovalAuthority? @relation("EscalationRelation", fields: [escalationId], references: [id], onDelete: SetNull)
  escalatedBy  ApprovalAuthority[] @relation("EscalationRelation")

  @@map("approval_authorities")
}
```
Run migrations:
```bash
npx prisma migrate dev --name add_approval_authorities_table
```
And append the RLS setup inside the migration SQL:
```sql
ALTER TABLE approval_authorities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow tenant-scoped access by org_id" ON approval_authorities
  FOR ALL USING (auth.jwt() ->> 'org_id' = org_id) WITH CHECK (auth.jwt() ->> 'org_id' = org_id);
```

#### Step 2: Database Service & API Routes
*   Create `lib/services/authority.ts` with standard scoped CRUD operations (`listAuthorities`, `createAuthority`, `updateAuthority`, `deleteAuthority`).
*   Create route files under `app/api/platform/authorities/route.ts` and `app/api/platform/authorities/[id]/route.ts` to bridge the client calls to the service layer.

#### Step 3: Vocabulary Refinements
In [lib/vocabulary.ts](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/lib/vocabulary.ts), apply these updates:
*   **FIELDS**:
    *   Add `risk_grade` to `FIELDS` under the `Underwriting` group (`kind: "enum"`, options: `["A", "B", "C", "D", "E"]`).
    *   Add `intake_path` to `FIELDS` under the `Request` group (`kind: "enum"`, options: `["Intake Link", "Staff Wizard", "Blank Request"]`).
*   **ACTIONS**:
    *   Add `request_signature` (`paramKind: "text"`, `paramLabel: "signer role"`, blurb: `"Request document signatures from a specific party."`).
    *   Add `pull_credit` (`paramKind: "none"`, blurb: `"Trigger a credit pull for the applicant."`).
    *   Add `run_extraction` (`paramKind: "none"`, blurb: `"Execute AI-based document data extraction."`).
    *   Update `assign_authority`: set `"confidence": "verified"`, and change its blurb.
*   **Dynamic Loading**:
    *   In `WorkflowCreator.tsx`, fetch the dynamic authority list from `/api/platform/authorities` on mount.
    *   Update the `paramOptions` for `assign_authority` in `ACTIONS` dynamically using the fetched authority names.

#### Step 4: UI View Component (`components/ApprovalAuthorities.tsx`)
Create the tab view matching the flat, slate-neutral theme:
*   Display a table listing all configured authority levels (name, limit, min risk grade, product, auto-approve flag, assigned members, and target escalation level).
*   Add a "Create Level" button and click-to-edit drawer that slides open to modify all fields.
*   The drawer must display:
    *   Name (input field)
    *   Monetary Limit (numeric input field)
    *   Min Risk Grade (dropdown "A" through "E")
    *   Product (dropdown "All", "Term Loan", "Line of Credit")
    *   Is Auto-Approval Lane (checkbox/toggle)
    *   Escalation Level (dropdown of other configured levels)
    *   Assigned Users (checkbox list using `ASSIGNEES` from vocabulary)
*   Perform API calls to save, update, or delete records.

#### Step 5: Wire the Tab Navigation
Update [app/page.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/app/page.tsx) to render a header navigation bar toggling between **Rules Canvas** (`rules`) and **Approval Authorities** (`authorities`).

---

### Step-by-Step Execution

1.  Apply the schema and run migrations.
2.  Implement the database service, API routes, and components.
3.  Ensure compilation succeeds using `npm run build` and `npm run lint`.
4.  Report back when the changes are ready to compile and merge!
