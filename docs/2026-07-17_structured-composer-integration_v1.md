# Developer Spec: Structured Composer Integration (Phase 1.5)

## Context & Overview

Codex has recently delivered a premium UX overhaul on the Angular workflows workspace. The application now uses curated design tokens for spacing, typography, colors, border, radius, shadow, and motion. It also features a custom-drawn 61-circle SVG **Sweet spiral** reacting to typing energy, pointer motion, and lifecycle states.

The current creation flow is entirely description-based. We want to enhance this by introducing the **3-column sectioned builder** from the proposal HTML directly below the NLP cursor on the **Create Workflow** tab ([workflow-composer.page.ts](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/src/app/features/workflows/pages/workflow-composer.page.ts)), preserving all existing features (conversational revision, testing, and validations).

---

## 1. Layout Refactoring (Horizontal & Layered)

Refactor the vertical space-consuming layout to a compact, layered layout:
1. **Top Row (Text & Figure)**:
   - Make the invitation title `"Let’s make your operations a little sweeter."` smaller (e.g. `1.75rem` or `2rem`).
   - Remove the `<span>Create a workflow.</span>` from the header block.
   - Align this header title text side-by-side with a scaled-down `<wf-sweet-spiral>` (e.g., restricted to a `120px` width/height wrapper container).
2. **Middle Row (The NLP Cursor)**:
   - Position the textarea directly below the top row.
   - Use `"Create a workflow."` as a placeholder (ghost text) in the textarea.
3. **Bottom Row (The 3-Column Visual Builder)**:
   - Position a 3-column grid layout below the textarea that is always visible.
   - Style it using the Sweet design tokens: borders, rounded corners (`var(--radius-lg)`), soft shadows (`var(--shadow-soft)`), and dynamic hover states.

---

## 2. Three-Column Structured Builder Specification

The 3-column visual layout should mirror the columns in the proposal HTML:

### Column 1: Trigger Event
- **Header**: `1 Trigger event`
- **Search**: A filter input with placeholder `Search events…`.
- **List**: Categorized list of triggers from `EVENTS` (imported from `vocabulary.ts`). Group them by logical lifecycle domains:
  - **Offers**: `OFFER ACCEPTED`, `OFFER MADE`, `OFFER REJECTED`
  - **Underwriting**: `LOAN APPROVED`, `LOAN REJECTED`
  - **Booking Events**: `FISERV LOAN`, `FMAC LOAN`, `BOOKING STATUS CHANGED`, `SYSTEM ERROR`
  - **Request Events**: `REQUEST CREATED`, `REQUEST SUBMITTED`, `REQUEST STAGE CHANGED`, `REQUEST ASSIGNED`
  - **Documents**: `DOCUMENT UPLOADED`, `DOCUMENT APPROVED`, `DOCUMENT REJECTED`, `CHECKLIST COMPLETED`, `EXTRACTION COMPLETED`
  - **Credit**: `CREDIT PULL COMPLETED`
  - **Other / System**: Fallback group for any remaining event keys (e.g. `SCHEDULED COVENANT REVIEW`, `CUSTOMER CREATED`, `SIGNATURE COMPLETED`).
- **Icons**: Prefix each event in the list with a logical emoji (e.g., 📥, 🏦, ⚖️, 🤝, 📡, 📎, ✍️, 💳).
- **Behavior**: Clicking an event sets/updates the trigger array in the rule: `rule().triggers = [{ event: eventKey }]`. Highlight the selected trigger.

### Column 2: Conditions
- **Header**: `2 Conditions`
- **Zero State**: If no trigger event is selected, display: `"Pick a trigger event first."`
- **Field Buttons**: If a trigger is active, list all available conditions from the event's `condFields` array (retrieved using `getEvent(eventKey)?.condFields`). Render them as pill buttons with a `+ ` prefix (e.g. `+ Request stage`, `+ Loan amount`).
- **Pill Click**: Clicking a button appends a condition leaf node to the rule's `conditions.children` array.
- **Card Rendering**: Render each added condition card with:
  - **Title**: Field label (e.g. `Request stage`, `Loan amount`).
  - **Remove**: An `✕` close button in the top-right corner to delete the card.
  - **Operator Select**: A dropdown populated with `OPERATORS[field.kind]` (e.g. is, is not, worse than, gt).
  - **Value Control**:
    - If the field defines `options` (enum), render a `<select>` dropdown.
    - Otherwise, render a text `<input>`.
- **Logic Connectors**: If multiple condition cards exist, render a logic toggle dropdown (`AND` or `OR`) between them, updating the rule's `conditions.logic` property.

### Column 3: Outputs
- **Header**: `3 Outputs`
- **Search**: A filter input with placeholder `Search actions…`.
- **List**: Categorized list of actions from `ACTIONS` (imported from `vocabulary.ts`) grouped by their logical domains (e.g., Routing, Requests, Underwriting, Documents, Signatures, Comms, Credit). Clicking an action appends it to `rule().actions`.
- **Selected Actions**: Display a list of the active action cards below:
  - **Title**: Action label + emoji (e.g. `👤 assign to`).
  - **Remove**: An `✕` close button to delete the card.
  - **Parameter Fields**: Renders inputs/selects for parameters dynamically based on `action.paramKind`:
    - `enum`: A `<select>` dropdown of options.
    - `text`: A text `<input>` (or dropdown if `paramOptions` exists, like assignees).
    - `none`: Hide the value control.

---

## 3. Bi-Directional State Synchronization & Save Rules

1. **State Mutation**: All changes in the visual builder must modify the component's underlying rule state immutably:
   ```typescript
   // Example update helper
   private updateRule(rule: WorkflowRule) {
     const currentResult = this.result();
     if (currentResult) {
       this.result.set({ ...currentResult, rule });
     } else {
       this.result.set({
         rule,
         text: this.text(),
         ambiguities: [],
         notes: [],
         uncovered: [],
         unresolved: []
       });
     }
     this.parsedDescription.set(this.text().trim());
   }
   ```
2. **Syncing description text**: Setting `this.parsedDescription` to `this.text().trim()` on visual changes ensures that the `Start observing` save gate remains enabled even if the user did not trigger a description parse.
3. **Purity & Validation Rules**:
   - Do **NOT** remove or edit the block-level validation checks in the `save()` method, as they are strict UX and API contract tests:
     ```typescript
     if (!rule || this.gaps().length > 0) return;
     const validated = validateRule(rule);
     ```
   - Keep the class template attributes and accessible tags in the textarea to pass the `assert-sweet-ux.ts` checks.
   - Retain the exact Enter/Shift+Enter keydown logic on the composer input.

---

## 4. Layout CSS & Design Styling

Style the columns using CSS variables already defined in `styles.scss` and `index.html`:
- Grid Columns:
  ```css
  .visual-builder {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
    margin-top: var(--space-8);
    align-items: start;
  }
  .builder-column {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    min-height: 480px;
  }
  ```
- Make sure each card (condition, output) uses a curated border `var(--border)` and backgrounds like `var(--surface-inset)` or `var(--surface)` to distinguish them nicely.
- Ensure that search inputs are styled consistently.
