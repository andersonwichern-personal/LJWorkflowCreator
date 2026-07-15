# Prompt: Phase 5 — UX Overhaul & Brand Customizer

## Task Description
Implement **Phase 5 (UX Overhaul & Branding)** of the Hardening Plan. You will introduce the collapsible hover-popout sidebar, a dashboard index landing page gating viewpoint access, bottom-footer role switches, brand color editors, and Lucide SVG icon updates.

You MUST perform this work on the branch: `feature/hardening-phase-5`.

---

## 1. Landing Index Dashboard ("Existing Workflows")
*   Update the entry route `/workflows` (or main landing state) to render the **Existing Workflows Dashboard** by default.
*   This page lists all database workflows in a clean table showing: Name, Event Trigger, Mode (Shadow/Armed tag), Active Status (Toggle switch), and an Edit button.
*   **Role Gating**:
    *   **Admin (`Anderson`)**: Sees `+ New Workflow` button which navigates to the Creator Canvas. Has full edit/save rights.
    *   **Committee (`Wael`)**: Sees a `Propose Workflow` button. Can draft a rule via the chat helper, but clicking save registers it as `proposed` status draft which requires Admin approval (render a warning badge on the dashboard).
    *   **Preparer (`Omar`)**: Lands on the dashboard in a completely read-only list. Cannot edit or propose rules.

---

## 2. Retractable Hover Sidebar (`components/AdminSidebar.tsx`)
*   Create a left-anchored collapsible sidebar styled matching the Landjourney Admin site (dark teal background `#083344` or `#072F40`, white/gray text).
*   **Hover Behavior**:
    *   Default state: Collapsed (64px wide). Shows vertical strip of Lucide icons.
    *   Hover state: Expand overlay to 260px wide with CSS transitions (`transition: width 0.25s ease`) and drop shadow.
*   **Navigation Links**:
    *   Header: Mock Organic Bank of America logo (wheat symbol) + search input.
    *   List navigation links: Home, Requests, Templates, Customers, Offers, Underwriting, Loans, Booking Events, Root Tools, System Events.
    *   **Workflows** (Lucide branch icon) is the active highlighted page.

---

## 3. Persona Switcher Footer Integration
*   Move the `RoleSwitcher` dropdown component from the page header to the footer of `AdminSidebar.tsx`.
*   In collapsed state, render a clean User Avatar icon at the bottom. Clicking it opens the popup role toggles.
*   In expanded state, render the full user profile card (e.g. "Anderson (Admin)") with menu trigger.

---

## 4. Branding & Customizer
*   Expose a Settings popover in the sidebar/page allowing users to input:
    *   `Primary Brand Color` (Hex color selector, e.g. `#00A88F`).
    *   `Branding Logo URL`.
*   Write these configurations to localStorage. Dynamically inject the CSS variables (`--accent`, `--accent-soft`, `--ring`) on mount to re-theme the entire application.

---

## 5. Lucide Icons & UI Cleanup
*   Replace all emojis (⏸, ⚠️, 🔒, ⏳) with modern thin-stroke Lucide icons (`PauseCircle`, `AlertTriangle`, `Lock`, `Hourglass`).
*   In `ChatBox.tsx`, clean up the bullet points under the input: render a visual flowchart card (Trigger → Condition → Action) matching the spec.
