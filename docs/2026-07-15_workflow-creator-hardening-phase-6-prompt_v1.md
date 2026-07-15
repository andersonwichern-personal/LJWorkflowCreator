# Prompt: Phase 6 — Entity Integrity, Relationship Graphs, and Merge Safety

## Task Description
Implement **Phase 6 (Entity Integrity)** of the Hardening Plan. This phase hardens the identity model behind customers, related parties, and merge-safe exposures so rules can follow real entities instead of fragile labels.

You MUST perform this work on a new git branch: `feature/hardening-phase-6`.

This phase depends on the already-planned **Phase 2 `ScopeRef` / ID-bound instance model**. Do not reintroduce free-text identity matching for customer-like entities.

---

## 1. Database Schema (`prisma/schema.prisma`)
Introduce the relationship graph that makes customer integrity and exposure tracing durable:

*   Add a first-class `Customer` model with merge-safe identity fields:
    *   `status` values: `"active" | "merged" | "archived"`
    *   `mergedIntoId` pointer for aliasing to a survivor record
    *   tenant-scoped `orgId`
*   Add `CustomerRelationship` edges for entity graph traversal:
    *   `fromId`, `toId`
    *   `relationType` values such as `"owns" | "controls" | "guarantees" | "co_borrower" | "same_party"`
*   Add `RequestCustomerRole` records so a request can attach multiple people/entities with distinct roles:
    *   `requestId`
    *   `customerId`
    *   `role` values such as `"primary_borrower" | "guarantor" | "beneficial_owner" | "preparer"`
*   Add indexes and RLS policies that mirror the tenant-scoped patterns used by existing tables.
*   Generate and run migrations after the schema update.

---

## 2. Relationship Resolver & Exposure Service
Create a service layer that can answer "who is this entity really?" and "what else is connected to them?".

*   Add `lib/services/customerGraph.ts` for graph traversal helpers.
*   Add `lib/services/exposure.ts` for aggregate exposure lookup used by authority decisions.
*   The resolver should:
    *   Follow `mergedIntoId` aliases to the surviving customer.
    *   Traverse relationship edges to collect connected entities.
    *   Keep history immutable; never rewrite old references.
*   Expose an API shape that returns:
    *   canonical customer identity
    *   connected parties
    *   aggregate exposure summary
    *   any broken or stale references discovered during traversal

---

## 3. Broken-Reference Audit
The same scan must detect entity integrity problems across workflows, authorities, and requests.

*   Add or extend a nightly/administrative ref-audit pass that reports:
    *   references to merged or archived customers
    *   stale customer-role links
    *   broken relationship edges
    *   unresolved `ScopeRef` instances that point at deleted customer-like records
*   Surface results in a machine-readable report and in the existing admin-facing review surfaces.
*   Keep the audit conservative: report ambiguity rather than auto-fixing labels.

---

## 4. Merge Flow (`lib/services/merge.ts`)
Implement a merge workflow that preserves auditability.

*   Create `mergeCustomers(survivorId, duplicateId, ctx)` or extend the existing merge service if present.
*   Merge behavior:
    *   Repoint role records and relationship edges from the duplicate to the survivor.
    *   Preserve the duplicate record as a historical alias.
    *   Mark the duplicate as `merged` and set `mergedIntoId`.
    *   Never rewrite prior audit rows.
*   The merge must run under tenant scoping and should be safe to call from admin tooling.

---

## 5. Rule / Authority Integration
Wire entity integrity into the parts of the product that depend on accurate people and exposure data.

*   Update condition resolution so customer-like instance values resolve through the customer graph.
*   Update authority/exposure lookups so aggregate exposure includes related and merged entities.
*   Ensure relationship-scoped conditions can ask for:
    *   this customer only
    *   this customer plus connected entities
    *   this customer’s canonical identity after merge
*   Preserve the existing honest behavior: unresolved references should surface as warnings, not silently coerce to strings.

---

## 6. Frontend Integration
Expose the new integrity model in the admin surfaces without overcomplicating the builder.

*   Show merged / archived customer states in review views.
*   Render relationship graph summaries where entity selection or exposure matters.
*   Surface broken-reference warnings near any customer-bound picker or review panel.
*   Keep the UI honest: if a customer is unresolved or merged, say so explicitly.

---

## 7. Verification
*   Create `scripts/assert-entity-integrity.ts` to cover:
    *   canonicalization through merges
    *   relationship traversal
    *   stale reference detection
    *   tenant isolation
*   Run the full validation suite:
    *   `npm run test`
    *   `npm run build`
    *   `npm run lint`

