# Developer Spec: Fill in with Demo Data (Phase 1.9.4)
**File:** `docs/2026-07-21_fill-demo-data_v1.md`
**Target Component:** `src/app/features/workflows/pages/workflow-composer.page.ts`

---

## 1. Overview

Add a **"Try a demo" selector/button** control on the workflow composer page. This feature allows users to quickly select from a set of pre-configured, rich, and recognizable natural-language descriptions. Clicking an option populates the textarea, triggers the parser engine, and automatically builds out the 3-column builder and workflow canvas diagram.

This makes it easy to demo and test the parser engine and visual components without typing a long workflow from scratch.

---

## 2. Placement in the Template

Insert a compact demo toolbar under the composer form (around line 346–351), adjacent to the typing guidance helper:

```html
          @if (focused() || text()) {
            <p class="guidance" id="composer-guidance">
              Enter to continue <span aria-hidden="true">·</span> Shift + Enter for a new line
            </p>
          }

          <!-- ★ INSERT DEMO TOOLBAR HERE ★ -->
          <div class="demo-toolbar" aria-label="Demo templates">
            <span class="demo-label">🧪 Try a demo:</span>
            <div class="demo-options">
              <button type="button" class="demo-pill" (click)="fillDemo(1)">
                Credit Underwriting
              </button>
              <button type="button" class="demo-pill" (click)="fillDemo(2)">
                Offer Rejection
              </button>
              <button type="button" class="demo-pill" (click)="fillDemo(3)">
                Maturity SLA
              </button>
              <button type="button" class="demo-pill" (click)="fillDemo(4)">
                Booking Error
              </button>
            </div>
          </div>
```

---

## 3. Demo Data Payloads

Create a helper function or dictionary of demo scenarios that translate to rich visual layouts. Ensure all inputs are clearly recognizable as demo data by using a prefix like `"DEMO: "` and appropriate field/value options.

### Demo 1: Credit Underwriting
- **Text**: `"DEMO: when credit pull returned is FICO score worse than 620, route to queue 'Underwriting · Unassigned' and assign to Underwriter II"`
- **Expected Results**:
  - Event: `credit_pull` (Credit pull returned)
  - Condition: Credit result (Metric: FICO, Operator: less than, Value: 620)
  - Actions: Route to queue ('Underwriting · Unassigned'), Assign to user/team ('Underwriter II')

### Demo 2: Offer Rejection
- **Text**: `"DEMO: when offer accepted is rejected, change request stage to Closed and send notification to Borrower with message 'DEMO: We are sorry but the offer was declined'"`
- **Expected Results**:
  - Event: `offer_accepted` (Offer accepted / rejected)
  - Condition: Offer status (Status: rejected)
  - Actions: Change request stage (To stage: Closed), Send notification/email (Recipient: Borrower, Message: 'DEMO: We are sorry but the offer was declined')

### Demo 3: Maturity SLA
- **Text**: `"DEMO: when loan maturity approaching is 30 days before, send notification to Request owner with message 'DEMO: Loan maturing soon'"`
- **Expected Results**:
  - Event: `loan_maturing` (Loan maturity approaching)
  - Condition: Timing (Offset: 30, Unit: days, Direction: before, Anchor date: Maturity date)
  - Actions: Send notification/email (Recipient: Request owner, Message: 'DEMO: Loan maturing soon')

### Demo 4: Booking Error
- **Text**: `"DEMO: when booking status changed is Error, trigger booking event Fiserv and schedule reminder in 3 days"`
- **Expected Results**:
  - Event: `booking_status` (Booking status changed)
  - Condition: Booking status (Status: Error)
  - Actions: Trigger / resend booking event (Core: Fiserv), Schedule reminder (When: in 3 days)

---

## 4. Component Class Methods

Add the `fillDemo(id: number)` method to `WorkflowComposerPage` class:
1. Fetch the selected demo text string.
2. Set the `text` signal: `this.text.set(text)`.
3. Clear existing states, focus the textarea, and trigger the parser analysis (similar to the regular input flow).
4. Ensure the visual builder and diagram update instantly (relying on the Phase 1.6/1.7 bi-directional sync logic).

---

## 5. CSS Styling (add to page or global scss)

Use Sweet design tokens to style the demo toolbar:

```scss
.demo-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
  margin-bottom: var(--space-4);
  font-size: var(--text-xs);
}
.demo-label {
  color: var(--text-dim);
  font-weight: 500;
}
.demo-options {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.demo-pill {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-full, 9999px);
  padding: var(--space-1) var(--space-3);
  color: var(--text);
  cursor: pointer;
  font-size: var(--text-xs);
  transition: background var(--motion-fast), border-color var(--motion-fast);

  &:hover {
    background: var(--surface-hover);
    border-color: var(--accent);
  }
}
```

---

## 6. Verification & Safety

- Ensure that clicking a demo button automatically updates the textarea and triggers the NLP parsing engine.
- Ensure that the 3-column builder highlights the correct events, shows matching cards, and arranges nodes on the canvas.
- Run `npm test` to make sure all 370 assertions remain green.
- Run `npm run build` to verify there are no compilation or budget issues.
