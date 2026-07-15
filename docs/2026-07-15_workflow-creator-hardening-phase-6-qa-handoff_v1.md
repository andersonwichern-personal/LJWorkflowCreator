# Phase 6 — QA Handoff for Gemini (Overseer)

**From:** Claude (Coder)
**Date:** 2026-07-15
**Branch:** `feature/hardening-phase-6`
**Checkpoint commit:** `a06eb53` — *feat(hardening): Phase 6 core — entity integrity*
**Spec:** `docs/2026-07-15_workflow-creator-hardening-phase-6-work-order_v1.md` (core scope)

---

## 1. Status at a glance (at commit `a06eb53`)

| Gate | Result |
|------|--------|
| `npm run test` | ✅ pass (all suites, incl. new real Phase-6 assertions) |
| `npm run lint` | ✅ pass (no ESLint warnings/errors) |
| `npm run build` | ✅ pass (customers + merge routes compiled) |
| `npx tsc --noEmit` | ✅ clean |

> **Provenance note.** Phase 6 was built by Codex (parallel scaffolding) and reconciled by
> Claude. A live edit collision occurred mid-session; see §5. `a06eb53` is a verified-green
> snapshot, but the working tree was still being modified by the parallel agent after the
> commit — **re-run the gate on whatever you review.**

---

## 2. What shipped (core scope)

- **Schema + migration** (`prisma/schema.prisma`, `…/20260715123000_add_customer_integrity`):
  `Customer` (type, status, `mergedIntoId`, `version`), `CustomerRelationship`,
  `RequestCustomerRole` (`@@unique([requestId, customerId, role])`), `PlatformAuditLog`.
  Migration realigned to the schema (columns, unique index, audit table) with RLS on all
  four tables, idiom copied from the Phase-4 migration.
- **Dynamic maker-checker exclusions** (`lib/services/customer.ts`,
  `app/api/platform/authorities/tasks/route.ts`): at task creation the server unions the
  static preparer/requester seed with every `RequestCustomerRole`-holder's seat — a
  role-holder cannot approve their own request (blocks self-approval). Feeds the existing
  `DecisionContext.exclusions`; no engine contract change.
- **Merge** (`lib/services/merge.ts`): `mergeCustomers()` with an optimistic-concurrency
  guard (`expectedVersion`), idempotent no-op on re-merge, transactional repoint of roles +
  relationships, `CUSTOMERS_MERGED` audit row, and **workflow rule-ref repointing** via the
  pure `rewriteCustomerInstanceRefs()` (`lib/customerRefRewrite.ts`) — merging a duplicate
  rewrites every `customer_name` instance ref dup→survivor.
- **Customer-ID-bound conditions** (`lib/vocabulary.ts`, `lib/liveVocabulary.ts`,
  `lib/ruleEngine.ts`, `app/api/workflows/audit-refs/route.ts`): `customer_name` now sources
  the `customers` instance registry; evaluator resolves it to the request's `mainBorrower`;
  broken-ref audit is customer-aware.
- **Routes**: `GET /api/platform/customers` (+`?requestId` roles), `POST …/customers/merge`.
- **UI**: `components/CustomersPanel.tsx` (wired into `AdminShell`).
- **Tests** (real, not mock literals): `assert-merge` (ref-rewrite at depth + field guard),
  `assert-customer-eval` (`customer_name` over seed data), `assert-entity-integrity`
  (`canonicalize` alias-walk + role-holder exclusions), `assert-exclusions`.

---

## 3. Priority review areas

1. **Rule-ref rewrite correctness** (`lib/customerRefRewrite.ts`): only `customer_name`
   instance refs with `id === duplicateId` are rewritten; recurses nested groups; leaves
   other fields untouched even on id collision. Confirm the field guard is the behavior you
   want (vs. rewriting any instance ref equal to the customer id).
2. **Dynamic exclusion resolution** (`roleHolderExclusions`): maps a customer *name* →
   approver seat via `approverIdFor(name)`. In seed data only "Borrower" roles exist (from
   `mainBorrower`), and no approver persona is a borrower — so the guardrail only bites when
   real role data names an approver. Confirm that's acceptable for the demo (the mechanism is
   correct; wiring richer role data is backend-required).
3. **Merge route is not gated to admins** — the spec asked for a server-side admin check; the
   route currently accepts any caller (`actorId` defaults to `"ui"`). Recommend adding an
   `actorRole === "admin"` gate.

---

## 4. Deferred (NOT in this slice)

Aggregate exposure, relationship-scoped `includeRelated`, `DocumentLink`, broad optimistic
concurrency (Workflow/Authority `version`), reopen/generation counters, live `/customers` API.
See the work-order §8.

---

## 5. Two things that need an Overseer decision

1. **`lib/services/exposure.ts` is present again.** Aggregate exposure was **deferred** in the
   approved core scope; Claude deleted `exposure.ts`, and the parallel agent re-created it. It
   currently returns a placeholder figure (`connected.length * 100000`) — a fabricated number
   that trips the honesty guardrail if surfaced. **Decision:** delete it (honor the deferral)
   or keep it clearly labeled as a non-authoritative mock. Not wired into any route/UI today.
2. **Migrations are gitignored** (repo convention). `add_customer_integrity` is **not applied
   to Supabase** in this environment (no DB reachable). Run `prisma migrate deploy` +
   `migrate resolve` before the tables exist in the DB — same open item as Phases 3–4.

---

## 6. Next actions

- [ ] Gemini QA of §3, decision on §5.1 (exposure) and §5.2 (migration deploy).
- [ ] Add the admin gate to `POST /api/platform/customers/merge` (§3.3).
- [ ] Ensure a single agent owns the branch going forward (the §5 collision must not recur).
