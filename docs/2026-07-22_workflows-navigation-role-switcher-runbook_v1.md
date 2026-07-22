# Workflows Sub-Navigation & Role Switcher Implementation Runbook

**Date:** 2026-07-22  
**Branch:** `main` (commit `9dedbad`)  
**Resource File:** `docs/2026-07-22_workflows-navigation-role-switcher-runbook_v1.md`  

---

## 1. Executive Summary

This document serves as the authoritative specification and resource guide for the **Workflows Sub-Navigation** and **Dynamic Role Switcher** system within the LandJourney / Sweet Workflow Creator platform.

The Workflows hub's operational views (`All Workflows`, `Reviews`, `Create / Propose Workflow`) present as **in-page tabs within the Workflows section** — the left rail keeps its flat side-nav-v2 structure (commit `72576c9`). `Dashboard` is a **top-level rail destination, not a subtab**. Role-based permissions (**Admin**, **Senior Manager**, **Junior Analyst**) govern direct activation versus maker-checker proposal submission.

> **v1 correction (2026-07-22):** an earlier draft nested the sub-navigation
> (including Dashboard) under the rail's Workflows entry. That consolidation is
> reverted: the rail keeps the `72576c9` spec, and hub-internal switching lives
> in the in-page tab bar described in §2.B.

---

## 2. Navigation Architecture

### A. Left Rail (`app.html`) — side-nav-v2 spec, per commit `72576c9`
The main sidebar rail is **flat** — no nested sub-navigation under any entry. Its top-level items:

1. **Dashboard** (`/dashboard`)
   - Overview metrics, throughput curve, live signal tape, trigger/action volume, and activity calendar. Reached only from the rail — never rendered as a Workflows subtab.
2. **Workflows** (`/workflows`)
   - The hub entry: active for the list and its detail/edit children, but not for the sibling `/proposals` or `/new` routes.
3. **Reviews** (`/workflows/proposals`)
   - Four-eyes review queue.
4. **New workflow** (`/workflows/new`)
   - AI-first natural language composer & diagram builder.

The **role switcher** (§3.B) sits in the account stack styled in the rail's own row language — connected surface, hairline seam, role tone-dot when collapsed, dot + title + chevron when expanded, with an upward dark menu.

### B. Workflows In-Page Tab Bar (`wf-workflows-tabs`)
The hub's pages appear as **different pages within the Workflows section**, switched by a tab bar mounted at the top of each view (list, review queue, composer):

1. **All Workflows** (`/workflows`)
   - Full operational index, search by name/purpose, status filters, and active/observing metrics.
2. **Reviews** (`/workflows/proposals`)
   - Live pending proposal count badge (hidden at zero).
3. **Create / Propose Workflow** (`/workflows/new`)
   - Tab dynamically labels as **Create workflow** (for Admins/Managers) or **Propose workflow** (for Junior Analysts).

Dashboard is not part of the tab bar.

---

## 3. Dynamic Role Management Engine

### A. Role Definition Matrix (`user-session.service.ts`)

| Role | Title | Badge Tone | Direct Activation | Review & Approve Proposals | Propose Mode |
|---|---|---|---|---|---|
| `admin` | **Admin** | `primary` | ✅ Yes | ✅ Yes | ❌ No |
| `senior-manager` | **Senior Manager** | `info` | ✅ Yes | ✅ Yes | ❌ No |
| `junior-analyst` | **Junior Analyst** | `warn` | ❌ Gated | ❌ Gated | ✅ Mandatory |

### B. Role Switcher UI Widget (`app.html` & `app.scss`)
- Located in the sidebar account stack (`.rail-account` → `.rail-role`), styled to the rail's row language (connected surface, hairline seam) rather than as a foreign pill.
- Collapsed rail: the role's **tone dot** only (mark-only, like the logo crop). Expanded: dot + role title + chevron (`.role-toggle`).
- Clicking opens the upward `.role-menu` (dark rail palette; `menuitemradio` options with tone dot, title, and description) allowing instant role switching.
- Choices are reactive and immediately persist to `localStorage` (`sweet_active_user_role`).

---

## 4. Propose Workflow Scheme (Maker-Checker Flow)

1. **Junior Analyst Mode**:
   - Creating a workflow in the composer renders **"Propose workflow ↗"**.
   - Submitting invokes `WorkflowsService.createProposal()`, creates a pending `WorkflowProposal` record, and redirects to `/workflows/proposals`.
   - In the **Reviews** queue, approval/decline buttons are hidden and replaced with `[ Awaiting Admin / Manager Review ]`.
2. **Admin / Senior Manager Mode**:
   - Direct activation and immediate rule execution are enabled.
   - Pending proposals in `/workflows/proposals` render actionable **Approve change** and **Decline** buttons.

---

## 5. Verification & Testing Commands

```bash
# Run fixpoint, purity, and UX contract test suites
npm test

# Verify production Angular application build
npm run build
```
