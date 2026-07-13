# Workflow Creator — Project Foundation Brief

**Created:** 2026-07-13
**Owner:** Anderson Wichern
**Status:** Living document. This is the durable grounding for the Workflow Creator build.
Update it as BitBucket access lands and facts get confirmed.

> **How to use this file:** Drop it into the *Landjourney Work* knowledge project
> (`docs/`) so every future Cowork session starts grounded. It separates what is
> **verified against the live platform** from what is **fabricated or unconfirmed**,
> so we never build a builder on fiction.

---

## 1. The decision

Build a **combination of Proposal 1 and Proposal 3, with the UX looking like Proposal 3.**

- **Proposal 1 (spine / data model):** a rule is `event → conditions → outputs`. The
  condition list is *driven by the selected event's allowed set* (`event.conds`), so the
  builder can only offer valid combinations — exactly how a backend constrains triggers to
  their real fields.
- **Proposal 3 (skin / UX):** present that rule as an **editable plain-English sentence**
  (`WHEN … IF … THEN …`) with clickable colored tokens, plus a prominent **chat box** that
  drafts and edits the same underlying rule.
- **Proposal 2 (whiteboard):** **skipped** for the first client demo. A free-form graph
  implies branching the single-rule model can't execute.
- **Execution is stubbed for the demo:** persist rule JSON, list saved rules, on/off toggle.
  Real end-to-end execution (event bus across microservices, condition evaluator, action
  executor) is a large cross-service effort and is out of scope for the first demo.

---

## 2. Critical framing — the mockups are throwaway specs

The three `2026-07-09_workflow-creator-proposal-*.html` files are **standalone design
mockups, not the real software.** The live Landjourney admin console
(`admin-test.landjourney.ai`) is an Angular app with a thin icon-rail nav and
Material-style cards — it shares nothing visually or structurally with the mockups.

The mockups are useful for exactly two things:

1. The **intended UX pattern** (P1 logic + P3 skin).
2. A **hypothesized vocabulary** — the shared `window.LJ` object (25 events, ~24 condition
   groups, 18 outputs). This was **invented** by whoever built the mockup, **not
   introspected** from the platform. Every token must be validated before it ships. A
   builder offering triggers/actions the backend can't emit or execute looks real but does
   nothing — the classic demo trap.

**None of the mockup HTML/JS ports to production.** The real build is net-new code (see §6).

---

## 3. Build environment / stack reality

| Piece | State (2026-07-13) | Notes |
|---|---|---|
| **Main product** | Angular + Angular Material, per-org `ui-configuration` feature-gating | Lives in BitBucket. **Access pending.** `workflow-api` repo is the first read. |
| **Supabase `WorkflowCreator`** | Live, healthy, **zero tables** (greenfield) | ref `xylgtegaukbzeutugdxw`, us-east-2, Postgres 17. Rule-JSON persistence goes here. |
| **`Sweet Coding Work` repo** | Git repo (`main`, `origin/main`), `.next` + `.vercel` + `.env.local` present | Appears to be a **Next.js app on Vercel** — the likely standalone test-app target. ⚠️ No `package.json`/source at top level when inspected — confirm whether source is missing or elsewhere. |
| **Connectors live in Cowork** | Supabase, Vercel, Cloudflare, GitHub | BitBucket has **no** Cowork/MCP connector — fall back to a local clone connected as a folder. |

**Open stack question:** Is the workflow creator being built as a **standalone Next.js +
Supabase + Vercel test app** (which the `Sweet Coding Work` repo implies), or as a
**lazy-loaded Angular feature module inside the main product**? These are very different
builds. The decision below (§6) assumes we resolve this the moment BitBucket access lands.

---

## 4. Vocabulary — verified vs aspirational

Grounded against the **live admin site on 2026-07-13** by direct inspection. "✅ Verified"
means observed in the real UI/data today. "⚠️ Unconfirmed" means plausible but not seen —
needs the codebase or deeper data inspection.

### ✅ Verified real (safe to build on)

| Mockup token | Real platform truth |
|---|---|
| `systype` (System event types) | **6 real types** from the System Events filter: `FISERV LOAN`, `FMAC LOAN`, `LOAN APPROVED`, `LOAN REJECTED`, `OFFER ACCEPTED`, `SYSTEM ERROR`. Mockup listed only 4 — **missing `LOAN APPROVED` and `SYSTEM ERROR`.** (`SYSTEM ERROR` is the real hook for the "booking error → escalate" demo.) |
| `queue` (Underwriting) | Exact match: `My Requests`, `Unassigned`, `Assigned`, `Auto Approved`, `Approved`, `Rejected`, `All Requests`. |
| `uwstatus` (Underwriting result) | `Auto Approved`, `Approved`, `Rejected` — matches (these are the queue tabs). |
| `bookstatus` (Booking status) | Exact match: `Not Sent`, `In Flight`, `Sent`, `Confirmed`, `Partially Confirmed`, `Unconfirmed`, `Error`. Booking Events also exposes two dims: **Data Status** + **Processing Status**. |
| `core` (Fiserv / FMAC) | Confirmed — `FISERV LOAN` and `FMAC LOAN` are live System Event types. |
| `retailer` | Real — `Settings → Retailers` is a first-class section. |
| Underwriting columns | Confirmed: Request name, Date submitted, **Loan amount**, **Retailer & Program**, **Tags**, **Status**, **Team member**, **Main borrower**. |
| `stage` (request stage) | `Initiated` observed live on Home pipeline. Full set `Initiated → Processing → Approved → Closed` per platform knowledge (Processing/Closed not re-verified today). |
| Tags | Real, filterable in Underwriting — a genuine condition axis the mockup underused. |

### ⚠️ Aspirational / unconfirmed (do NOT assume these work)

| Mockup token | Reality check |
|---|---|
| `assign_authority` (Loan Officer → Loan Committee ladder) | **Fabricated.** `Settings → Users` is a **flat list of 43 users** (First/Last/Email/Phone only). There is **no Roles/Permissions section** and no authority hierarchy to route to. Use `assign_user` (assign to a named person/team) instead. |
| The **25-event bus** | The only visible event log (System Events) emits **6 core lifecycle types**, not 25. The granular events — `doc_uploaded`, `doc_approved`, `ai_extract`, `sig_signed`, `sig_status`, `checklist_done`, `coapp_added`, `role_assigned`, `tmpl_form` — are **not visible** as emitted events. Whether the backend fires them at all needs the codebase. |
| `scorecard_done` / `score`, `credit_pull` / `credit` (FICO, DSCR, etc.) | Data model unconfirmed — not observed today. |
| `webhook`, `schedule_rem` | Supporting infra unconfirmed — may not exist. |
| Form `field` enum (DSCR, Total Current Assets, …) | These come from per-template dynamic forms + AI extraction, so they are **per-template, not a fixed global enum.** Don't hardcode. |

**Design rule that follows from this:** ship the builder with the **verified** vocabulary
first. Gate every aspirational token behind a "confirmed emittable by backend" flag so the
demo never offers an action the engine can't execute.

---

## 5. Constraints to respect

- **Net-new nav section.** No "Workflows" item exists in the real nav today. A new route +
  nav entry + permissions must slot into the per-org `ui-configuration` feature-gating, or
  it won't appear for the right tenants (Growmark / FCS).
- **Local-profile / 16 GB limit.** Events originating in services not running locally won't
  fire; booking/core events (Fiserv/FMAC) can't be exercised locally at all. Any live
  "booking error → escalate" demo must be **seeded/scripted**, not triggered organically.
- **A workflow creator is ~80% backend, ~20% UI.** The hard part is the rules engine, not
  the drag-and-drop. For the demo we fake execution; a half-wired engine shipping to prod is
  a liability.

---

## 6. Recommended build shape (for the demo)

- A **rule-JSON schema** as the contract. The `window.LJ` shape (`{ event, conds[], outputs[] }`)
  is a fine starting schema. Persist it in Supabase (greenfield).
- **Suggested Supabase tables** (draft — refine against `workflow-api` if an engine exists):
  `workflows` (id, org_id, name, description, enabled, rule_json, created_at, updated_at),
  optionally `workflow_runs` (stubbed/audit) later. Enforce **per-tenant scoping** via `org_id` + RLS.
- **UI:** editable `WHEN/IF/THEN` sentence with clickable tokens (P3), constrained pickers
  driven by `event.conds` (P1), and a chat box that populates the same rule object.
- **AI input:** the chat can start as canned parsing (like the mock) and graduate to a real
  LLM call — but keep the demo path deterministic so nothing non-deterministic happens on stage.
- Degrade gracefully to **save + list + on/off toggle** with execution stubbed.

---

## 7. Open questions — resolve the moment BitBucket access lands

Read **`workflow-api` first.** It may already provide part of the engine, which would flip
the build from "hard" to "wire up existing."

1. Does a **rules/workflow engine** already exist (event bus, condition evaluator, action executor)?
2. Which of the events can the backend **genuinely emit**? (System Events shows only 6; are the other ~19 real internal events or fiction?)
3. Is there existing **rule-JSON persistence** and a schema we should conform to?
4. How is **per-tenant scoping** done today (org_id, RLS, tenant middleware)?
5. Is the workflow creator a **standalone Next.js app** (`Sweet Coding Work`) or an **Angular feature module** in the monorepo? (See §3.)
6. Do **scorecards / credit metrics** (FICO, DSCR) exist as structured data, or only inside documents/AI extraction?
7. Do `webhook` / `schedule_rem` style infra hooks exist?
8. What is the exact **Growmark / FCS demo scenario** the first demo must show on stage (which events must fire vs be seeded)?

---

## 8. Change log

- **2026-07-13** — Initial brief. Vocabulary grounded against live admin site (System Events,
  Settings/Users, Underwriting, Booking Events). Supabase `WorkflowCreator` confirmed empty.
  `Sweet Coding Work` repo (Next.js/Vercel) noted as likely standalone target. BitBucket access pending.
