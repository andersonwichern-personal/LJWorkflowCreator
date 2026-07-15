# Work Order — Phase 6: Entity Integrity (core)

**Created:** 2026-07-15
**Baseline commit:** `37c97f9` (main — after Phase 5 UX overhaul; working tree clean)
**Implements:** `2026-07-14_workflow-creator-edge-cases-and-error-handling_v1.md` §1, §2, §9
(the WHAT/WHY) — the "New Phase 6 — Entity integrity" row of that doc's §16 roadmap.
**Scope decision (Anderson, 2026-07-15):** build the **core** slice — entity schema,
customer-ID-bound conditions, role-based dynamic exclusions, and the merge service.
**Aggregate exposure is deferred** (see §9); it is flagged backend-required in the design doc
and has no cross-request query path yet.
**Audience:** Claude (coder, this repo) implements; Gemini (overseer) reviews this spec before
code and QAs the branch after. This is a work order: exact files, contracts, algorithms,
tests, and acceptance criteria.
**Branch:** `feature/hardening-phase-6`. One PR.

---

## 0. Ground rules — read before writing any code

### 0a. Inherited conventions (from the hardening implementation plan §0b, still binding)
- **No new runtime deps.** Tests are `tsx`-run assertion scripts (`scripts/assert-*.ts`),
  wired into `npm run test`. No zod/vitest/jest.
- **Back-compat is permanent.** All Phase 6 tables are *additive*. `normalizeRule`,
  `normalizeRequirement`, and every persisted `rule_json` / `requirement` envelope are
  untouched. No data migration rewrites existing rows.
- **Never regress the honesty system.** `confidence` badging, `execution.status` chips, and
  `ruleUsesUnconfirmed()` keep working. New customer instances are `unconfirmed` until a live
  `/customers` API is confirmed (there is none today — honesty flag, edge-cases doc §0).
- **Every phase ends green:** `npm run lint && npm run build && npm run test` before handoff.
- **RLS on every new table**, copied verbatim from the idiom in
  `prisma/migrations/20260715120000_add_org_controls_and_execution_mode/migration.sql`
  (the `auth.jwt() ->> 'org_id' = org_id` policy + the shadow-DB `auth.jwt()` mock block).
- **Migrations are gitignored** (repo convention; open question flagged in the Phase 3/4 QA
  handoffs). Apply the migration to Supabase with `prisma migrate deploy` **before** merge and
  `migrate resolve` it; note in the PR that the SQL is not in-tree.

### 0b. What already exists at baseline (reuse — do not reinvent)
| Capability | Where | Phase 6 uses it for |
|---|---|---|
| `ScopeRef` = any \| category \| instance; `ScopeValue = string \| ScopeRef`; `scopeLabel`/`scopeInstanceId`/`isLegacyString`/`isScopeRef` | `lib/vocabulary.ts:1075–1130` | customer instance refs (§4) |
| `SCOPED_FIELDS.customer_name` — currently `instanceSource: null` + `instancesDisabledHint` | `lib/vocabulary.ts:1153–1158` | **flip to `"customers"`** (§4) |
| Broken-ref scanner (`auditWorkflowRefs`, per-source `classify`) | `lib/refAudit.ts` | merge reruns it over refs pointing at the duplicate (§6) |
| `ScopedInstances` registry shape | `lib/liveVocabulary.ts` | add a `customers` source (§4) |
| `DecisionContext.exclusions` (already consumed by `effectiveApprovers`) | `lib/authorityEngine.ts:44–87` | **dynamic per-request exclusions** (§5) |
| `ApprovalTaskService.createTask({ …, exclusions })` + envelope freeze | `lib/services/approvalTask.ts:98–148` | injection point for §5 |
| `makerCheckerExclusions(requesterId)` (preparer + requester seats) — **client** (`lib/viewpoint.tsx:34`) | `lib/viewpoint.tsx` | static seed; server helper *adds* role-holders (§5) |
| `approverIdFor(label)` (`u-<slug>`) | `lib/viewpoint.tsx:26` | resolve a customer/persona label → approver seat id (§5) |
| RLS + backfill migration idioms | `prisma/migrations/2026071510…`, `…120000…` | §2 |
| Seed requests with flat `mainBorrower: string` + `custtype` | `lib/platformData.ts` (`REQUESTS`, `PlatformRequest`) | seed reconciliation into `Customer`/`RequestCustomerRole` (§3) |

### 0c. Errata & consistency register (deliberate deviations from the edge-cases design doc)
| # | Design doc (edge-cases) said | This work order does | Why |
|---|---|---|---|
| P6-1 | `Customer` **and** `version` columns on `Workflow` + `ApprovalAuthority` (§13, principle E) | Add `version` to **`Customer` only** (merge's concurrency guard needs it). `Workflow`/`ApprovalAuthority` version + full 409 optimistic concurrency stay in **Phase 8** (§12 is that phase's home). | Keep core tight; broad optimistic concurrency is its own phase per the §16 roadmap. |
| P6-2 | `mergeCustomers` "always ends by recomputing exposure … and escalates authority gaps (case 8b)" | Merge **repoints + aliases + reruns the ref scanner + logs**; the exposure-recompute→gap-escalation tail is a **documented stub** (`// DEFERRED: aggregate exposure`) | Aggregate exposure (§1/T6) is deferred this slice; wiring a stub keeps the seam without shipping a half-built exposure engine. |
| P6-3 | `DocumentLink`-adjacent customer ref repointed in merge (§9) | **No `DocumentLink` table in core** (that model is §3 / Phase 8). `MergeReport.documentLinksRepointed` returns `0` with a `// DEFERRED` note. | Document links are Phase 8 resilience work; not needed for the entity graph itself. |
| P6-4 | `makerCheckerExclusions` extended to add role-holders | The dynamic add happens in a **server** module (`lib/services/customer.ts`), *not* in `lib/viewpoint.tsx` (which is `"use client"` and cannot query the DB). The client helper stays for the static preparer/requester seed. | RSC boundary: the per-request role lookup is a DB read. Server owns the authoritative merge of static + dynamic exclusions. |
| P6-5 | `customer_name` "instance level ships disabled with a hint" (Phase 2 §4.2) | Core **enables** the instance level: `instanceSource: "customers"`, drop `instancesDisabledHint`, source from the prototype `Customer` table. Still badged `unconfirmed` (no live `/customers` API). | Phase 6 is exactly the entity source Phase 2 deferred on; the table now exists. |
| P6-6 | `PlatformAuditLog` with 7 `type` values | Core creates the table but only **emits `CUSTOMERS_MERGED`** (and reads none). Other types (`REQUEST_REOPENED`, `USER_REASSIGNED`, …) are reserved for Phase 7. | Only merge produces a lifecycle event this slice; the discriminator column is forward-ready. |

---

## 1. Locked contracts

### 1a. Prisma models (append to `prisma/schema.prisma`)
```prisma
model Customer {
  id           String   @id @default(uuid())
  orgId        String   @map("org_id")
  type         String   // "Business" | "Individual" — same enum as FIELDS.custtype
  name         String
  status       String   @default("active")   // "active" | "merged" | "archived"
  mergedIntoId String?  @map("merged_into_id") // principle A — set only when status="merged"
  version      Int      @default(1)           // principle E — merge concurrency guard (P6-1)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  mergedInto        Customer?              @relation("MergeAlias", fields: [mergedIntoId], references: [id], onDelete: SetNull)
  mergedFrom        Customer[]             @relation("MergeAlias")
  relationshipsFrom CustomerRelationship[] @relation("FromCustomer")
  relationshipsTo   CustomerRelationship[] @relation("ToCustomer")
  requestRoles      RequestCustomerRole[]

  @@index([orgId])
  @@index([orgId, status])
  @@map("customers")
}

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
  to   Customer @relation("ToCustomer",   fields: [toId],   references: [id], onDelete: Cascade)

  @@index([orgId, fromId])
  @@index([orgId, toId])
  @@map("customer_relationships")
}

model RequestCustomerRole {
  id         String   @id @default(uuid())
  orgId      String   @map("org_id")
  requestId  String   @map("request_id")
  customerId String   @map("customer_id")
  role       String   // "Borrower" | "Guarantor" | "Co-Applicant" — reuses FIELDS.role's enum
  createdAt  DateTime @default(now()) @map("created_at")

  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@unique([requestId, customerId, role])   // one person MAY hold two roles on one request
  @@index([orgId, customerId])
  @@index([orgId, requestId])
  @@map("request_customer_roles")
}

model PlatformAuditLog {
  id          String   @id @default(uuid())
  orgId       String   @map("org_id")
  type        String   // core emits: CUSTOMERS_MERGED. Reserved: REQUEST_REOPENED | USER_REASSIGNED | …
  subjectType String   @map("subject_type")   // "customer" (core) | "workflow" | "authority" | "request"
  subjectId   String   @map("subject_id")
  payload     Json
  actorId     String   @map("actor_id")
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([orgId, subjectType, subjectId])
  @@index([orgId, type, createdAt])
  @@map("platform_audit_log")
}
```
The `RequestCustomerRole` unique key is `[requestId, customerId, role]` **on purpose** — that
is what lets one person hold two roles on the same request (design doc §2).

### 1b. Customer service — `lib/services/customer.ts`
```ts
export interface CustomerRecord { id: string; orgId: string; type: "Business" | "Individual";
  name: string; status: "active" | "merged" | "archived"; mergedIntoId: string | null; version: number }

export class CustomerService {
  static listActive(orgId: string): Promise<CustomerRecord[]>          // status="active", by name
  static listRolesForRequest(orgId: string, requestId: string): Promise<RequestCustomerRole[]>
  static relatedTo(orgId: string, customerId: string): Promise<CustomerRecord[]> // one hop over relationships
}

/** Server-side dynamic maker-checker exclusions for a request (§5). Returns approver
 *  seat ids for EVERY customer holding any role on the request, unioned with the static
 *  preparer/requester seeds. Pure of React; safe in route handlers. */
export function roleHolderExclusions(roles: RequestCustomerRole[], customers: CustomerRecord[]): string[]
export async function dynamicExclusionsForRequest(
  orgId: string, requestId: string, staticSeed: string[]
): Promise<string[]>
```
`roleHolderExclusions` maps each role's customer `name` → seat id via `approverIdFor(label)`
(`lib/viewpoint.tsx:26`) so the ids line up with the approver pool. `dynamicExclusionsForRequest`
= `dedupe([...staticSeed, ...roleHolderExclusions(rolesForRequest, customers)])`.

### 1c. Merge — `lib/services/merge.ts`
```ts
export interface MergeReport {
  requestRolesRepointed: number;
  relationshipsRepointed: number;
  documentLinksRepointed: number;                 // always 0 in core (P6-3)
  ruleRefsRepointed: { workflowId: string; name: string }[];
  exposureRecomputed: { before: number; after: number } | null; // null in core (P6-2)
}
export async function mergeCustomers(
  orgId: string, survivorId: string, duplicateId: string,
  opts: { actorId: string; reason: string }
): Promise<MergeReport>;
```

### 1d. Seed reconciliation — idempotent, run at service boot / on first customer read
`ensureCustomersSeeded(orgId)`: for each `REQUESTS[*]`, upsert a `Customer` from `mainBorrower`
(`type` from `custtype`, dedupe by `orgId+name`) and a `RequestCustomerRole`
(`role: "Borrower"`). Idempotent (unique keys); running twice adds nothing. This is the only
way seed data acquires entity rows — there is no live `/customers` API to import from.

---

## 2. Migration — `add_entity_integrity` (one migration)
1. `CREATE TABLE` for the four models in §1a, with indexes and FKs exactly as Prisma generates.
2. `ENABLE ROW LEVEL SECURITY` + the tenant `org_id` policy on **all four** tables, using the
   verbatim block from `…120000_add_org_controls_and_execution_mode/migration.sql` (including
   the shadow-DB `auth.jwt()` mock `DO $$…$$`).
3. **No SQL backfill** — seed reconciliation (§1d) runs in app code against real request data,
   not in the migration (the migration has no access to `platformData`). `platform_audit_log`
   starts empty.
4. Apply with `prisma migrate deploy`; `prisma generate`; `prisma migrate status` clean.

---

## 3. Customer-ID-bound conditions (design doc §1 — the graph-lite that ships)

### 3.1 `lib/vocabulary.ts`
- `SCOPED_FIELDS.customer_name`: `instanceSource: "customers"`; **remove** `instancesDisabledHint`;
  keep `categories: ["Business","Individual"]` + `categoryAttribute: "custtype"`. The two-step
  picker (Phase 2 §4.3) now renders a populated **Specific** section.
- Leave `FIELDS.customer_name.confidence: "verified"` for the field itself, but the *instances*
  are prototype-sourced — the picker section header notes "from prototype records" (honesty).

### 3.2 `lib/liveVocabulary.ts` + overlay
- Add `customers` to `ScopedInstances` (`{ id, label }[]`). Populate from
  `CustomerService.listActive` in the vocabulary/overlay path that already feeds `templates` /
  `users` / `authorities`. When empty (unseeded), the picker shows category-only, exactly like
  today — no regression.

### 3.3 Evaluation — `lib/ruleEvaluator.ts` (+ `ruleEngine.ts` delegate)
- `customer_name` instance refs match on **id** when the request carries a customer id, falling
  back to case-insensitive **label** match against `mainBorrower` for seed data. Reuse the
  existing `scopeMatches(value, actualId, actualLabel)` helper (Phase 2 §4.4) — if a dedicated
  `customers` branch does not exist in the resolver, add it alongside the `retailer`/`template`
  branches. Category refs (`Business`/`Individual`) compare against the request's `custtype`.
- **Role-scoped conditions** (`FIELDS.role`): resolve against `RequestCustomerRole` for the
  request (via a resolver context the evaluator already threads for live fields). If no roles
  are seeded for a request, fall back to today's flat behavior (no regression). Keep this
  additive — do **not** change `FIELDS.role`'s shape.

### 3.4 Ref-audit — `lib/refAudit.ts`
- `customers` is now an instance source: `registryFor` resolves it from the passed registry;
  `classify` reports `missing` for a customer id absent from the live customer registry and
  `legacy-unresolved` for a bare string on `customer_name`. No code change beyond the registry
  wiring in §3.2 — the scanner is already source-driven.

---

## 4. Role-based dynamic exclusions (design doc §2 — the crown jewel, highest regulatory value)

**The failure this closes:** a loan officer who is also the guarantor on their own client's
deal could sit in an `any_of` approver pool and self-approve. Static maker-checker
(preparer + requester) does not catch it.

### 4.1 Population — server-authoritative
- `POST /api/platform/authorities/tasks` (`app/api/platform/authorities/tasks/route.ts:51`)
  currently takes `exclusions` from the request body (client-computed
  `makerCheckerExclusions`). **Change:** the route computes the authoritative set server-side —
  `dynamicExclusionsForRequest(orgId, requestId, bodyExclusions)` (§1b) — unioning the client
  seed with every role-holder seat resolved from `RequestCustomerRole`. The body value becomes a
  *seed*, never the final word.
- The union is frozen into the task envelope's `exclusions` exactly as today
  (`ApprovalTaskService.createTask` already persists `exclusions`); no change to the envelope
  shape or to `evaluateRequirement` — `effectiveApprovers` already honors `ctx.exclusions`.

### 4.2 Guardrail already present, now fed correctly
`createTask` already throws `"Requirement cannot be satisfied: every approver seat is
excluded…"` when the exclusion set empties the pool (`approvalTask.ts:130–136`). Dynamic
exclusions can now trigger this legitimately (e.g., the sole approver is the guarantor) — that
is the **correct** surfaced deadlock, not a bug. The UI must show it as "conflict of interest:
no eligible approver" rather than a generic error (§7).

### 4.3 Do not
- Do **not** move the population into `lib/viewpoint.tsx` (client, P6-4).
- Do **not** weaken `recordDecision`'s existing barred-voter check (`approvalTask.ts:181`) — it
  stays as the second line of defense.

---

## 5. Merge service (design doc §9)

`mergeCustomers(orgId, survivorId, duplicateId, opts)`:
1. **Concurrency lock (principle E):** read both customers with their `version`; perform every
   write in a `prisma.$transaction`; each repoint/update is conditional on the `version` read
   at step 1 (`updateMany where id+version`), and a `count !== 1` result throws
   `"Customer changed during merge (concurrent edit) — retry"` (a 409 at the route). Bump
   `survivor.version` and `duplicate.version` at the end.
2. **Repoint (principle A — alias, don't rewrite history):**
   `RequestCustomerRole.customerId` and `CustomerRelationship.fromId/toId`: `updateMany` from
   `duplicateId` → `survivorId` (respecting the `[requestId, customerId, role]` unique key —
   on collision, delete the duplicate-side role rather than violate the constraint; count both
   as repointed). `documentLinksRepointed = 0` (P6-3).
3. **Rule refs:** run the **existing** `auditWorkflowRefs` scanner (`lib/refAudit.ts`) to find
   rule `ScopeRef`s whose instance id === `duplicateId`; rewrite each to `survivorId`
   (id + refreshed label) in the workflow `rule_json`; collect `{workflowId, name}`. Reuse the
   scanner — do not write a second finder (principle B).
4. **Alias the duplicate:** `duplicate.status = "merged"`, `mergedIntoId = survivorId`. The row
   is **never deleted** — historical audit entries referencing `duplicateId` still resolve one
   hop forever.
5. **Exposure recompute → authority gap:** `// DEFERRED (P6-2)` — leave a commented seam that
   names case 8b; `exposureRecomputed = null`.
6. **Audit:** write one `PlatformAuditLog` row `{ type: "CUSTOMERS_MERGED", subjectType:
   "customer", subjectId: survivorId, actorId: opts.actorId, payload: { duplicateId, reason,
   ...counts } }`.
7. Return the `MergeReport`.

**Routes:**
- `GET /api/platform/customers` → active customers (+ `?requestId=` for that request's roles).
- `POST /api/platform/customers/merge` → body `{ survivorId, duplicateId, reason }`; `actorId`
  from the session persona; returns `MergeReport`. Demo-org fallback matches the existing
  authorities routes. Merge is **admin-only** — gate server-side (persona role check) as well
  as in the UI.

---

## 6. UI (additive, demo-safe, viewpoint-gated)
- **Customers panel** (new, or extend the existing customers surface): list active customers
  with type + a "Related entities" one-hop list (`CustomerService.relatedTo`). Admin viewpoint
  (`canEdit`) sees a **"Merge duplicate…"** action → pick survivor + duplicate + reason →
  confirm dialog → calls the merge route → shows the `MergeReport` summary ("3 roles, 1
  relationship, 2 rules repointed"). Presentation view hides the merge tooling.
- **RuleSentence customer picker:** the `customer_name` value picker now shows the **Specific**
  section (populated from `customers`), with related entities shown inline under a picked
  customer (design doc §1 UI note). Category chips (`Business`/`Individual`) unchanged.
- **Conflict-of-interest surface:** where task creation can now fail on an emptied pool (§4.2),
  render "Conflict of interest — every eligible approver holds a role on this request" instead
  of a raw error toast. In the decision simulator, a vote card for a persona who holds a role on
  the request shows a **barred** badge ("guarantor on this request — cannot approve").
- **Lucide icons only** (Phase 5 convention) — no emoji.

---

## 7. Tests (extend `npm run test`)
- `scripts/assert-merge.ts`: repoint counts correct; duplicate ends `status="merged"` +
  `mergedIntoId=survivor`; **re-running merge is a no-op** (already merged); a stale `version`
  → throws; a `[requestId, customerId, role]` collision resolves without a constraint error;
  rule `ScopeRef` pointing at the duplicate is rewritten to the survivor.
- `scripts/assert-exclusions.ts`: `roleHolderExclusions` excludes a guarantor's seat;
  `dynamicExclusionsForRequest` unions static + role seats and dedupes; a task whose sole
  approver holds a role on the request → `createTask` throws the deadlock error (proves
  self-approval is impossible); a request with no role-holders → exclusions === static seed
  (no regression).
- `scripts/assert-customer-eval.ts` (or extend `assert-evaluator-parity`): a `customer_name`
  instance ref matches by id (live) and by label (seed); a category ref matches `custtype`;
  a role-scoped condition resolves against `RequestCustomerRole`.
- Wire all three into `package.json`'s `test` script. Keep every existing suite green.

---

## 8. Deferred (NOT in this slice — do not build bodies; list them in the PR)
| Item | Blocker | Prepared seam |
|---|---|---|
| Aggregate exposure (`AuthorityInput.exposure`, guarantor 50% weighting, T6) | No cross-request query path; policy weighting undecided | `mergeCustomers` step 5 stub; `AuthorityInput` unchanged (add `exposure?` when built) |
| Relationship-scoped `ScopeRef` (`includeRelated: true`, "this borrower or any entity they control") | Cross-request query support | `CustomerRelationship` table exists; `CustomerService.relatedTo` is the one-hop primitive |
| `DocumentLink` table + repoint (§3 of design doc) | Phase 8 resilience scope | `MergeReport.documentLinksRepointed` returns 0 |
| `version` on `Workflow`/`ApprovalAuthority` + full 409 optimistic concurrency (§12) | Phase 8 | `Customer.version` proves the pattern |
| Reopen / generation counters (§10) | Phase 7 | `PlatformAuditLog` type discriminator reserves `REQUEST_REOPENED` |
| Live `/customers` platform API binding | Admin repo hasn't exposed one | `customers` instance source; prototype `Customer` table stands in |

---

## 9. Deploy & rollback
- **One Prisma migration** (`add_entity_integrity`). Run `prisma migrate deploy` against
  Supabase **before** merging; `migrate resolve`; note in the PR that migration SQL is
  gitignored (same open item as Phases 3–4).
- **Rollback:** all tables are additive and unreferenced by existing rules → a rolled-back app
  ignores them safely. Merge writes are append/alias only (no destructive deletes except the
  intentional role-collision cleanup), so a merged customer degrades gracefully to "an archived
  duplicate" under old code.
- **Do-not list (standing):** don't add exposure math (deferred); don't delete merged customer
  rows (principle A); don't move dynamic-exclusion logic client-side (P6-4); don't touch the
  Phase-5 admin shell chrome.

---

## 10. Acceptance criteria (Gemini QA checklist)
1. `npm run lint && npm run build && npm run test` green; `npx tsc --noEmit` clean.
2. Migration applied to Supabase; `prisma migrate status` clean; all four tables have RLS.
3. Seed reconciliation is idempotent — running the app twice yields exactly one `Customer` +
   one `RequestCustomerRole` per seed request.
4. `customer_name` condition offers **specific** customers; a picked instance evaluates against
   both live-id and seed-label data; legacy string rules still evaluate and show as
   `legacy-unresolved` in audit-refs.
5. A task where the sole eligible approver holds a role on the request **cannot be created**
   (deadlock surfaced), and no role-holder can vote — self-approval is provably impossible.
6. A merge repoints roles/relationships/rule-refs, aliases the duplicate (never deletes it),
   writes a `CUSTOMERS_MERGED` audit row, and is a no-op on re-run; a concurrent-edit merge 409s.
7. No `[object Object]` anywhere (scopeLabel totality preserved); honesty badges intact.

### Change log
- **2026-07-15 (v1)** — Initial Phase 6 work order for the *core* entity-integrity slice
  (schema, customer-ID-bound conditions, role-based dynamic exclusions, merge), scoped from the
  edge-cases design doc §1/§2/§9. Aggregate exposure, relationship-scoped refs, document links,
  broad optimistic concurrency, and reopen/generation deferred with their blockers (§8). Errata
  register P6-1…P6-6 reconciles the design doc against the Phase 2/3 code as it actually shipped.
