# Spec: Live Rule Simulator & Execution Audit Logs

**Goal**: Establish a live-data rule simulation panel allowing staff to dry-run rules against real database requests, and create a structured database logger to audit every rule evaluation and downstream action.

---

## 1. Database Schema Additions

To capture every rule evaluation event for analytics and compliance, we introduce a `RuleExecution` model.

### Prisma Schema Additions (`prisma/schema.prisma`)
```prisma
model RuleExecution {
  id                String             @id @default(uuid())
  orgId             String             @map("org_id")
  workflowId        String             @map("workflow_id")
  requestId         String             @map("request_id") // ID of the loan application evaluated
  requestName       String             @map("request_name")
  eventName         String             @map("event_name")  // Trigger event name (e.g. LOAN APPROVED)
  status            ExecutionStatus
  evaluationTrace   Json               @map("evaluation_trace") // Evaluation logs for each condition card
  actionsDispatched Json               @map("actions_dispatched") // List of actions sent to the bus
  createdAt         DateTime           @default(now()) @map("created_at")

  workflow          Workflow           @relation(fields: [workflowId], references: [id], onDelete: Cascade)

  @@index([orgId, requestId])
  @@map("rule_executions")
}

enum ExecutionStatus {
  FIRED
  CONDITIONS_NOT_MET
  ERROR
}
```

Add the relation inside the existing `Workflow` model:
```prisma
model Workflow {
  // ... existing fields
  executions RuleExecution[]
}
```

Run Prisma migrations:
```bash
npx prisma migrate dev --name add_rule_executions_table
```

Enable Row Level Security (RLS) in Supabase:
```sql
ALTER TABLE rule_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow tenant-scoped access by org_id" ON rule_executions
  FOR ALL USING (auth.jwt() ->> 'org_id' = org_id) WITH CHECK (auth.jwt() ->> 'org_id' = org_id);
```

---

## 2. Rule Evaluation Engine & Simulation Backend

### Simulation Endpoint (`POST /api/workflows/simulate`)
Enables dry-run checking of a rule against a real request without logging to the database.

*   **Request Body**:
    ```json
    {
      "requestId": "uuid-here",
      "rule": {
        "trigger": { "event": "LOAN APPROVED" },
        "conditions": {
          "logic": "AND",
          "rules": [{ "field": "loan_amount", "operator": "gte", "value": "250000" }]
        },
        "actions": [{ "action": "assign_user", "params": { "assignee": "Wael" } }]
      }
    }
    ```
*   **Response**: Traced execution flow:
    ```json
    {
      "matched": true,
      "trace": {
        "trigger": { "matched": true, "actual": "LOAN APPROVED" },
        "conditions": [
          {
            "field": "loan_amount",
            "operator": "gte",
            "expected": "250000",
            "actual": "300000",
            "matched": true
          }
        ]
      },
      "actions": ["assign_user: Wael"]
    }
    ```

### Service Helper (`lib/ruleEvaluator.ts`)
A server-side evaluator that fetches the real Request record from the Landjourney database, parses the rule operands, and validates them:
```typescript
export function evaluateCondition(fieldValue: any, operator: string, ruleValue: any): boolean {
  switch (operator) {
    case "is": return String(fieldValue) === String(ruleValue);
    case "is_not": return String(fieldValue) !== String(ruleValue);
    case "gt": return Number(fieldValue) > Number(ruleValue);
    case "gte": return Number(fieldValue) >= Number(ruleValue);
    case "lt": return Number(fieldValue) < Number(ruleValue);
    case "lte": return Number(fieldValue) <= Number(ruleValue);
    case "contains": return String(fieldValue).toLowerCase().includes(String(ruleValue).toLowerCase());
    default: return false;
  }
}
```

---

## 3. UI Modifications (Option B Tab layout integration)

### A. Live Request Lookup Drawer in Simulation Panel
*   **Search Input**: Replace the static requests list with a live dropdown. Type to search active requests via `/workflows/requests/search` (from Landjourney's live proxy).
*   **Simulate Button**: When a request is selected, call `POST /api/workflows/simulate`.
*   **Trace UI**: Render a colored flowchart detailing matching parameters:
    *   `Trigger [LOAN APPROVED] matched` (Green)
    *   `Condition [loan_amount >= 250000] passed (Actual: $300,000)` (Green Check)
    *   `Actions dispatched: Route to Senior Credit Officer` (Blue)

### B. "Execution History" Logs Tab
Add a sub-tab inside the homepage toggles alongside Rules and Authorities:
`[ Rules Canvas | Approval Authorities | Audit Logs ]`
*   **Logs Table**: Display a slate-themed paginated table showing:
    *   Timestamp
    *   Rule Name
    *   Triggering Request (linked)
    *   Status (`FIRED` / `SKIPPED`)
    *   Dispatched actions
*   **Detail Panel**: Click an execution row to open a sidebar displaying the complete tracer tree (which exact conditions failed or passed).
