# Workflow Creator + Approval Authority — Alignment & Refinement Guide

**Created:** 2026-07-14
**Author:** Anderson Wichern (live-site + full source scan by Claude)
**Scope:** The Vercel proposal build (`lj-workflow-creator`, repo `LJWorkflowCreator`,
`Sweet Coding Work/`) — how to refine it so the **Workflow Creator** and **Approval
Authority** segment stands up *inside* the Landjourney admin console and works seamlessly
with everything else.
**For:** the agents continuing this build (Antigravity in the admin repo; Gemini as Overseer;
Claude in this repo).
**Companion docs:** `2026-07-14_workflow-creator-admin-buildout-manual_v2.md` (the admin
architecture + endpoints — the source of truth for the target system), foundation brief,
integration-refinements.

> **Scan basis.** I drove the live deploy in Chrome
> (`lj-workflow-creator-git-main-…vercel.app`) *and* read the source. Every file/line claim
> below was read on 2026-07-14 at commit `f5812b3` (main). The admin-side facts (endpoints,
> mocked-vs-real, `dependsOn`) come from the v2 build manual.

---

## 1. Verdict up front

The proposal is **further along and better grounded than a prototype has any right to be.**
The rule schema is versioned and live-compatible, the vocabulary is honestly badged
verified/unconfirmed, tenant scoping is enforced in the services, and the Approval Authority
matrix is a real Prisma model with escalation. **Keep all of that.**

But measured against the user's three requirements, there are precise, fixable gaps:

| Requirement | Today | Gap |
|---|---|---|
| **Pull inputs** | A live bridge exists (`lib/platform.ts` + `/api/platform/vocabulary`) but the live site shows **"○ Demo vocabulary"** — it is **dormant** (empty token, unresolved interceptor headers) and only fetches **label lists**, never per-template **form fields**. | Bridge not actually pulling; no real field operands. |
| **Reasonable conditions** | Rich, event-scoped vocabulary (P1 binding is correct). But `RuleCondition.field` is a **static string key**, not an **ID-bound `{formTemplateId, fieldId}`** ref, and the admin's native **`dependsOn`** conditional model is not reused. | Conditions can't bind to real per-template data. |
| **Actually impact outputs** | The rule engine is a **pure client-side simulation** against seed data (`lib/ruleEngine.ts` + `lib/platformData.ts`). **No action executor. No authority evaluator** (grep confirms none). Actions are *described*, never performed. | Nothing writes back to the platform; the matrix decides nothing. |

Plus an **alignment** gap: the proposal is a **parallel console** ("LJ Decisioning Engine"
with its own nav, indigo/slate theme, `DEMO_ORG_ID`), not an admin *section*. To "stand up
inside the system" it must converge on the admin's shell, theme, identity, and data plane.

The rest of this doc is the fix list, organized by those pillars.

---

## 2. What's already right — do not regress

- **Versioned v2 rule schema** (`lib/vocabulary.ts` → `WorkflowRule`, `RULE_SCHEMA_VERSION`,
  `normalizeRule()` idempotent upgrade). This is the contract. Freeze it.
- **P1 event→condition binding** (`EventDef.condFields`, `allowedFieldsForEvent`) — the
  builder only offers conditions valid for the chosen trigger. Correct and admin-honest.
- **Confidence badging** (`verified` vs `unconfirmed`) + `ruleUsesUnconfirmed()` + the
  in-UI warning. This is the guardrail that stops the demo trap. Preserve it on every new token.
- **Tenant scoping in services** (`WorkflowService`, `ApprovalAuthorityService` all take
  `orgId`, verify ownership before mutate). Keep.
- **Approval Authority matrix** (`prisma/schema.prisma` `ApprovalAuthority`: limit + riskGrade
  + product + userIds + self-referencing `escalationId` `ON DELETE SET NULL` + `autoApprove`).
  Good shape. The gap is the **evaluator**, not the model.
- **Feature interlock**: authority names already feed the `escalate to authority` action
  param options (`WorkflowCreator.tsx` `overlay` merge). The two features already talk. Extend
  this, don't rebuild it.
- **Graceful degradation**: `/api/platform/vocabulary` always 200s with a `source`
  discriminator; live values only *add* options. This is the right resiliency posture.

---

## 3. The alignment model — from parallel console to admin section

The proposal currently **re-implements** the admin (its own `AppShell`, nav, theme). That was
right for a standalone demo, but the ask is to make it a **segment inside the whole system.**
Two correctness moves:

1. **Stop competing with the shell.** In the embed (Antigravity's Angular work) the Workflow
   Creator and Approval Authorities are two routes under the real `lj-main-sidebar-v2`
   (`/workflows`, `/settings/approval-authorities` or `/workflows/authorities`). In *this*
   repo, treat the app chrome (top nav "Rules Canvas | Approval Authorities", "LJ Decisioning
   Engine" wordmark) as **throwaway demo scaffolding**, and keep the two feature surfaces
   (`components/WorkflowCreator.tsx`, `components/ApprovalAuthorities.tsx`) **shell-agnostic**
   so they port cleanly. Anything that assumes the parallel nav is tech debt for the embed.
2. **Adopt the admin's design tokens now** so the port is 1:1: teal accent **`#4FC6A5`**
   (currently indigo/violet `var(--accent)`), **Inter**, Material Symbols icon set, and the
   `lj-page` title/action-bar chrome. Matching tokens early means the Angular embed is a
   near-copy, not a redesign. (See §9.)

**Naming:** the live wordmark says "LJ Decisioning Engine." Decide whether the section is
called **Workflows** (matches the nav slot the manual proposes) or **Decisioning**. Pick one
and use it in both repos.

---

## 4. PILLAR 1 — Actually pull inputs

**Goal:** the pickers show *real* Landjourney building blocks, and conditions can reference
*real* per-template fields.

### 4a. Wake the live bridge (P0)
The bridge is built and dormant. Three blockers, in order:
1. **Token + env not set.** `.env.local.example` ships `LANDJOURNEY_API_TOKEN=""`. The site
   shows "Demo vocabulary" because `platformConfigured()` is false or the fetch 500s. Supply
   `LANDJOURNEY_API_TOKEN` (server-side only) and confirm `LANDJOURNEY_API_BASE` +
   `LANDJOURNEY_ORG_ID` (already defaulted to the real org `1577b554-…`).
2. **Interceptor headers (manual §12 Q2).** A bare `Authorization: Bearer` returns **500** —
   the admin's HTTP interceptor adds a tenant/org header (and possibly a decompressed token).
   The bridge already has the escape hatch: set `LANDJOURNEY_EXTRA_HEADERS` to the missing
   header(s) as JSON (e.g. `{"x-organization-id":"1577b554-…"}`) **once Antigravity reads the
   interceptor in source.** This is the single highest-leverage unblock — resolve it first.
3. **Token lifetime.** The admin token is short-lived and stored compressed (`compressedToken`,
   `$%$v02$%$` envelope). A pasted bearer will expire. For a durable demo, add a small
   server-side token refresh (or a service token) rather than a hand-copied JWT.

**Acceptance:** the header chip flips to **"● Live vocabulary"** with non-zero counts
(`describeSource()` shows N users / retailers / templates / forms).

### 4b. Fetch form *fields*, not just form *names* (P1 — this is the real inputs gap)
`lib/platform.ts` fetches four sections; `forms` hits `GET /documents/templates/forms` and
keeps only names (`toOptions`). It never calls `GET /documents/templates/forms/{id}`, so the
**Application Data** conditions (loan purpose, use of funds, crop type, livestock, loan
source) have **no real operands** behind them.

Add a fifth resolution step: for each template's referenced forms (or a bounded set of forms),
fetch `/documents/templates/forms/{id}` and flatten `sections[].fields[]` into a
**field registry**:
```ts
interface LiveField {
  formTemplateId: string;   // form uuid
  fieldId: string;          // field uuid (real)
  name: string;             // machine key, e.g. "newField3"
  label: string;            // "Loan Information"
  fieldType: string;        // INPUT | NUMBER | MONEY | LOAN_INFORMATION | LIVESTOCK | …
  required: boolean;
}
```
(The exact JSON shape is verified in build manual §6a — array of sections, each field
`{column, fieldType, id, label, name, parameters, required}`.) Map `fieldType` → the
builder's `FieldKind` (`NUMBER`/`MONEY` → numeric, `SELECT`/`RADIO`/enum-ish → enum, else
text). Surface these as a new **per-template Application-Data group** in the picker so a
condition can point at a real field. This is what turns "loan purpose" from a decorative
token into a live operand.

### 4c. Derive org identity from the session, not a constant (P0 correctness)
`lib/api.ts` hardcodes `DEMO_ORG_ID = "test-org-uuid-999"` and every route falls back to it.
But the live bridge uses the **real** org `1577b554-…`. **These don't match** — so
Supabase-persisted workflows/authorities are scoped to a fake tenant that has no relationship
to the platform data the pickers pull. Fix: resolve the org from `GET /iam/users/me` (the
admin already calls this) and thread that single real `orgId` through both the persistence
calls **and** the platform bridge, so a saved rule and the vocabulary it references live in
the same tenant. In the Angular embed this is automatic (the interceptor carries org); in this
repo, add a `/api/platform/me` proxy and replace `DEMO_ORG_ID`.

---

## 5. PILLAR 2 — Reasonable, real conditions

**Goal:** conditions the backend can actually evaluate, bound to real references, using the
platform's own condition semantics.

### 5a. Make conditions ID-bound (P1)
Today `RuleCondition = { field: string; operator; value }` where `field` is a static key like
`"loan_amount"` or `"loan_purpose"`. Platform-native structured fields (loan_amount, stage,
risk_grade, bookstatus) can stay keyed — they map to first-class request attributes. But
**form-derived fields must carry the real reference** so the executor knows what to read:
```ts
type ConditionField =
  | { kind: "attribute"; key: string }                                   // stage, loan_amount, risk_grade…
  | { kind: "formField"; formTemplateId: string; fieldId: string; key?: string }; // per-template
```
Extend `RuleCondition.field` to accept this union (bump to a minor schema rev; `normalizeRule`
already centralizes upgrades, so add the coercion there). Build manual §9 anticipated this —
this is where it lands.

### 5b. Reuse the platform's `dependsOn` operand model (P1)
The admin dynamic-form builder already has a native conditional primitive: each section/field
has a **`dependsOn`** (show/hide based on another field's value — manual §6a). That is the
platform's existing "condition" grammar. **Align `conditions.rules` to the same operand shape
and operator set** (Antigravity: read the exact `dependsOn` schema — operators + value shape —
per manual §12 Q5). If the workflow condition model and the form `dependsOn` model are
isomorphic, the eventual backend can evaluate both with one evaluator, and authors learn one
mental model. This is the difference between "a second bespoke condition system" and "the same
condition system, one level up."

### 5c. Tighten operators + validation (P2)
- `OPERATORS` (vocabulary.ts) is sensible. Add `is_empty` / `is_not_empty` for optional
  form fields, and range help for numeric (the matrix cares about thresholds).
- Validate on save: numeric conditions must parse (`ruleEngine.evalCondition` already guards,
  but the builder should block a non-numeric value at author time, not silently never-match).
- `days_in_stage` is `unconfirmed` — keep it gated; it implies an SLA timer the backend may
  not track (manual open question).

### 5d. Keep the P1 event scoping honest as fields go live (P2)
When 4b brings real form fields in, extend `APP_DATA`/`EventDef.condFields` so the new live
fields only appear under events where they exist on the request (e.g. application form fields
under `REQUEST SUBMITTED` / `LOAN APPROVED`, not under `FISERV LOAN`). The scoping machinery
already exists (`allowedFieldsForEvent`); just feed it the live field keys.

---

## 6. PILLAR 3 — Actually impact outputs

This is the biggest gap and the most important to the user. Right now **nothing happens** when
a rule matches — `lib/ruleEngine.ts` is a read-only simulator over `lib/platformData.ts` seed
data, and `describeActions()` only renders text. There is **no executor**.

### 6a. Introduce an action-execution contract (P1)
Define, per action, *how* it impacts the platform — the real sink from build manual §8. Add an
`execution` descriptor to each `ActionDef`:
```ts
interface ActionExecution {
  sink: "novu" | "workflows" | "credit" | "documents" | "none";
  method?: "POST" | "PATCH";
  // template of the call; params filled from RuleOutput.params + request context
  endpoint?: string;
  status: "executable-now" | "backend-required" | "mocked-surface";
}
```
Concrete mapping (verified surfaces from the manual):
| Action | Sink | Status |
|---|---|---|
| `notify` | **Novu inbox** (already wired in admin) | **executable-now** — do this first |
| `assign_user` | `workflows` request (assignee) | executable once endpoint confirmed |
| `change_stage` | `workflows` request stage | executable once endpoint confirmed |
| `add_tag`/`remove_tag` | `workflows` request tags | executable once confirmed |
| `route_to_queue`, `set_underwriting_result` | `workflows` underwriting | backend-required |
| `escalate to authority` (`assign_authority`) | **authority evaluator → assign** (see §7) | backend-required |
| `request_signature`, `request_document`, `assign_checklist`, `run_extraction`, `pull_credit` | `documents` / `credit` | backend-required |
| `make_offer` | `/offers` — **mocked-surface** in test | gated |
| `trigger_booking` | `/credit/booking-events` — can't fire locally | gated |
| `log_event` | System Events — **mocked-surface** | gated |

### 6b. Prove one real action end-to-end (P1)
Pick **`notify` via Novu** — it's already wired in the admin and lowest-risk. Build the thin
executor path (server route → Novu trigger) and make a saved, enabled rule *actually* send an
in-app notification when its event fires against a real request. One real action end-to-end
converts the whole thing from "mockup that reads convincingly" to "it does something." Then
add `assign_user` and `change_stage` as the `workflows` write endpoints get confirmed.

### 6c. Separate "simulate" from "execute" in the UI (P2)
`SimulationPanel` is genuinely useful — keep it as **preview** ("this rule would match these N
requests / perform these actions"). But label it *Simulation*, and add an **execution status
chip** per action (executable-now / backend-required / gated) drawn from 6a, so authors know
which effects are live vs pending. Never let the UI imply an action runs when it's gated.

### 6d. Write-back needs an audit trail (P2)
Any real action must log to a run history (`components/WorkflowActivity.tsx` already simulates
this). When execution lands, persist actual runs (workflow id, request id, event, actions
performed, result) so the effect is observable and reversible-in-review. This is also the
natural home for the System Events tie-in once that surface is real.

---

## 7. Approval Authority — from a table to a decision (P1)

The matrix is stored but **inert**: grep confirms there is **no evaluator** — nothing takes a
request and returns "which authority owns this / auto-approve or escalate." That evaluator is
the entire point of the segment. Build it as a pure, testable function (mirrors
`ruleEngine.ts`'s style):

```ts
// lib/authorityEngine.ts  (new)
interface AuthorityDecision {
  authority: AuthorityRecord | null;   // the lowest level whose matrix covers this request
  lane: "auto-approve" | "manual" | "escalate" | "none";
  escalationChain: AuthorityRecord[];  // resolved via escalationId until a level covers it
  reason: string;                      // "loan $310k > Junior Analyst $90k → escalate to …"
}

function decideAuthority(input: {
  amount: number; riskGrade: string; product: "Term Loan" | "Line of Credit";
}, authorities: AuthorityRecord[]): AuthorityDecision;
```
Rules (from the model's intent): sort authorities by `limit` asc (the service already returns
them that way); pick the **lowest level** whose `limit >= amount` **and** `riskGrade` floor is
met **and** `product` matches (`All` wildcard). If that level `autoApprove` → lane
`auto-approve`; else `manual`, assigned to its `userIds`. If **no** level covers the request,
walk `escalationId` up the chain; surface the resolved `escalationChain`. Return a human
`reason` for the audit trail.

**Where it plugs into outputs (the seam that matters):**
- The `escalate to authority` **action** (§6a) should call `decideAuthority()` and assign to
  the resolved level's members / next escalation — not to a free-text authority name.
- On a **LOAN APPROVED / underwriting decision** event, a workflow can run the evaluator to
  auto-route: covered + autoApprove → set result Auto Approved; otherwise → assign to the
  owning authority; over-limit → escalate. This is exactly the admin's existing **"Auto
  Approved" underwriting lane** made configurable (manual §8).
- Add a **matrix preview** in the Approval Authorities UI: "a $310k / grade B / Term Loan
  request → escalates to Credit Committee." Turns the table into an explainable decision.

**Honesty guardrail:** the admin has **no role/authority ladder today** (manual §13) — this is
**net-new** and needs backend support to truly gate an approval. Until then, the evaluator
runs client-side over real request attributes (amount/grade/product are verified fields) and
its *output* is an **assignment/notification** (executable-now), not a hard approval block.
Badge the "hard gate" behavior as `backend-required`.

---

## 8. Tenant & identity correctness (P0)

Threaded through the gaps above, one theme: **one real org, everywhere.**
- Replace `DEMO_ORG_ID = "test-org-uuid-999"` with the session org from `/iam/users/me`.
- Ensure the org that scopes **persistence** (Supabase `workflows`/`approval_authorities`)
  equals the org that scopes the **platform bridge** (`LANDJOURNEY_ORG_ID`). Today they differ.
- Confirm Supabase RLS keys off that same org (the migrations added tenant RLS "matching the
  workflows-table idiom" — verify the policy uses the real org id, not the demo constant).
- In the Angular embed none of this is manual — the interceptor carries org; this repo just
  needs to stop pretending with a constant.

---

## 9. Visual & interaction alignment (P2, but do it early)

Cheap now, expensive later. Converge tokens so the Angular port is a copy:
- **Accent:** swap indigo/violet `--accent` for admin teal **`#4FC6A5`**; primary buttons,
  toggles, "IF" token chips.
- **Type:** Inter (already close); match the admin's weight/scale in `lj-page` headers.
- **Icons:** Material Symbols (the admin uses ligature icons); replace emoji field-group icons
  (`FIELD_GROUPS`) with the Material equivalents used in the embed.
- **Chrome:** wrap each surface in an `lj-page`-equivalent (title + subtitle + right-aligned
  action bar) so it drops into the admin header pattern. The current glass/rounded cards are
  fine as inner content.
- **Builder parity:** the admin's Dynamic Form builder has **Edit JSON (Monaco)**, **Preview**,
  and **version history** (manual §6a). The Workflow Creator already exposes raw Rule JSON
  (`<details>` block) — graduate it to a proper JSON editor and add version history to match
  the sibling builder authors already know.

---

## 10. File-by-file refinement checklist (this repo)

Grouped by pillar; `[P0/P1/P2]` priority.

**Inputs**
- `[P0] lib/api.ts` — remove `DEMO_ORG_ID`; derive org from a new `/api/platform/me`.
- `[P0] .env.local` — set `LANDJOURNEY_API_TOKEN`; once known, `LANDJOURNEY_EXTRA_HEADERS`.
- `[P1] lib/platform.ts` — add per-form field fetch (`/documents/templates/forms/{id}`) →
  `LiveField[]`; extend `LiveVocabulary`.
- `[P1] lib/liveVocabulary.ts` — overlay real form fields into an Application-Data field group.
- `[P0] .env.local.example` — retitle from **"QuoteCheck"** (stale template header) to
  Workflow Creator; it still documents the wrong app.

**Conditions**
- `[P1] lib/vocabulary.ts` — `RuleCondition.field` → attribute|formField union; update
  `normalizeRule` coercion; keep confidence badging on live fields.
- `[P1] components/RuleSentence.tsx` + `components/TokenPicker.tsx` — render/select ID-bound
  form fields; group live fields per template.
- `[P1]` align operator set + value shape to the admin `dependsOn` model (needs §12 Q5).

**Outputs**
- `[P1] lib/vocabulary.ts` — add `execution` descriptor to every `ActionDef` (§6a table).
- `[P1] app/api/execute/route.ts` (new) — server executor; implement `notify`→Novu first.
- `[P1] lib/authorityEngine.ts` (new) — `decideAuthority()` + escalation chain (§7).
- `[P1] components/ApprovalAuthorities.tsx` — add a matrix "decision preview".
- `[P2] components/SimulationPanel.tsx` — relabel Simulation; add per-action execution-status chip.
- `[P2] components/WorkflowActivity.tsx` — persist real run history when execution lands.

**Alignment / identity / theme**
- `[P0]` unify persistence org with platform org (§8); verify Supabase RLS uses real org.
- `[P2] app/globals.css` / `tailwind.config.ts` — teal `#4FC6A5`, Material Symbols, `lj-page`
  chrome; keep `WorkflowCreator.tsx` / `ApprovalAuthorities.tsx` shell-agnostic for the port.

---

## 11. Loose ends spotted in the scan
- `.env.local.example` header still reads **"QuoteCheck — Environment Variables"** (the repo's
  original template origin — see the very first commit "QuoteCheck contractor quote verifier").
  Rename; it misleads anyone configuring the app.
- `DEMO_ORG_ID` (`test-org-uuid-999`) ≠ `LANDJOURNEY_ORG_ID` (`1577b554-…`) — the split-brain
  tenant described in §4c/§8.
- `package.json` `name` is `"workflow-creator"` but the Prisma model/UI say "LJ Decisioning
  Engine" / "Workflows" — settle the name (§3).
- `assign_authority` is badged `verified` in `vocabulary.ts`, but the admin has **no** authority
  ladder — it's `verified` only because *this app* now defines the matrix. Keep the badge, but
  its **execution** is `backend-required` (§6a/§7) — make that explicit so the demo doesn't
  imply a hard approval gate exists in the platform.
- Aspirational events (DOCUMENT UPLOADED, SIGNATURE COMPLETED, etc.) are correctly gated, but
  System Events is **client-mocked** in the admin (manual §4) — none of them can trigger live
  yet. Keep them behind the confidence gate until §12 Q3 resolves.

---

## 12. Prioritized roadmap
- **P0 (make it real & correct):** wake the bridge (token + interceptor headers); one real org
  everywhere; fix env-example title. → pickers show live data, saved rules live in the right tenant.
- **P1 (the three pillars land):** per-form field fetch + ID-bound conditions; action-execution
  contract with `notify`→Novu proven end-to-end; `authorityEngine.decideAuthority()` wired into
  the escalate action + a matrix preview.
- **P2 (polish & parity):** teal/Material/`lj-page` theming; Simulation vs Execute labeling +
  status chips; JSON editor + version history; run-history persistence.

---

## 13. Acceptance criteria (how we know it aligned)
1. Header chip reads **"● Live vocabulary"**; condition pickers list real users, retailers,
   template stages, and **real form fields** (by id).
2. A condition can be authored against a real per-template field and round-trips through
   `normalizeRule` as an ID-bound ref.
3. A saved, enabled rule with a `notify` action **actually posts a Novu notification** when its
   event fires on a real request.
4. `decideAuthority()` returns the correct owning level + escalation chain for a
   $/grade/product input, and the "escalate to authority" action uses it.
5. Persistence and platform data share **one real org id**; Supabase RLS enforces it.
6. Both surfaces render in admin teal/Material chrome and carry no dependency on the parallel
   demo nav — ready for the Angular port.

---

## 14. Open questions (carried from the build manual — resolve in the admin repo)
1. **Interceptor headers** beyond the bearer (§4a #2 / manual §12 Q2) — unblocks *all* live input.
2. **`workflows`-service write endpoints** for assign / stage / tag / underwriting result — unblocks real outputs.
3. **`dependsOn` exact schema** (§5b / manual §12 Q5) — so conditions share the platform's grammar.
4. **Real event stream** vs mocked System Events (manual §4/§12 Q3) — which triggers can fire live.
5. **Backend approval gating** — can an authority decision *hard-gate* an approval, or only assign/notify until a service exists?

### Change log
- **2026-07-14 (v1)** — First alignment/refinement pass. Scanned live deploy (`f5812b3`) +
  full source. Identified the three-pillar gaps (dormant bridge / non-ID-bound conditions /
  no executor & no authority evaluator), the split-brain tenant, and the parallel-console
  alignment debt; prescribed fixes with a file-level checklist and acceptance criteria.
