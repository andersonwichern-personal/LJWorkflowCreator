# Review Request → Gemini (Antigravity / Overseer)

**From:** Claude (Coder)
**Date:** 2026-07-13
**Branch:** `feature/workflow-creator-ui` (pushed, unmerged)
**Ask:** Verify the Workflow Creator UI **against the live platform** (`admin-test.landjourney.ai`)
before we consider merging. The build is green; the open risk is **vocabulary fidelity**, which
only you (with live-site access) can confirm.

---

## 1. What I built

The hybrid **P1 spine + P3 skin** from the Foundation Brief, on top of your backend scaffolding
(`WorkflowService`, `/api/workflows`, Prisma `Workflow` model + migration).

- **`lib/vocabulary.ts`** — single source of truth. Events, fields (grouped by lifecycle area),
  operators, actions, and the **event → condition binding** (`allowedFieldsForEvent`). Every token
  carries a `confidence: "verified" | "unconfirmed"` flag; unconfirmed tokens are badged in the UI.
- **`lib/nlParser.ts`** — deterministic chat → rule parser (no LLM; stays predictable for the demo).
- **`components/`** — `RuleSentence` (editable WHEN/IF/THEN tokens), `TokenPicker` (grouped,
  searchable, confidence-badged), `ChatBox`, `WorkflowSidebar`, `Toggle`, `ThemeToggle`.
- **`app/page.tsx`** — designer canvas, starter templates, live plain-English readout, save/list/toggle/delete.

**Verification done locally:** `npm run lint` clean, `npm run build` clean (zero type errors), page
serves 200, and full CRUD round-trips through Supabase (create/list/toggle/delete), including a rich
rule (numeric `loan_amount ≥ 250000` **AND** `uwstatus is Approved` → assign + add tag).

---

## 2. Please verify against the live admin site

### 2a. Events (`systype`) — marked VERIFIED, built as primary
`SYSTEM ERROR`, `LOAN APPROVED`, `LOAN REJECTED`, `OFFER ACCEPTED`, `FISERV LOAN`, `FMAC LOAN`.
- ✅ Confirm these 6 are the exact System Events types, spelled/cased as shown.

### 2b. Aspirational EVENTS — marked UNCONFIRMED, gated/badged
`REQUEST CREATED`, `OFFER MADE`, `DOCUMENT APPROVED`.
- ❓ Does the backend actually **emit** any of these? If yes, promote to verified. If never, should
  we hide them entirely rather than badge them?

### 2c. Condition fields — VERIFIED (please confirm values)
| Field | Values I used | Check |
|---|---|---|
| `stage` | Initiated, Processing, Approved, Closed | Processing/Closed not re-verified in the brief |
| `reqtype` | Loan Application, Origination, Covenant | template types |
| `custtype` | Business, Individual | |
| `role` | Borrower, Guarantor, Co-Applicant | is "Co-Applicant" real? |
| `queue` | My Requests, Unassigned, Assigned, Auto Approved, Approved, Rejected, All Requests | |
| `uwstatus` | Auto Approved, Approved, Rejected | |
| `loan_amount` | numeric (≥, ≤, >, <, =) | Underwriting column |
| `team_member` | free text + demo names | Underwriting column |
| `offer_queue` | Unassigned, Assigned, All, Rejected | Offers queues |
| `bookstatus` | Not Sent, In Flight, Sent, Confirmed, Partially Confirmed, Unconfirmed, Error | |
| `core` | FISERV LOAN, FMAC LOAN | |
| `loan_product` | Term Loan, Line of Credit | Loans tabs |
| `retailer`, `program` | free text | |
| `tags` | free text | |

### 2d. Condition fields — UNCONFIRMED (gated), please rule in or out
- `data_status`, `processing_status` — I know the **Booking Events dimensions exist**, but I
  **guessed the enum values** (`Complete/Incomplete/Error`, `Queued/Processing/Done/Error`).
  Please supply the real value sets, or tell me to drop these.
- `doc_status` (Approved/Rejected/Skipped), `credit_score` (numeric) — real as event conditions?

### 2e. Actions (outputs)
- ✅ VERIFIED as built: `assign_user` (person/team — **not** the fabricated `assign_authority`),
  `change_stage`, `add_tag`, `close_request`. Confirm these map to real operations.
- ❓ UNCONFIRMED (gated): `make_offer`, `notify`, `send_webhook`, `assign_authority` (kept only as a
  cautionary badged example). Any of these actually executable?

### 2f. ⭐ The event → condition bindings (my main judgment call)
This is the P1 spine and the thing most likely to be wrong. Each event only offers a subset of
fields. Example: `SYSTEM ERROR` → booking/data/processing status + core + request/customer/retailer/
program/tags/stage. Full mapping is in `EVENTS[].condFields` in `lib/vocabulary.ts`.
- ❓ Do these bindings match what each event can genuinely carry on the platform? Flag any field
  offered on an event that couldn't actually be evaluated there.

---

## 3. Known items / decisions for you to weigh in on

1. **Rule JSON schema extension.** I added `condLogic: "AND" | "OR"` to the rule object for
   multi-condition logic. Your backend validator only checks `event`/`conds`/`outputs`, so it
   tolerates the extra field (confirmed by round-trip). Should this become a formal part of the
   schema, or move into a different structure?
2. **`prisma/migrations/` is gitignored.** The `add_workflows_table` migration is applied on the
   shared Supabase but **won't reach the remote branch**. A reviewer cloning fresh won't have it.
   Intentional? For a real project I'd expect migrations committed.
3. **Demo data.** Assignee names (Wael, Sara, teams…) and `orgId = "test-org-uuid-999"` are
   placeholders — Settings → Users is a real 43-person flat list we haven't introspected.
4. **Starter templates** (`STARTER_TEMPLATES`) use only verified vocabulary — confirm they read as
   sensible real-world automations for the Growmark / FCS demo.

---

## 4. How to run it

```bash
git checkout feature/workflow-creator-ui
npm install
npm run dev      # http://localhost:3000
```

Then click a starter template, edit tokens (note the constrained pickers per event), try the chat
box, and Save — it persists to the shared Supabase `WorkflowCreator` project.

**Branch stays unmerged pending your sign-off on §2 and §3.**
