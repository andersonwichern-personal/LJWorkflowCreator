# Error Handling & Unusual Cases — Design for the 12 Lending Exceptions

**Created:** 2026-07-14
**Baseline commit:** `48d17b6` (same baseline as the hardening implementation plan)
**Answers:** the 12 named exception scenarios (borrower entities, dual roles, shared
documents, staff departure, post-approval changes, branch transfer, rescheduled reminders,
authority gaps, duplicate entities, reopened workflows, integration outages, concurrent
edits).
**Relationship to prior docs:** this is a sibling of, and amends,
`2026-07-14_workflow-creator-hardening-implementation-plan_v1.md`. It does not repeat that
plan's phases; it adds the entity/lifecycle/concurrency layer those phases assumed away, and
issues explicit **amendments** (§14) where a case exposes a real conflict with what's
already specified (most notably: reopen vs. idempotency).

> **Honesty flag, stated once:** none of the 12 cases below have a confirmed data model on
> the live admin platform today. I never observed a `/customers` API response, a document
> versioning model, or a branch/org-unit concept in the live scan (build manual §3/§7 lists
> `iam`/`workflows`/`documents`/`credit` as the confirmed services; none of them were probed
> for entity-relationship shape). Everything in this doc is **prototype-side design**: it
> specifies the shape this system needs, and the same tables/services stand in as the
> reference implementation until the admin repo confirms or replaces them. Where I'm
> designing something the real platform may already solve differently, I say so inline.

---

## 0. Cross-cutting principles — six mechanisms, reused by all 12 cases

Writing 12 independent patches would duplicate the same four ideas twelve times and drift.
Instead, every case below is built from these primitives, named once here:

| # | Principle | One-line rule |
|---|---|---|
| **A** | **Alias, don't rewrite** | History is immutable. When a person/record is superseded (departs, merges, reopens), old rows keep their original values; a pointer (`mergedIntoId`, `supersededBy`, a new `generation`) redirects *future* lookups. Audit trails never get retroactively edited. |
| **B** | **Broken-reference detection is one mechanism, not many** | The hardening plan's Phase 2 §4.5 audit-refs endpoint already exists conceptually (broken instance `ScopeRef`s). This doc routes offboarding (case 4), branch transfer (case 6), and merges (case 9) through the *same* scanner instead of inventing three finders. |
| **C** | **Snapshot at decision time, re-validate on change** | Every consequential decision (`decideAuthority`'s output, a scheduled reminder's fire time, an approval task's eligibility) is computed from a snapshot of its inputs. A change-detector compares current vs. snapshot and reconciles — it does not silently let stale decisions stand, and it does not silently discard them either. |
| **D** | **Generation counters reset idempotency, not history** | `controls.oncePerRequest` (hardening plan §1a) needs a scope narrower than "forever." A request has a `generation`; idempotency keys include it. Reopening bumps the generation — old firings stay in the audit log, new firings are newly eligible. |
| **E** | **Optimistic concurrency, not silent last-write-wins** | Every user-editable record gets a `version` column. Updates are conditional on the version the editor last read. A mismatch is a 409, not silent data loss. |
| **F** | **Circuit breakers + honest status, not retries forever** | External calls (already patterned in `lib/platform.ts`'s `Promise.allSettled` + graceful fallback) get a per-sink failure counter, a cooldown, and a status that is distinguishable from "action failed for a real reason." |

Table §13 gives the consolidated schema; each case section below references principles by
letter instead of re-deriving them.

---

## 1. A borrower has multiple entities

**Scenario:** John Smith personally guarantees "Smith Farms LLC," is 60% owner of "Smith
Trucking Inc," and is himself an Individual borrower on a personal LOC. Three legal
entities, one underlying person, one true risk exposure.

**Why it breaks today:** nothing in the prototype (or, per the honesty flag, confirmed on
the live platform) models a person↔entity relationship. `lib/platformData.ts`'s
`mainBorrower` is a flat string. `FIELDS.custtype` is Business/Individual with no linkage
between them. This is also the direct cause of **T6** from the hardening-and-failure-modes
doc: the authority matrix decisions on *per-request amount*, not aggregate exposure, because
there is no graph to aggregate over.

**Design — the relationship graph.** This, along with cases 2, 3, and 9, all reduce to the
same structural gap: the prototype's seed data assumes 1:1 (`mainBorrower: string`, one
document per request) where reality is many-to-many. There's no seventh cross-cutting
letter for this — it's not a *mechanism* like A–F, it's the specific new tables below that
fix it.
```prisma
model Customer {
  id           String   @id @default(uuid())
  orgId        String   @map("org_id")
  type         String   // "Business" | "Individual" — same enum as FIELDS.custtype
  name         String
  status       String   @default("active")   // "active" | "merged" | "archived"
  mergedIntoId String?  @map("merged_into_id") // principle A — set only when status="merged"
  version      Int      @default(1)           // principle E
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  mergedInto        Customer?               @relation("MergeAlias", fields: [mergedIntoId], references: [id], onDelete: SetNull)
  mergedFrom        Customer[]              @relation("MergeAlias")
  relationshipsFrom CustomerRelationship[]  @relation("FromCustomer")
  relationshipsTo   CustomerRelationship[]  @relation("ToCustomer")
  requestRoles      RequestCustomerRole[]

  @@index([orgId])
  @@map("customers")
}

/** Structural, standing relationships — independent of any one request. */
model CustomerRelationship {
  id            String    @id @default(uuid())
  orgId         String    @map("org_id")
  fromId        String    @map("from_id")   // the person
  toId          String    @map("to_id")     // the entity
  role          String    // "Owner" | "Officer" | "AuthorizedSigner" | "Guarantor"
  ownershipPct  Decimal?  @db.Decimal(5, 2) @map("ownership_pct")
  effectiveFrom DateTime  @default(now()) @map("effective_from")
  effectiveTo   DateTime? @map("effective_to")

  from Customer @relation("FromCustomer", fields: [fromId], references: [id], onDelete: Cascade)
  to   Customer @relation("ToCustomer", fields: [toId], references: [id], onDelete: Cascade)

  @@index([orgId, fromId])
  @@index([orgId, toId])
  @@map("customer_relationships")
}
```

**Workflow engine interaction:**
- `condFieldKind`/`FIELDS.customer_name` (currently free text, ID-bound as an instance
  `ScopeRef` per the implementation plan's Phase 2 §4.2) resolves to a `Customer.id`, not a
  label string. A condition can now say "this customer *or any entity they control*" — a
  new relationship-scoped trigger shape: `{ kind:"instance", id, includeRelated: true }` on
  the `ScopeRef`, resolved by walking `CustomerRelationship` at evaluation time. This is the
  hardening doc §2 row "any of this borrower's other loans goes delinquent" — it was listed
  as impossible; this graph is what makes it possible (still needs cross-request query
  support, so keep it flagged `unconfirmed`/`backend-required` in `ActionExecution` terms
  until the query path exists).
- **Aggregate exposure** (T6): `AuthorityInput` gains `exposure?: number` — already reserved
  as an optional field in the implementation plan's Phase 5 deferred table. This graph is
  the entity-resolution prerequisite that row was waiting on. Compute: sum `loan_amount`
  across all *open* requests where the request's `RequestCustomerRole` resolves (directly or
  via `CustomerRelationship`) to the same person, weighting guarantor exposure differently
  from direct-borrower exposure (a simple v1: guarantor exposure counts at 50%, configurable
  later — flag the weighting as a policy choice, not an engineering fact).

**UI:** the Customers section gains a "Related entities" panel (graph or simple list) on
each customer record; the ID-bound picker (Phase 2 §4.3) shows related entities inline when
picking a customer for a condition.

---

## 2. A person is both a borrower and guarantor

**Scenario:** on Request #4821, John Smith is the guarantor; on Request #5103, John Smith
(personally) is the borrower. Or, narrower: on the *same* request, one person holds two
roles (e.g., a sole proprietor who is both the business contact and a personal guarantor).

**Why it breaks today:** `FIELDS.role` (Borrower/Guarantor/Co-Applicant) is a *global*
condition field with no notion of "per request, per person." Task sections are per-role per
the platform knowledge, which is right — the gap is that role must be an **assignment**, not
an attribute.

**Design:**
```prisma
model RequestCustomerRole {
  id         String   @id @default(uuid())
  orgId      String   @map("org_id")
  requestId  String   @map("request_id")
  customerId String   @map("customer_id")
  role       String   // "Borrower" | "Guarantor" | "Co-Applicant" — reuses FIELDS.role's enum
  createdAt  DateTime @default(now()) @map("created_at")

  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@unique([requestId, customerId, role])   // same person CAN hold two roles on one request —
  @@index([orgId, customerId])              // the unique constraint is per (request, person, role),
  @@map("request_customer_roles")           // not per (request, person)
}
```
The unique constraint is deliberately `[requestId, customerId, role]`, not
`[requestId, customerId]` — that's what allows one person to hold two roles on the same
request without a schema fight.

**Workflow engine interaction:**
- `role`-scoped conditions/triggers (e.g., "when the *borrower* submits" vs. "when the
  *guarantor* submits") resolve against `RequestCustomerRole`, not a single flat field —
  already the right shape for the platform's existing per-role task sections; this just
  gives the workflow engine the same join.
- **Conflict of interest in approvals — this is the case that actually matters for
  Approval Authority.** `evaluateRequirement`'s `DecisionContext.exclusions` (implementation
  plan Phase 3 §5.2 — note: exclusions live on the evaluation *context*, not on
  `ApprovalRequirement` itself, which only carries the approver-topology types) is currently
  populated from `[preparer, rule author]`. Extend that population to be **dynamic per
  request**: at task-creation time, resolve every `RequestCustomerRole` on the request and
  add any approver who holds *any* role on it (they are the borrower, a guarantor, or a
  co-applicant) to `ctx.exclusions` — not just the person who happened to prepare the file.
  This is an additive change to the exclusion *source*, not a new contract.

**Failure mode this closes:** without the dynamic exclusion, a loan officer who is also the
guarantor on their own client's deal could sit in the `any_of` approver pool and self-approve
— a real regulatory problem, not a hypothetical one.

---

## 3. A document applies to multiple loans

**Scenario:** a customer's tax returns are uploaded once but are needed for a renewal
request, a new origination request, and an annual covenant check.

**Why it breaks today:** the admin's document model (owned by the `documents` service,
build manual §3/§6a) is organized per-template, per-request — there's no confirmed
many-to-many "this file also satisfies that request's checklist." Re-uploading is the
default failure mode, and worse, three copies can drift (one approved, two stale).

**Design — a thin junction the prototype owns; the canonical file stays in `documents`:**
```prisma
model DocumentLink {
  id         String    @id @default(uuid())
  orgId      String    @map("org_id")
  documentId String    @map("document_id")   // canonical id — from the documents service
  requestId  String    @map("request_id")
  purpose    String?   // e.g. "renewal-2026", "covenant-q1-2026"
  validFrom  DateTime? @map("valid_from")
  validUntil DateTime? @map("valid_until")    // expiry — drives the refresh trigger below
  linkedAt   DateTime  @default(now()) @map("linked_at")
  linkedBy   String    @map("linked_by")      // userId

  @@unique([documentId, requestId])
  @@index([orgId, requestId])
  @@index([orgId, documentId])
  @@map("document_links")
}
```
**Boundary, stated plainly:** this table is a *view/index* the Workflow Creator maintains
for its own condition/trigger evaluation. It is **not** a replacement for the real document
store — if the admin's `documents` service turns out to support multi-request linkage
natively (unconfirmed), this table becomes a cache of that, not a second source of truth.
Flag as `unconfirmed`/needs-admin-repo-confirmation, same posture as every other admin-side
gap in the build manual.

**Workflow engine interaction:**
- `DOCUMENT UPLOADED`/`DOCUMENT APPROVED` triggers (already gated `unconfirmed` in the
  vocabulary — their emit status is unresolved per build manual §12 Q3) fan out to every
  linked request when they *do* fire, instead of only the request the upload happened
  against. One AI-extraction run, N linked requests updated — not N uploads.
- **Expiry → refresh, using principle C:** a scheduled check (same substrate as case 7's
  `ScheduledAction`, anchored on `DocumentLink.validUntil`) fires a `request_document`
  action against every linked request when a document crosses its validity window, instead
  of silently letting a stale document sit "approved" on three requests.
- **Approval state per link, not per document:** a document can be "approved" for the
  renewal's checklist but "pending re-review" for the new origination (different
  underwriters, different context) — `DocumentLink` deliberately does not carry an approval
  status; that stays per-request in the existing Documents Review workspace, keyed by
  `(documentId, requestId)` via this junction.

---

## 4. A loan officer leaves the institution

**Scenario:** Sara, who owns 40 open requests, sits on two approval-authority levels, and
is the `assign_user` target in six active rules, resigns.

**Why it breaks today:** nothing reassigns on departure. Rules silently point at a disabled
user forever; the broken-refs audit (implementation plan Phase 2 §4.5) would eventually
*report* this, but reporting isn't reassigning, and open work doesn't wait for a nightly scan.

**Design — this is principle B applied as a mutation, not just a report:**
```ts
// lib/services/reassignment.ts
export interface ReassignmentReport {
  workflowsUpdated: { id: string; name: string; field: string }[];
  authoritiesUpdated: { id: string; name: string }[];
  tasksReassigned: { id: string; requestId: string }[];
  requestsFlagged: string[];   // open requests assigned to fromUserId with no auto-safe target
}
export async function reassignUser(
  orgId: string,
  fromUserId: string,
  toUserId: string,
  opts: { reason: string; actorId: string }
): Promise<ReassignmentReport>
```
Runs the **same instance-ref scanner** as the Phase 2 broken-refs audit (principle B), but
in mutate mode: for every `assign_user`/`notify` action param and every
`ApprovalAuthority.requirement` approver whose `Approver.id === fromUserId` (the `{id,
label}` shorthand from implementation plan contract 1c), redirect to `toUserId`. Logged to the consolidated `PlatformAuditLog` (§13) as one `USER_REASSIGNED`
entry per touched record, not a bulk unstructured note — each entry is independently
auditable ("why does this rule assign to Omar now?" → one log lookup).

**What does NOT change (principle A):** every historical `ApprovalDecision.approverLabel`
and every past `RuleExecution` row keeps Sara's name exactly as it was recorded. Offboarding
redirects *future* resolution; it does not rewrite *past* attribution. That distinction is
the whole point of principle A — an examiner asking "who approved this in March" must get
March's answer, not April's org chart.

**Open work with no safe auto-target** (`requestsFlagged`): if `toUserId` is a specific
person rather than a team/pool, the report still surfaces the 40 open requests for a human
to triage — reassignment automates the *reference rewiring*, not the judgment call of who
inherits a live pipeline. Team-pool targets (`ASSIGNEES` teams already exist in the
vocabulary) sidestep this: reassigning to a team pool, not a person, is the recommended
default.

---

## 5. An application changes after approval

**Scenario:** a request is approved at $250,000, grade B, Term Loan. Before booking, the
requested amount is revised to $340,000. Does the standing approval still hold?

**Why it breaks today:** `decideAuthority()` (already implemented in `lib/authorityEngine.ts`
at baseline; extended for quorums in implementation plan §5.2) is computed once, at whatever
moment it's called, over live inputs — there is no snapshot to compare *against*, so a
post-approval edit is invisible to the authority engine. Nothing detects that the facts
underneath a decision moved.

**Design — principle C, made concrete:**
```prisma
model DecisionSnapshot {
  id           String   @id @default(uuid())
  orgId        String   @map("org_id")
  requestId    String   @map("request_id")
  decisionType String   @map("decision_type")   // "underwriting" | "authority"
  inputs       Json                              // {amount, riskGrade, product} at decision time
  outcome      Json                              // AuthorityDecision (or equivalent) at decision time
  supersededBy String?  @map("superseded_by")    // principle A: points at the re-decision, if any
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([orgId, requestId])
  @@map("decision_snapshots")
}
```
**Materiality check** (a policy table, not a hardcoded constant, so it can be tuned without a
deploy): `amount` changed beyond a configurable tolerance (default ±5%), `riskGrade`
changed at all, or `product` changed at all → **material**. On a material change: fire a new
internal trigger `REQUEST_CHANGED_POST_DECISION`, revert the request's stage to a
configurable "requires re-approval" stage (default: back to `Processing`), re-run
`decideAuthority()` against the new inputs, write a **new** `DecisionSnapshot` with
`supersededBy` back-filled on the old one, and — if the new authority level differs from the
old one — escalate exactly like a fresh authority gap (case 8 shares this path). A
non-material change (amount moved $250,000 → $252,000) logs the delta for the audit trail
but does **not** revert stage or force re-approval — this is what keeps the mechanism from
being a nuisance on every trivial edit.

**Explicit distinction from case 10 (do not conflate):** this is a same-generation
reconciliation — the request was never closed. Case 10's `generation` counter (principle D)
is a *different* mechanism for a *different* trigger (explicit close→reopen). A material
edit does **not** bump `generation`; a reopen does **not**, by itself, imply a material
change. They compose independently: a reopened request (new generation) that also changes
its amount gets both a fresh idempotency window *and* a fresh `DecisionSnapshot`.

---

## 6. A loan is transferred between branches

**Scenario:** a request originated at the Ames branch is transferred to the Cedar Rapids
branch mid-process (relocation, workload balancing, retailer program change).

**Why it breaks today:** `retailer`/branch is already an ID-bound `ScopeRef` field per the
implementation plan's Phase 2 §4.2 — the transfer itself isn't the hard part. The hard part,
confirmed by reading the baseline `prisma/schema.prisma`, is that **`ApprovalAuthority` has
no branch/org-unit dimension at all** — its matrix is `limit`/`riskGrade`/`product`, nothing
else. If two branches run different approval policy, today's matrix can't express that; it's
a genuine schema gap, not a workflow-engine gap.

**Design — sequenced, not all at once:**
1. **Now (safe, small):** add trigger-side branch awareness via the `TriggerRef.scope`
   field already reserved in the implementation plan's Phase 1 contract (§1a) — a rule can
   be scoped to fire only for one retailer/branch instance. Add a `BRANCH_TRANSFERRED`
   trigger event, condition-scoped like any other. On transfer: re-evaluate every
   branch-scoped **armed** rule against the new branch (principle C — the scope binding is a
   decision input like any other); rules that no longer apply simply stop matching going
   forward. **Past firings are not retracted (principle A)** — a rule that already assigned
   the request to Ames-branch staff before the transfer keeps that history; it doesn't
   silently reassign to Cedar Rapids without a human or a new rule doing so explicitly.
2. **Deferred, flagged honestly:** branch-scoped `ApprovalAuthority` (a `branchId` column,
   possibly a different matrix per branch) is a real schema change with real policy
   implications (does Cedar Rapids inherit Ames' matrix, or need its own?) that shouldn't be
   guessed at. This is a **new row for the implementation plan's Phase 5 deferred table**
   (§14), not something this doc resolves — the org needs to decide whether authority is
   branch-scoped at all before a schema is worth writing.
3. **Reassignment on transfer** reuses case 4's `reassignUser`-style mechanism, generalized
   to `reassignBranch(orgId, requestId, fromBranch, toBranch, opts)`: touches the same class
   of instance refs (assignees who are branch-specific, e.g. "Booking Team — Ames") via the
   same broken-refs scanner (principle B), logged to `PlatformAuditLog`.

---

## 7. A date changes after reminders have already been scheduled

**Scenario:** a covenant review is scheduled with a reminder 5 days before the maturity
date. The maturity date is later amended. The already-scheduled reminder is now wrong — too
early, too late, or referencing a date that no longer exists.

**Why it matters here:** this is squarely inside the hardening plan's **Phase 5 "deferred"
timers row** — "no scheduler in a serverless prototype." This section does not unblock the
scheduler (still blocked on the same thing), but it fills in the **data model** so that when
a scheduler does exist, rescheduling is correct by construction instead of a bolt-on.

**Design — reminders are relative references, never baked-in absolute times:**
```prisma
model ScheduledAction {
  id            String   @id @default(uuid())
  orgId         String   @map("org_id")
  workflowId    String   @map("workflow_id")
  requestId     String   @map("request_id")
  actionIndex   Int      @map("action_index")    // index into rule.actions[]
  anchorField   String   @map("anchor_field")    // a ConditionFieldRef key, e.g. "maturity_date"
  offsetMinutes Int      @map("offset_minutes")  // negative = before anchor (e.g. -7200 = 5 days)
  runAt         DateTime @map("run_at")          // CACHE of anchorValue + offset — always derived
  status        String   @default("pending")     // "pending" | "fired" | "canceled" | "superseded"
  supersedes    String?  @map("supersedes")       // principle A: prior ScheduledAction.id
  createdAt     DateTime @default(now()) @map("created_at")

  @@index([orgId, status, runAt])
  @@index([orgId, requestId, anchorField])
  @@map("scheduled_actions")
}
```
**The rule, stated once so it can't be gotten wrong later:** `runAt` is never authored
directly — it is *always* recomputed from `anchorField`'s current value + `offsetMinutes`.
When a `REQUEST_FIELD_CHANGED` event fires for a field that matches some pending
`ScheduledAction.anchorField` on that request: mark the old row `superseded`, insert a new
row with the recomputed `runAt` and `supersedes` pointing at the old id. A scheduler that
polls `status='pending' AND runAt <= now()` never needs to know a date changed — it just
never sees the superseded row again. This is principle C (snapshot + reconcile-on-change)
applied to time instead of to a decision.

**Business calendar, stated as a dependency, not solved here:** `offsetMinutes` in calendar
time vs. business-day time is a real distinction (hardening doc T7) — "2 business days
before" is not "2880 minutes before" over a weekend. Resolving `runAt` needs a
holiday/business-day calendar as an input; that calendar is itself deferred alongside the
scheduler. Don't compute `runAt` in raw minutes once that calendar exists — this schema
doesn't block the fix, it just doesn't pretend to solve it early.

---

## 8. A user lacks sufficient approval authority

Two distinct sub-cases, both real, requiring different handling:

### 8a. No level covers the request at all (`decideAuthority` returns `lane: "none"`)
Already detected — `lib/authorityEngine.ts` returns exactly this case at baseline — but
today the caller just gets a `reason` string back. **This must be a hard, visible stop, not a quiet log line.**
Design: when `/api/execute`'s `assign_authority` handler receives `lane: "none"`, it does not
silently no-op — it creates an `AuthorityGap` record (part of §13's consolidated audit
table, `type: "AUTHORITY_GAP_DETECTED"`) that surfaces in the Approval Authorities UI as an
actionable banner ("3 requests have no covering authority level — configure one or route
manually") and blocks any action further downstream that depends on an authority decision
existing (e.g., an auto-approve action must refuse to run against a gap, per the linter's
`GATED_TOKEN_ARMED` check in the implementation plan's Phase 4 §6.3 — this is the same
mechanism, just a new trigger for it).

### 8b. An approver was eligible when a task was created, but no longer is
The deal grows mid-review (loan amount revised from $80,000 to $310,000 while a Junior
Analyst's task is still open) — this is **case 5's materiality mechanism, applied to an
already-open `ApprovalTask`**, not a separate system. When a `DecisionSnapshot` supersession
(case 5) fires and the request has an **open** `ApprovalTask`, check whether the task's
`authority.limit`/`riskGrade`/`product` still `covers()` the new inputs
(`authorityEngine.covers()` already exists — reuse it directly, don't reimplement). If it no
longer covers: mark the task `superseded` (principle A — decisions already cast on it are
kept as historical context, not deleted), create a **new** `ApprovalTask` at the correct
(possibly escalated) level, and note on it "escalated mid-review: amount grew from $80,000
to $310,000" (pulled straight from the `DecisionSnapshot` diff). Prior decisions are **not**
auto-carried into the new task by default — a decision made against a smaller number isn't
automatically valid for a larger one; a `sequence`-type requirement can special-case
"earlier steps carry forward" as a per-level configuration flag if a bank actually wants
that, but the safe default is "start the new task's voting fresh."

---

## 9. A duplicated borrower or entity is discovered

**Scenario:** "Prairie Gold Farms LLC" and "Prairie Gold Farms" turn out to be the same
entity, entered twice by two different staff members over two different intake links. Both
have open requests, documents, and relationships.

**Design — principle A's alias mechanism, already reserved on `Customer` in §1:**
```ts
// lib/services/merge.ts
export interface MergeReport {
  requestRolesRepointed: number;
  relationshipsRepointed: number;
  documentLinksRepointed: number;
  ruleRefsRepointed: { workflowId: string; name: string }[];
  exposureRecomputed: { before: number; after: number };
}
export async function mergeCustomers(
  orgId: string,
  survivorId: string,
  duplicateId: string,
  opts: { actorId: string; reason: string }
): Promise<MergeReport>
```
Steps: repoint every `RequestCustomerRole.customerId`, `CustomerRelationship.fromId/toId`,
and `DocumentLink`-adjacent customer reference from `duplicateId` to `survivorId`; run the
**same instance-ref scanner as case 4/6** (principle B) over rule `ScopeRef`s pointing at
`duplicateId`; set `duplicateId.status = "merged"` and `mergedIntoId = survivorId`
(principle A — the duplicate row is never deleted, so any historical log entry that recorded
`duplicateId` still resolves by walking the alias, one hop, forever).

**The reason this is more than data hygiene:** a duplicate customer means case 1's aggregate
exposure was being **undercounted** — two $200,000 loans looked like two unrelated $200,000
exposures instead of one $400,000 exposure on one borrower. `mergeCustomers` therefore always
ends by recomputing exposure (case 1's aggregate calculation) and, if the recomputed total
now breaches the currently-assigned authority level on any open request, runs the **exact
same escalation path as case 8b** — a merge can *discover* an authority gap, it doesn't get
a separate gap-detection mechanism.

**Concurrency guard:** merges must take an optimistic-concurrency lock (principle E, §12) on
both `survivorId` and `duplicateId` for the duration of the operation — a merge racing an
unrelated edit to the duplicate record is exactly the scenario case 12 exists to prevent.

---

## 10. A workflow is canceled and later reopened

**Two readings, both handled, kept explicitly separate:**

### 10a. A request is closed, then reopened months later
**Why it breaks today — the direct conflict:** the implementation plan's `controls.
oncePerRequest` (Phase 1 §1a) is a permanent-forever idempotency guard keyed on
`(workflowId, requestId)`. Taken literally, a rule that already fired once on a request
**can never fire again for that request**, even after a legitimate reopen three months
later with entirely new facts. This is a real bug in the existing spec, not a hypothetical —
flagging and fixing it is the point of this subsection.

**Fix — principle D, and this is the formal amendment (see §14 for the doc-level
correction):** the idempotency key becomes `(workflowId, requestId, generation)`, where
`generation` starts at 1 and increments by exactly one on every explicit reopen. Reopen and
close events are recorded in the consolidated `PlatformAuditLog` (§13,
`type: "REQUEST_REOPENED" | "REQUEST_CLOSED"`, `payload: {generation}`); the Phase 4 `fire`
route's duplicate check (implementation plan §6.1) reads the **latest** generation for the
request before querying `rule_executions` for a prior `FIRED` row, and — this is the only
code change required beyond adding the column — includes `requestGeneration` in the
`rule_executions` row it writes (already anticipated: the implementation plan's Phase 4 §6.1
independently notes new execution outcomes get added to `EXECUTION_STATUSES`; this adds one
column, not a new status).

**Reopen also resets state, not just idempotency:** on reopen, (a) stage resets to a
configurable landing stage — **not** wherever the request happened to sit when closed,
because that stage's meaning may no longer hold; (b) any still-`open` `ApprovalTask` is
marked `superseded` with reason "request reopened" (principle A — decisions already cast
stay on the record); (c) every linked document (case 3's `DocumentLink`) is checked against
`validUntil` and flagged for refresh if expired. Reopening is a deliberate re-entry, not a
resume-from-where-you-left-off.

### 10b. An automation (rule) is disabled, then re-enabled
Different mechanism, much simpler: **no backfill by default.** A rule that was off while
five qualifying events happened does not retroactively fire on those five — `enabled` only
gates *future* evaluation. If a lender genuinely wants to catch up, that's exactly what the
implementation plan's Phase 4 §6.2 **backtest** feature is for — offer "run this rule against
the last N days" as an explicit, reviewable action a human triggers, never an automatic
consequence of flipping the toggle back on.

---

## 11. An external integration is temporarily unavailable

**Scenario:** Novu is down, or the admin's live API bridge (`lib/platform.ts`) is
unreachable, or a future core-banking write endpoint times out mid-action-dispatch.

**What already exists and should be generalized, not replaced:** `fetchLiveVocabulary()`
already uses `Promise.allSettled` per-section and degrades to `{source:"static", reason}`
instead of failing the whole picker (build manual / alignment doc pattern). That's principle
F, half-built, on the *read* side only. This section extends it to the **write/action**
side, where a failure is more consequential (a dropped notification is bad; a silently
dropped booking-status write is worse).

**Design:**
- **Per-sink circuit breaker** (novu, the admin read bridge, any future write endpoint):
  track consecutive failures in a small in-memory (or lightweight table-backed, given
  serverless cold starts reset in-memory state) counter per sink. N consecutive failures
  within a window → the circuit **opens**: further calls to that sink fail fast with
  `status: "INTEGRATION_UNAVAILABLE"` instead of hanging/retrying, for a cooldown period,
  then a single half-open trial call decides whether to close the circuit again.
- **A new, distinct status** — join it to the implementation plan's Phase 4 `EXECUTION_STATUSES`
  extension list (which already grows in that phase for `SKIPPED_DUPLICATE`/
  `PAUSED_RATE_LIMIT`/`PAUSED_ORG`): add `INTEGRATION_UNAVAILABLE`, kept **distinct** from
  generic `ERROR`. The distinction is load-bearing for the linter (implementation plan
  Phase 4 §6.3): a rule with a history of `ERROR` is probably misconfigured (real linter
  signal); a rule with a history of `INTEGRATION_UNAVAILABLE` is a healthy rule hitting a
  flaky dependency (not a linter signal — don't let outage noise train the linter to
  distrust good rules).
- **Retry, then dead-letter, then manual replay:** `RuleOutput.onFailure` (`retry|skip|halt`,
  already in the Phase 1 v3 contract) governs the automated response; an action that
  exhausts its retry lands in `rule_executions` with status `ERROR` or
  `INTEGRATION_UNAVAILABLE` and is queryable in `AuditLogs` with a **"retry now"** button
  that re-dispatches just that one action through the same executor path — not the whole
  rule, not a re-evaluation, just the one stuck side effect.
- **Status strip, reusing an existing pattern:** the "● Live vocabulary / ○ Demo vocabulary"
  chip (`describeSource()`) is exactly the right shape for this — generalize it into a small
  per-sink health strip (Novu / admin bridge / future write endpoints) rather than inventing
  a new status-display convention.

---

## 12. Two users edit the same record simultaneously

**Scenario:** two admins open the same Workflow (or the same Approval Authority level) in
two tabs; both edit; the second Save silently overwrites the first.

**Why it breaks today, confirmed by inspection:** `WorkflowService.updateWorkflow` and
`ApprovalAuthorityService.updateAuthority` both do `findFirst` (ownership check) then
`update` with no version/timestamp guard — textbook last-write-wins, and the loss is
silent. `updatedAt` exists (`@updatedAt` on both models) but nothing reads it back on write.

**Design — principle E:**
```prisma
model Workflow {
  // existing fields unchanged
  version Int @default(1)
}
model ApprovalAuthority {
  // existing fields unchanged
  version Int @default(1)
}
```
Every mutating service method gains a required `expectedVersion: number` parameter. The
update becomes a conditional write:
```ts
const result = await prisma.workflow.updateMany({
  where: { id, orgId, version: expectedVersion },
  data: { ...changes, version: { increment: 1 } },
});
if (result.count === 0) {
  const current = await prisma.workflow.findFirst({ where: { id, orgId } });
  if (!current) throw new NotFoundError();
  throw new ConflictError({ currentVersion: current.version, current });
}
```
The route surfaces a `409` with the current server-side record attached. **UI response,
kept intentionally simple for v1** (a real three-way merge is out of scope): a dialog with
"View their version" (read-only diff), "Overwrite anyway" (retries the save with the fresh
`expectedVersion`, i.e., an explicit, informed last-write-wins), and "Reload and lose my
changes." No silent path exists that loses data without the user choosing it.

**Cheap early warning (optional, before the 409 even happens):** while an editor is open and
`dirty`, poll `updatedAt` for the record at a low frequency; if it changes underneath the
open editor, show a non-blocking "someone else is editing this" toast immediately, rather
than waiting for the eventual Save to discover the conflict. This is presence-lite, not full
collaborative editing — it buys a warning, not a guarantee (the 409 is the guarantee).

**Extends to the operations this doc introduces:** `reassignUser` (case 4),
`mergeCustomers` (case 9), and the reopen handler (case 10) all mutate multiple rows across a
transaction — each must take the same `expectedVersion` guard on every row it touches, or a
bulk operation can race a targeted edit the same way two direct edits can race each other.

---

## 13. Consolidated new schema

One append-only audit table replaces what would otherwise be four narrow, redundant ones
(a `ReassignmentLog`, a `MergeLog`, a `RequestLifecycleEvent` table, and an `AuthorityGap`
table were each drafted case-by-case above and are folded into this single table with a
`type` discriminator — reviewed and merged before finalizing this doc, see §15 review notes):

```prisma
model PlatformAuditLog {
  id          String   @id @default(uuid())
  orgId       String   @map("org_id")
  type        String   // USER_REASSIGNED | CUSTOMERS_MERGED | REQUEST_REOPENED |
                        // REQUEST_CLOSED | AUTHORITY_GAP_DETECTED | DECISION_SUPERSEDED |
                        // BRANCH_TRANSFERRED
  subjectType String   @map("subject_type")   // "workflow" | "authority" | "customer" | "request"
  subjectId   String   @map("subject_id")
  payload     Json                             // type-specific detail (generation, versions, reasons)
  actorId     String   @map("actor_id")
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([orgId, subjectType, subjectId])
  @@index([orgId, type, createdAt])
  @@map("platform_audit_log")
}
```
Plus, from the case sections above (each independently justified by different query
patterns — high-volume structured diffing for `DecisionSnapshot`, time-ordered polling for
`ScheduledAction` — so these are **not** folded into `PlatformAuditLog`):

`Customer`, `CustomerRelationship`, `RequestCustomerRole` (§1–2) · `DocumentLink` (§3) ·
`DecisionSnapshot` (§5) · `ScheduledAction` (§7) · `version` columns on `Workflow` and
`ApprovalAuthority` (§12).

---

## 14. Amendments to the hardening implementation plan (explicit corrections)

These are **corrections to `2026-07-14_workflow-creator-hardening-implementation-plan_v1.md`**,
not new independent ideas — apply them when that plan's phases are implemented.

| Amend | Location in that doc | Change |
|---|---|---|
| **1** | §1a `RuleControls` / Phase 1 §3.1 | `oncePerRequest`'s dedupe key is `(workflowId, requestId, generation)`, not `(workflowId, requestId)`. Requires the `generation` lookup from `PlatformAuditLog` (§13 here) before the Phase 4 §6.1 duplicate check. **Without this fix, no closed-then-reopened request can ever be automated on again — a real defect in the original spec (§10a here).** |
| **2** | Phase 4 §6.1 `EXECUTION_STATUSES` extension | Add `INTEGRATION_UNAVAILABLE` (§11 here) alongside the already-planned `SKIPPED_DUPLICATE`/`PAUSED_RATE_LIMIT`/`PAUSED_ORG` — one extension pass, not two. |
| **3** | Phase 3 §5.2 `DecisionContext.exclusions` | Populate from `RequestCustomerRole` (§2 here), not just `[preparer, rule author]`. |
| **4** | Phase 5 deferred table, "Aggregate exposure (T6/AA2)" row | Blocker updated from "entity resolution + backend query capability" to "entity resolution — **now specified in §1 here** — + backend query capability" (the modeling half of the blocker is resolved by this doc; the query-performance half is not). |
| **5** | Phase 5 deferred table, "Timers/SLA" row | Add: data model specified in §7 here (`ScheduledAction`); the scheduler/runtime blocker is unchanged. |
| **6** | Phase 5 deferred table | **New row:** "Branch-scoped Approval Authority" — blocker: policy decision needed (does each branch get its own matrix?) before any schema is worth writing (§6 here). |
| **7** | Phase 4 §6.3 linter codes | **New code:** `AUTHORITY_GAP_UNRESOLVED` (armed rule depends on an authority decision that returned `lane:"none"`) — same family as the existing `GATED_TOKEN_ARMED` check, listed explicitly because §8a here treats it as a hard stop, not just a warning. |

---

## 15. Review notes (two independent passes)

Per the request to review after creation for redundancy, contradiction, and errors, this doc
went through two passes: one while drafting, one full re-read afterward against the actual
implementation plan and the live `prisma/schema.prisma`. Listing both honestly — the second
pass caught things the first one didn't.

**Pass 1 (during drafting):**
- **Redundancy removed:** an earlier draft had four separate audit tables
  (`ReassignmentLog`, `MergeLog`, `RequestLifecycleEvent`, `AuthorityGap`); consolidated into
  the single `PlatformAuditLog` with a `type` discriminator (§13) — all four shared the same
  shape and none needed a distinct query pattern.
- **Contradiction resolved:** case 5's materiality-driven re-decision and case 10's
  generation counter initially read as overlapping "something changed, redo the decision"
  mechanisms. §5's "distinction from case 10" paragraph and §10a's "reopen also resets state"
  paragraph now state which mechanism owns which trigger and confirm they compose.
- **Gap closed:** §12's optimistic-concurrency guard was extended to cover the multi-row
  operations this doc introduces (`reassignUser`, `mergeCustomers`, reopen) — otherwise those
  bulk operations would be a fresh instance of the exact bug §12 exists to close.

**Pass 2 (full re-read against the codebase, after Pass 1):**
- **Real contradiction found and fixed:** case 2's body referenced
  `ApprovalRequirement.exclusions`, while the §14 amendment table (written independently)
  correctly said `DecisionContext.exclusions`. `ApprovalRequirement` only carries the
  approver-topology types (`any_of`/`n_of`/`all_of`/`sequence`); exclusions live on the
  evaluation context. Case 2 now matches §14.
- **Dangling self-reference found and fixed:** case 6 said "see the current Prisma model in
  §13" — §13 only lists *new* tables, it never reproduces the baseline `ApprovalAuthority`
  model, so that pointer resolved to nothing. Replaced with a direct statement grounded in
  actually reading `prisma/schema.prisma`.
- **Undefined-term error found and fixed:** §0 introduces "six mechanisms" (A–F), but case 1
  originally invoked a "principle G" that was never added to the §0 table. Removed the false
  cross-reference; the M:N modeling point in cases 1/2/3/9 is now described directly instead
  of pretending to be a seventh lettered principle.
- **Two miscitations found and fixed:** case 5 cited "hardening §7," which is that doc's
  *rule schema v3* section, not approval authority (the correct discussion is hardening §5 /
  alignment doc §7) — reworded to cite the actual code (`lib/authorityEngine.ts`, confirmed
  present at baseline) instead of a section number prone to drifting. Case 4 said
  `ScopeRef.id` where the implementation plan's own contract (1c) names the approver shorthand
  type `Approver`, not `ScopeRef` — corrected to `Approver.id`.
- **Consistency confirmed (no change needed):** `authorityEngine.covers()` reused as-is in
  §8b; `RuleOutput.onFailure` and the `EXECUTION_STATUSES` extension pattern referenced, not
  redefined; `TriggerRef.scope` (reserved in that plan's §1a) is the slot §6 fills, not a
  parallel field. Every `Phase N §X.Y` citation in this doc was checked against the actual
  section it names in the implementation plan; the ones not listed as fixed above were
  already correct.
- **Scope discipline confirmed:** branch-scoped Approval Authority (§6) stays deliberately
  un-schema'd — flagged as policy-first deferred (§14 row 6) rather than guessing at a
  `branchId` column the org hasn't decided it needs.

---

## 16. Priority (how this layers onto the existing P0–P4 roadmap)

None of this blocks the hardening plan's P0/P1 (parser honesty, schema v3) — those are
orthogonal. Sequence this work **after** that plan's P1 (schema v3 lands) and **alongside**
its P2 (ScopeRef), since cases 1/2/9's `ScopeRef`-based conditions depend on Phase 2 existing
first:

| Phase | This doc's cases | Depends on |
|---|---|---|
| **New Phase 6 — Entity integrity** | §1, §2, §9 (`Customer`/relationship graph, dynamic exclusions, merge) | hardening plan Phase 2 (`ScopeRef`) |
| **New Phase 7 — Lifecycle correctness** | §4, §5, §6, §8, §10 (reassignment, materiality, transfer, authority gaps, reopen) | Phase 6 (needs the relationship graph for exposure); amendment #1 (§14) must land with hardening Phase 1/4 |
| **New Phase 8 — Resilience & concurrency** | §3, §7, §11, §12 (document links, scheduled actions' data model, circuit breakers, optimistic concurrency) | can start independently, in parallel with Phase 6/7 |

### Change log
- **2026-07-14 (v1)** — Initial design for all 12 named exception scenarios: six shared
  primitives (alias-not-rewrite, broken-ref scanning, snapshot-and-reconcile, generation
  counters, optimistic concurrency, circuit breakers), consolidated schema, and explicit
  amendments to the hardening implementation plan (most notably fixing the
  `oncePerRequest`-vs-reopen conflict). Two review passes performed (§15): pass 1 during
  drafting removed a redundant set of tables and resolved one apparent overlap; pass 2 — a
  full re-read against the implementation plan and the actual `prisma/schema.prisma` —
  found and fixed one real internal contradiction (`ApprovalRequirement.exclusions` vs.
  `DecisionContext.exclusions`), one undefined cross-reference ("principle G"), one dangling
  self-reference, and two section miscitations.
