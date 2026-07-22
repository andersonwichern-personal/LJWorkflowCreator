# Workflows Sub-Navigation & Role Switcher Implementation Runbook

**Date:** 2026-07-22  
**Branch:** `main` (commit `9dedbad`)  
**Resource File:** `docs/2026-07-22_workflows-navigation-role-switcher-runbook_v1.md`  

---

## 1. Executive Summary

This document serves as the authoritative specification and resource guide for the consolidated **Workflows Sub-Navigation** and **Dynamic Role Switcher** system within the LandJourney / Sweet Workflow Creator platform.

The system consolidates all operational views (`Dashboard`, `All Workflows`, `Reviews`, `Create / Propose Workflow`) into the primary **Workflows** navigation hub, while enforcing role-based permissions (**Admin**, **Senior Manager**, **Junior Analyst**) for direct activation versus maker-checker proposal submission.

---

## 2. Navigation Architecture

### A. Left Rail Consolidated Hub (`app.html`)
The main sidebar rail consolidates all workflow tools under a single primary `Workflows` entry. On expansion, it displays the nested sub-navigation:

1. **Dashboard** (`/dashboard` / `/workflows/dashboard`)
   - Overview metrics, throughput curve, live signal tape, trigger/action volume, and activity calendar.
2. **All Workflows** (`/workflows`)
   - Full operational index, search by name/purpose, status filters, and active/observing metrics.
3. **Reviews** (`/workflows/proposals`)
   - Four-eyes review queue with live pending proposal count badge.
4. **Create / Propose Workflow** (`/workflows/new`)
   - AI-first natural language composer & diagram builder. Button dynamically labels as **Create workflow** (for Admins/Managers) or **Propose workflow** (for Junior Analysts).

---

## 3. Dynamic Role Management Engine

### A. Role Definition Matrix (`user-session.service.ts`)

| Role | Title | Badge Tone | Direct Activation | Review & Approve Proposals | Propose Mode |
|---|---|---|---|---|---|
| `admin` | **Admin** | `primary` | ✅ Yes | ✅ Yes | ❌ No |
| `senior-manager` | **Senior Manager** | `info` | ✅ Yes | ✅ Yes | ❌ No |
| `junior-analyst` | **Junior Analyst** | `warn` | ❌ Gated | ❌ Gated | ✅ Mandatory |

### B. Role Switcher UI Widget (`app.html` & `app.scss`)
- Located in the sidebar account section (`.rail-account`).
- Displays a pill button showing the active role badge.
- Clicking opens the `.role-dropdown` allowing instant role switching.
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
