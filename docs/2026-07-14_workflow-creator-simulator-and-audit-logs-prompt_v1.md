# Prompt: Build Live Simulator & Rule Execution Audit Logs

**Instructions for Claude**: Read this file to implement the database schemas, services, API routes, and front-end components for the Live Request Simulator and Execution History Audit Logs.

---

### Goals
1.  **Rule Execution Audit Log**: Persist every rule evaluation outcome (match success, fail, error, trace parameters) to the database under `RuleExecution`.
2.  **Live Request Simulator**: Let users search for requests, run a dry-run evaluation on the active canvas rule, and view a colored matching trace.
3.  **UI Integration**: Add a third sub-tab navigation option: `[ Rules Canvas | Approval Authorities | Audit Logs ]`.

---

### Step-by-Step Implementation Instructions

#### 1. Database Schema Additions
In [schema.prisma](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/prisma/schema.prisma):
*   Add the `RuleExecution` model:
    ```prisma
    model RuleExecution {
      id                String             @id @default(uuid())
      orgId             String             @map("org_id")
      workflowId        String             @map("workflow_id")
      requestId         String             @map("request_id")
      requestName       String             @map("request_name")
      eventName         String             @map("event_name")
      status            String             // "FIRED" | "CONDITIONS_NOT_MET" | "ERROR"
      evaluationTrace   Json               @map("evaluation_trace")
      actionsDispatched Json               @map("actions_dispatched")
      createdAt         DateTime           @default(now()) @map("created_at")

      workflow          Workflow           @relation(fields: [workflowId], references: [id], onDelete: Cascade)

      @@index([orgId, requestId])
      @@map("rule_executions")
    }
    ```
*   Add `executions RuleExecution[]` relation inside the `Workflow` model.
*   Run the migrations and apply Row Level Security (RLS) policies:
    ```bash
    npx prisma migrate dev --name add_rule_executions_table
    ```
    ```sql
    ALTER TABLE rule_executions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Allow tenant-scoped access by org_id" ON rule_executions
      FOR ALL USING (auth.jwt() ->> 'org_id' = org_id) WITH CHECK (auth.jwt() ->> 'org_id' = org_id);
    ```

#### 2. Create the Evaluation Engine & Database Service
*   **Evaluation Engine (`lib/ruleEvaluator.ts`)**: Create a function `simulateRule(rule: WorkflowRule, requestData: any)` that traces matches for each conditional row and returns:
    ```json
    {
      "matched": boolean,
      "trace": [
        { "field": "loan_amount", "operator": "gte", "expected": "250000", "actual": "300000", "matched": true }
      ],
      "actions": ["assign_user: Wael"]
    }
    ```
*   **Audit Service (`lib/services/execution.ts`)**: Implement `RuleExecutionService` to log evaluations and list/retrieve logs:
    *   `logExecution(orgId, workflowId, requestId, requestName, eventName, status, trace, actions)`
    *   `listExecutions(orgId)`

#### 3. API Routes
*   **`POST /api/workflows/simulate`**: Accept `{ requestId, rule }`, fetch the request details (fallback to a mock request from `lib/platformData.ts` if not found in database), run `simulateRule`, and return the matching trace.
*   **`GET /api/workflows/executions`**: Scoped endpoint to fetch the list of logged executions.

#### 4. UI: Simulation Panel Upgrades (`components/SimulationPanel.tsx`)
*   Add a type-to-search request search bar at the top of the panel (search from `/api/workflows/requests/search` or load from mock data list).
*   Add a **"Simulate Rule"** button. Clicking it fires the `POST /api/workflows/simulate` dry-run API and displays a clean, colored trace tree:
    *   Fired triggers (Green check)
    *   Condition checks showing *expected* vs *actual* values (Green for match, Red for fail).
    *   Dispatched actions (Blue badge).

#### 5. UI: Audit Logs Sub-Tab (`components/AuditLogs.tsx` & `app/page.tsx`)
*   Create a clean, tabular `AuditLogs` history view showing log history (Timestamp, Rule Name, Target Request, Trigger Event, Status `FIRED` / `SKIPPED`).
*   Clicking a log row opens a side panel rendering the tracing results for that specific evaluation run.
*   Add the `"Audit Logs"` option to the homepage navigation header tab toggle.

---

### Step-by-Step Execution

1.  Add the Prisma model and apply database migrations.
2.  Implement the simulator service, API routes, and front-end code.
3.  Ensure compilation succeeds using `npm run build` and `npm run lint`.
4.  Report back when the changes are ready to compile and merge!
