# Workflow Consultant — behavior contract

Status: v1 — authored by consultant-conversation-engineer, 2026-07-24.
Modules: `packages/workflow-brain/src/{proposals,recommendations,consultant}.ts`.
Tests: `core-tests/assert-brain-consultant.ts`. Everything below is deterministic
this wave: the same rule + envelope + snapshot always produce the byte-same turn.

## Where the consultant sits (brainState phases)

The consultant serves the middle of the brainState machine
(`discover → scope → draft → gaps → recommend → propose → consent → apply →
verify → simulate → prepare`):

| Phase | Consultant's contribution |
|---|---|
| `gaps` | `questions` (from `clarificationsFor`, at most 2) + honest `understanding` |
| `recommend` | `facts` + ranked `recommendations` + `watchouts` + `alternatives` |
| `propose` | `proposedChanges` — exact `RulePatchOp[]` with a `describePatch` preview |
| `consent` | `acceptRecommendation` / `rejectRecommendation` (stale-safe, exact-ops-only) |
| `apply`/`verify` | accept applies the previewed ops, then re-runs `validateRule`; the caller re-lints and feeds the returned `RecommendationRef` to `reduceBrain` |

The consultant never advances phases itself and never fires events — it is a
pure planner the host calls with `planConsultantTurn(input)`.

## The structured turn

`planConsultantTurn(AnalyzerInput & { requiresApproval }) → ConsultantTurn`:

- `understanding` — `interpretRule` prose for the drafted rule, with an honesty
  suffix when sidecars are non-empty; when `rule` is null it states what IS
  known (counts of unmapped phrases / unconfirmed names / ambiguous readings)
  and never claims a rule exists.
- `facts` — the full evidence catalog from `deriveFacts` (see below).
- `questions` — from `clarificationsFor(envelope)` only; at most 2; ordered by
  how many clauses they block (envelope `clauseLinks`), ambiguities leading on
  ties because answering one re-reads the whole description.
- `recommendations` — ranked `deriveRecommendations` output (see catalog).
- `watchouts` — inverted-condition risk first, then unexecuted timing (R11),
  contradictions, unsupported clauses, unconfirmed vocabulary.
- `alternatives` — only when a real tradeoff exists (currently: `assign_user`
  without `notify` → "notify alongside the assignment"); otherwise empty.
- `proposedChanges` — `{ recommendationId, ops, preview }` for every
  recommendation carrying a patch; `preview` is `describePatch(ops)`, derived
  from the ops, never from model text.
- `nextBestAction` — exactly one: answer the top question → review the top
  actionable recommendation (high risk or patch-bearing) → simulate (valid,
  gap-free rule) → refine the description.
- `contextUsed` — `{ source, version }` pairs from `snapshot.sources` only.
  Never entity labels, never customer content.
- `suggestedName` — deterministic, from the `interpretRule` summary (the name
  lives outside rule JSON, so no patch ever sets it).
- `canApply` — rule passes `validateRule` AND every proposed patch applies.
- `requiresApproval` — host four-eyes policy, passed through untouched.

## Deterministic evidence catalog

Facts first: every recommendation is built FROM fact objects and cites their
ids in `evidence`, so an evidence-free recommendation cannot be constructed.
Ids are djb2 content hashes (kind + paths + evidence) — never random, never
clock-derived — so re-derivation over unchanged inputs re-issues identical ids
and a rejected id stays suppressed by the reducer until evidence changes.

| Trigger condition | Fact kind (source) | Rec type | Risk | Patch |
|---|---|---|---|---|
| `envelope.contradictions[]` entry | `contradiction` (contradiction) | `contradiction` | high | none — needs intent |
| `envelope.unresolved[]` slot | `unresolved-entity` (parse) | `unresolved-entity` | high | none — points to the clarification |
| "unless"/"except" in `clauses[]` text, else in `sourceText` | `inverted-condition-risk` (parse) | `inverted-condition-risk` | high | none — grammar reads it as POSITIVE today (gold-129/130); a human must verify direction |
| conditioned rule, no/empty `else` | `missing-alternate-path` (coverage) | `missing-alternate-path` | low | none — the right outcome is unknowable; never invent recipients |
| zero condition leaves on a high-volume event (REQUEST CREATED/SUBMITTED/STAGE CHANGED/ASSIGNED, CUSTOMER CREATED, DOCUMENT UPLOADED, BOOKING STATUS CHANGED) | `broad-match` (coverage) | `broad-match` | medium | `add-condition custtype is Business` when custtype is grounded for the triggers — the preview makes the value explicit for the author to adjust |
| action param empty and `paramKind !== "none"` (skipped when the parser already holds an unresolved slot for it) | `missing-param` (validation) | `missing-param` | medium | none |
| `delayMinutes` present (≠0) | `unsupported-timing` (validation) | `unsupported-timing` | high | `set-delay null` |
| per-action `when` gate present | `unsupported-timing` (validation) | `unsupported-timing` | high | none — no op removes a gate |
| `ruleUsesUnconfirmed`-style token scan (enumerated) | `unconfirmed-vocabulary` (validation) | `unconfirmed-vocabulary` | medium | none |
| `snapshot.relatedWorkflows` sharing an event + (condition-field overlap OR same action set) | `duplicate-workflow` (context) | `duplicate-workflow` | medium | none — names the sibling id + name |
| zero leaves + `maxFiresPerHour` still at default 25 | `rate-protection` (lint) | `rate-protection` | low | none — keep shadow + a deliberate cap; NEVER an arming patch |
| rule exists | `naming` (coverage) | `naming` | low | not applicable — surfaces as `suggestedName` |

Ranking: `contradiction`/`unresolved-entity` → `inverted-condition-risk`/
`unsupported-timing` → `duplicate-workflow` → `broad-match` → everything else;
ties break on id, so order is stable across derivations.

## Proposal and consent flow

1. **Preview.** A patch-bearing recommendation ships `RulePatchOp[]` plus
   `describePatch(ops)`. The ops ARE the proposal; there is no prose-to-ops
   translation at accept time.
2. **Accept.** `acceptRecommendation(rec, rule, { snapshotId, ruleVersion })`:
   - refuses `unknown-recommendation` when the content-hash id does not verify
     or `evidence` is empty (tampered/fabricated objects can't be accepted);
   - refuses `stale-snapshot` / `stale-rule-version` when `rec.expiresWith`
     mismatches the caller's current values — the exact freshness test
     `reduceBrain` applies to `recommendation-accepted`;
   - applies the EXACT previewed ops via `applyRulePatch` (atomic: all ops or
     `patch-refused` with the precise reason);
   - re-runs `validateRule` and refuses `patch-refused` if the patched rule has
     any NEW blocking error the input rule did not already carry;
   - returns the patched rule + a `RecommendationRef` (status `accepted`) the
     caller feeds to the reducer. Patchless recommendations accept cleanly with
     the rule untouched — consent is still recorded.
3. **Reject.** `rejectRecommendation(rec)` returns a status-`rejected` ref.
   Because ids are content hashes, re-deriving over unchanged inputs re-issues
   the same id and the reducer keeps it suppressed — the consultant never nags
   about a decided recommendation without new evidence.

`applyRulePatch` hard refusals: unknown paths/indices/events/actions; removing
the last trigger; removing the last then-action while armed (mirrors
`NO_ACTIONS_WHEN_ARMED`); delays beyond `MAX_DELAY_MINUTES`; rate caps below 1;
and `set-control mode "armed"` unconditionally — "arming is an activation
decision made through the existing controls, not a consultant patch". ScopeRef
values pass through structurally untouched.

## Memory and compaction (per brainState)

`acceptedFacts` (author goals, stated constraints) survive a same-tenant
profile/context switch; they die on a tenant switch, along with ALL
recommendations. A same-tenant context switch expires `open` recommendations
and preserves decided ones. A `description-changed` bump invalidates every
derived artifact; recommendations are additionally keyed by
`expiresWith { snapshotId, ruleVersion }`, so nothing previewed against stale
context can ever be applied.

## Worked examples (real output, abridged)

**1. "when a loan is approved and the loan amount is at least 250000, assign to Wael"**

```json
{ "understanding": "For approved loans of $250,000 or more, assign the request to Wael. All other requests will be left unchanged.",
  "questions": [],
  "recommendations": [ { "type": "naming", "risk": "low" }, { "type": "missing-alternate-path", "risk": "low" } ],
  "watchouts": [], "proposedChanges": [],
  "nextBestAction": "Simulate this rule against recent requests to confirm it matches what you expect.",
  "suggestedName": "Approved loans of $250,000 or more, assign the request to Wael",
  "alternatives": [ { "title": "Notify alongside the assignment" } ], "canApply": true }
```

**2. "when a request is created, notify Sara"** (broad, high-volume, unconfirmed trigger)

```json
{ "understanding": "For new requests, notify Sara. All other requests will be left unchanged.",
  "recommendations": [ { "type": "broad-match", "patch": true }, { "type": "naming" },
    { "type": "unconfirmed-vocabulary" }, { "type": "rate-protection" } ],
  "watchouts": [ "This rule uses vocabulary that is unconfirmed against the live platform: trigger \"REQUEST CREATED\". …" ],
  "proposedChanges": [ { "preview": "add condition \"customer type is Business\" to the root group" } ],
  "nextBestAction": "Review the recommendation \"Scope this rule before it touches the whole pipeline\" and accept or reject it.",
  "canApply": true }
```

**3. Same as #1 but the author wrote a 3-day delay on the assignment**

```json
{ "recommendations": [ { "type": "unsupported-timing", "risk": "high", "patch": true }, { "type": "naming" }, { "type": "missing-alternate-path" } ],
  "watchouts": [ "\"assign to\" is written with a 3 days delay, but delays are persisted but not executed by the current runtime — the action runs immediately. Do not promise timed behavior." ],
  "proposedChanges": [ { "preview": "clear the written delay on action #1" } ],
  "nextBestAction": "Review the recommendation \"Remove the delay that will not run\" and accept or reject it." }
```

## Prohibited consultant behavior

Enforced by construction and pinned by tests — not by prompt discipline:

- **No invented facts.** Every fact derives from the rule, the envelope's own
  sidecars, or the snapshot; every recommendation cites ≥1 fact id that must
  resolve.
- **No flattery or filler.** Rationales state operational consequences.
- **No arming, activation, or approval advice.** `set-control mode "armed"` is
  refused outright; rate-protection explicitly keeps shadow; `requiresApproval`
  is pass-through only.
- **No promises of timed or gated execution.** `delayMinutes` and `when` are
  persisted but NOT executed by the current runtime (R11) — always surfaced as
  high-risk watchouts, never described as working.
- **No invented recipients or values.** Missing params and missing else-paths
  become questions/recommendations, never auto-filled patches.
- **No customer content in `contextUsed`** — source/version pairs only; the
  test seeds a distinctive tenant label and asserts it never appears in a turn.
- **No questions beyond real clarifications**, and never more than two at once.
- **No unpreviewed mutations.** Acceptance applies the exact previewed ops or
  nothing; content-hash verification refuses tampered recommendation objects.
