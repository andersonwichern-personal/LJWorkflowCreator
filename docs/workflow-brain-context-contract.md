# Workflow Brain — context contract

Status: v1 — authored by honeycomb-lead, 2026-07-24.
Code is normative: `packages/workflow-brain/src/context.ts` + `ports.ts`
(types) and `contextCompiler.ts` (construction). This document explains the
boundary for host teams wiring an adapter.

## The boundary

The Brain never fetches anything. A host hands it a
`WorkflowBrainContextProvider` (ports.ts) at the composition root; the Brain
asks for typed snapshots/searches/resolutions and treats every string in them
as untrusted tenant data. Both shipped adapters implement the SAME contract and
pass the SAME suite (`core-tests/assert-brain-context-contract.ts` exports
`runContextProviderContract` for reuse):

| Adapter | Location | Data source |
|---|---|---|
| standalone/demo | `src/app/features/workflows/data/standalone-brain-context.adapter.ts` | static vocabulary + seeded demo registries; zero credentials; deterministic |
| Landjourney live | `src/app/features/workflows/data/landjourney-brain-context.adapter.ts` | authenticated `ApiService` (bearer + `x-organization`); live registries |

Selection is dependency injection (`WORKFLOW_BRAIN_CONTEXT` token) — never
`if (demo)` branches inside the Brain.

## Context request/snapshot (see context.ts for exact fields)

- `ContextRequest`: profile + purpose (`parse | consult | ghost-suggest |
  revise | review`) + focus hints + optional byte budget.
- `BrainContextSnapshot`: `snapshotId`, identity (opaque `tenantKey`),
  `vocabularyHash`, ParseOptions-shaped projections (`instanceOptions`,
  `instanceRegistry`, `assignees`), bounded `entities`, related-workflow
  summaries, host-declared `allowedActionKeys`, per-section `sources`
  (source/fetchedAt/version), `budget` with an explicit truncation report, and
  a `privacyCeiling`.

## Profiles

`standalone-demo | landjourney-live | workflow-revision | template-scoped |
read-only-review`. Profiles constrain and prioritize retrieval; they NEVER
grant permissions — capability checks are a separate fail-closed host port
(`HostCapabilityPort`). A missing capability turns a feature off; it never
falls back to a more permissive profile.

## Construction and compaction (contextCompiler.ts)

Deterministic: dedupe → rank against the focus text (exact substring > word
overlap > registry affinity; lexicographic tie-break) → enforce the byte budget
section-by-section, recording every cut in `budget.truncated` → canonical
serialization → `vocabularyHash` (FNV/djb2 content hash) → `snapshotId` derived
from (profile, tenantKey, vocabularyHash, source versions). No timestamps or
randomness in identity — the same inputs always produce the same snapshotId.
Entire record dumps are prohibited; the Brain requests registries by purpose
and operates within the budget.

## Invalidation and switching

`snapshotId` is the staleness key for EVERYTHING derived: AI parse results,
ghost suggestions, consultant recommendations, entity groundings. The reducer
(`brainState.ts`) enforces on `context-switched`:

- new snapshotId/vocabularyHash adopted;
- parse envelope and open questions discarded;
- open recommendations expired;
- tenant change additionally discards accepted conversation facts and all
  recommendation history (tenant memory must not survive a tenant switch);
- profile change (same tenant) keeps context-independent accepted facts.

Cache rule: any cache keyed on context MUST include `tenantKey` and
`snapshotId` (or `vocabularyHash`) in its key. Cross-tenant reuse is impossible
by construction, not by discipline.

## Privacy classes

`public-vocabulary < tenant-internal < customer-data`. Diagnostics/telemetry
may echo nothing above `public-vocabulary`; the snapshot's `privacyCeiling`
tells the observability layer what the session may emit. Simulation data is a
separate authorized port (`simulation-data` capability), never smuggled into
vocabulary snapshots.
