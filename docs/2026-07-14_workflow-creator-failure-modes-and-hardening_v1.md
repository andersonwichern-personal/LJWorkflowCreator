# AI & Rule Builder — Failure Modes for Lenders + Hardening Design

**Created:** 2026-07-14
**Author:** Anderson Wichern (analysis by Claude; grounded in full source at commit `f5812b3` + the live admin scan)
**Scope:** Every way the Workflow Creator + Approval Authority system can fail a lending team,
what it *cannot* automate today, and the concrete designs that fix it: AI guardrails,
category-vs-instance targeting, exception-friendly authority, multi-person approvals, and a
v3 rule schema (multi-trigger / grouped conditions / conditional multi-action).
**Companions:** build manual v2 (admin architecture), alignment refinements v1 (three-pillar
gaps). This doc goes deeper on *correctness and lending-team reality*.

---

## 1. Failure-mode catalog — how this breaks for a lending team

Organized by layer. **[NOW]** = a real defect in the current code. **[WHEN-LIVE]** = becomes a
defect the moment execution goes live. **[DESIGN]** = missing concept that will bite later.

### 1a. Trigger semantics
| # | Failure | Detail |
|---|---|---|
| T1 | **State/edge conflation** [NOW] | `ruleEngine.requestMatchesEvent` treats events as *states* (`uwStatus === "Approved"`), not *transitions*. Live, a "when approved → notify" rule either fires **every evaluation cycle** while the request sits approved (notification spam) or never fires at the moment of approval. The engine needs edge-triggered semantics: fire on the transition, once. |
| T2 | **Double-fire / no idempotency** [WHEN-LIVE] | Booking retries re-emit events. Without a firing ledger (`workflowId + requestId + eventId` unique), one error produces five escalations and the team learns to ignore them. |
| T3 | **Cascade loops** [DESIGN] | Rule A `change_stage → Processing` triggers Rule B whose action sets it back → infinite loop. Need max-cascade-depth, and "actions caused by a rule don't re-trigger the same rule on the same request." |
| T4 | **Rule races / no ordering** [DESIGN] | Two enabled rules match the same event with conflicting actions (assign to Sara vs assign to Omar; close vs escalate). No priority, no conflict resolution → nondeterministic outcomes on real money. Need explicit priority + a conflict linter (§8). |
| T5 | **Mocked surfaces** [NOW] | System Events & Offers are client-mocked in the admin test tenant (manual §4). Rules keyed to them demo perfectly and do nothing in anything real. The confidence gate covers vocabulary, but the *demo itself* can still mislead — always show the execution-status chip (alignment doc §6c). |
| T6 | **Wrong "amount"** [DESIGN — the big lending one] | `loan_amount` is the per-request amount. Lenders set authority on **aggregate relationship exposure** (this borrower's total commitments across loans + this request). A $50k request from a borrower with $2M outstanding is not a junior-analyst decision. Until exposure is a queryable field, the authority matrix silently under-escalates. See §6. |
| T7 | **Time semantics** [DESIGN] | No business-day calendar. SLA-ish rules (`days_in_stage`) count weekends; a "notify in 48h" (once timers exist) fires Saturday night. Rate-lock and Reg-B-style deadlines are business-time concepts. |

### 1b. Condition evaluation
| # | Failure | Detail |
|---|---|---|
| C1 | **Free-text identity matching** [NOW] | `retailer is "Growmark"` vs platform value `GROWMARK Inc.` → never matches, silently. Same for `customer_name`, `template`, `team_member`, `program`. Root cause: string values instead of ID-bound instances (§4). |
| C2 | **Missing data = silent false** [NOW] | `evalCondition` returns `false` for UNKNOWN/null fields. For compliance-relevant rules that's the wrong default: a rule guarding "risk grade worse than C → escalate" should **fail closed with an alert** when grade is missing, not silently skip. Make null-handling per-rule configurable: `treat_missing_as: no_match | match | alert`. |
| C3 | **Flat logic only** [NOW] | One AND/OR across all conditions. Real credit policy is nested: `(amount > 250k AND grade worse than B) OR (retailer is X AND product is LOC)`. Inexpressible today → §7. |
| C4 | **No cross-field / derived conditions** [DESIGN] | LTV = amount/collateral, debt-to-income, exposure ratios. The form builder has a `COMPUTED` fieldType — piggyback on it rather than inventing a second computation system. |
| C5 | **Silent numeric no-match** [NOW] | Non-numeric value in a numeric condition → `evalCondition` returns false forever. Builder must block at author time (alignment doc §5c). |
| C6 | **No empty/exists operators** [NOW] | Can't express "collateral value is missing" or "no tag present." Add `is_empty` / `is_not_empty` / `exists`. |
| C7 | **Stage-name collisions** [NOW] | The live overlay merges per-template stage names into one flat list. Two templates both having "Approved" mean different things; a `stage is Approved` condition is ambiguous. Instance-scope stages by `templateId + stageId` (§4). |

### 1c. Action execution (once live)
| # | Failure | Detail |
|---|---|---|
| A1 | **Partial multi-action failure** | `notify` succeeds, `assign` 500s → half-applied rule with no record. Need per-action results, retries with backoff, and a dead-letter queue surfaced in run history. |
| A2 | **Mass misfire, no brake** | A bad condition matches 300 requests → 300 closes. Need a **circuit breaker** (auto-pause on anomalous fire rate + notify the author) and optional batch-confirm for destructive actions (`close_request` should default to "queue for human confirm above N per hour"). |
| A3 | **No undo/compensation** | `close_request` and `set_underwriting_result` are decisions of record. Every destructive action needs a compensating path and the run history to drive it. |
| A4 | **Assignee drift** | Rule assigns to a user who was disabled or left (the 43-user list changes). Validate assignees at fire time; per-rule fallback assignee; a "broken references" report (§8). |
| A5 | **Notification fatigue** | Ten rules each notify the Booking Team → inbox blindness, which for a lender means missed real errors. Digest window + dedupe per (recipient, requestId, reason). |
| A6 | **Auto-decision without the legal side** [lending-specific] | An automated `set_underwriting_result: Rejected` is an **adverse action** — ECOA/Reg B requires a compliant notice within 30 days. The builder should refuse (or hard-warn) auto-reject actions unless paired with the platform's Letters template step. Same class of issue: auto-approval rules are fair-lending sensitive — see §8 "prohibited-basis lint." |

### 1d. AI layer (today's regex parser and any future LLM)
| # | Failure | Detail |
|---|---|---|
| N1 | **Invented assignees/values** [NOW] | `nlParser.matchOutputs`: `assign to <raw>` falls back to `fromOriginal(raw)` when the name isn't a known assignee — "assign to Santa Claus" drafts a rule assigning to Santa Claus. Same for `notify`, `add_tag`, and text-condition values. This is the "random inputs/outputs" hole — the parser **coerces instead of rejecting**. |
| N2 | **Silent partial parse** [NOW — the most dangerous one] | "When a loan over 250k is approved and DSCR is under 1.2, escalate to committee and request tax returns" → parser catches the event + amount, may drop the DSCR clause and the document request, and the only signal is a small notes list. The author believes the whole policy is captured. A rule that does *less than the lender believes* is worse than no rule. |
| N3 | **Keyword misclassification** [NOW] | `matchEvent`: "approved" → LOAN APPROVED even when the sentence was about *document* approval; "declined" → LOAN REJECTED when it's an *offer* decline. |
| N4 | **Negation blindness** [NOW] | "if retailer is not Growmark" partially handled; "don't assign to Wael, assign to Sara" → regex can capture the negated target. |
| N5 | **LLM-graduation risks** [DESIGN] | A raw LLM will invent field keys, enum values, plausible-but-wrong thresholds, and confident event choices. §3 is the containment design. |

### 1e. Authority & approval
| # | Failure | Detail |
|---|---|---|
| AA1 | **Matrix is inert** [NOW] | No evaluator (alignment doc §7) — nothing decisions against it. |
| AA2 | **Per-request amount ≠ exposure** | See T6. |
| AA3 | **Exceptions require matrix surgery** | The only way to handle a one-off overage today is edit the level or bypass entirely — both wrong. §5 designs the exception lanes. |
| AA4 | **Single-approver assumption** | `userIds` is a flat member list; no quorum, no sequence, no separation of duties. A committee decision (2-of-5) or maker-checker (preparer ≠ approver) is inexpressible. §6. |
| AA5 | **Absence deadlock** | Approver on vacation → deals stall at their level with no delegation. §5. |
| AA6 | **No decision explainability** | An examiner asks "why did this $480k B-grade LOC auto-approve?" — must be answerable from the audit trail: matrix version + inputs + decision + who. §8. |

### 1f. Governance / operations
| # | Failure | Detail |
|---|---|---|
| G1 | **Anyone can silently change credit policy** | Rules and authority levels are editable with no approval, no versioning. A rule governing millions in credit needs four-eyes on activation and a change log (rules-about-rules: the authority matrix should itself gate rule changes above a materiality threshold). |
| G2 | **Vocabulary drift** | A referenced template/field/retailer is renamed or deleted in the admin → the rule silently never matches again. Nightly "broken references" audit + rename-safe ID refs (§4). |
| G3 | **No observability** | Without run history + would-have-fired logs, nobody can answer "is this rule working?" §8 shadow mode. |

---

## 2. What you cannot automate today — the expressiveness gaps

Honest inventory, mapped to what a lending team will actually ask for in the first month:

| Wanted automation | Why it's impossible today | Unlock |
|---|---|---|
| "Remind the borrower if docs are outstanding 5 days" | No timers/scheduler; rules are single-shot on events | **Timer/SLA engine**: delayed actions + `days_in_X` conditions on a business calendar |
| "Escalate if nobody touches it in 48h" | Same — no time-based triggers | Same |
| "Annual covenant review every March; renewals 90 days before maturity" | No scheduled/recurring triggers — **and Covenant is a first-class request type**, so this gap blocks a whole product line | **Cron-style triggers** (`on_schedule`) alongside event triggers |
| "When approved: request signature, wait for it, then send booking" | No sequencing/wait-states; all actions fire at once | **Multi-step workflows** (do → wait-for-event → do); v3 keeps single rules, a later `sequence` type chains them |
| "If A route to X, otherwise route to Y" | No else-branch; requires two rules with hand-inverted conditions that drift apart | **`else` actions** in v3 (§7) |
| "Third rejected application from this borrower in 12 months → flag" | No historical/aggregate conditions | **Aggregate condition type** (count over window per customer) — backend-required |
| "Any of this borrower's other loans goes delinquent → hold this application" | No cross-request/relationship triggers | Relationship-scoped triggers (needs exposure model, §6) |
| "Retailer's portfolio default rate > 5% → tighten auto-approve" | Portfolio-level conditions | Aggregate conditions over retailer dimension |
| "When extracted DSCR < 1.2 …" | Extraction events gated (unconfirmed emit); no doc-content operands | Manual §12 Q3 + ID-bound form/extraction fields |
| "Run this rule now on these 40 requests" | No manual/bulk trigger | **`run manually` trigger** + multi-select from Underwriting — cheap and very high utility |
| "Committee of 5, need 2 approvals, preparer can't vote" | Flat `userIds` | §6 approval requirements |
| "When approved OR offer accepted → same actions" | Single trigger event per rule | v3 `triggers[]` (§7) |

The point of writing these down: **say them out loud in the demo.** "Not yet, and here's the
schema slot where it lands" is credible; discovering it live is not.

---

## 3. Keeping the AI honest — no hallucinated inputs or outputs

Design principle: **the AI never authors the rule; it fills slots in a schema whose every
slot is validated against a closed registry.** Free text exists in exactly three places (tag
names, numeric thresholds, note text) and each is explicitly confirmed by the human.

### 3a. Fix the current deterministic parser first
1. **Reject, don't coerce** (kills N1): in `matchOutputs`, when the captured assignee doesn't
   resolve against the (live) assignee list, emit an **unresolved slot**, not a made-up value:
   `{ action: "assign_user", params: {}, unresolved: { param: "assignee", heard: "santa claus", suggestions: [...fuzzy matches] } }`
   The builder renders it as a red "needs your pick" chip; the rule **cannot be saved** with
   unresolved slots. Same for notify targets, stage names (already validated — keep), enum
   values, and text-condition values that should be instances (retailer/customer/template →
   resolve against live vocabulary IDs, §4).
2. **Coverage meter** (kills N2): the parser knows what it consumed. Report the leftover:
   diff the input against matched spans and surface **"I didn't understand: 'and request tax
   returns'"** prominently — not a bullet note, an amber banner on the drafted rule. A partial
   parse must *look* partial.
3. **Ambiguity → question, not guess** (kills N3): when keyword routing could hit two events
   ("approved" with "document" nearby), return both candidates and make the user pick. One
   extra click beats a silently wrong trigger.
4. **Negation scan** (kills N4): strip/flag `don't|do not|never <action>` clauses before
   action matching.

### 3b. When you graduate to a real LLM
- **Constrained generation**: the LLM's only output channel is a tool call / JSON-schema whose
  enums are generated from the vocabulary registry (event keys, field keys per selected event
  — the P1 binding — operator sets per field kind, action keys, live instance IDs). It is
  *structurally unable* to output an unknown token.
- **Post-validate anyway** (defense in depth): run the same validator the manual builder uses
  (`allowedFieldsForEvent`, enum membership, ID existence in live vocab, numeric parse). Any
  violation → unresolved slot, never auto-repair.
- **Echo-back loop**: after drafting, render the plain-English `Reads as` sentence (already
  built — `plainSummary`) and require an explicit confirm before save. The human signs the
  sentence, not the JSON.
- **Never auto-save, never auto-enable.** AI output lands as a dirty draft. Enabling stays a
  human act (and, per G1, eventually a four-eyes act).
- **Determinism where it counts**: temperature 0, and keep the regex parser as the fallback +
  the demo path (foundation brief §6 already mandates deterministic on stage).
- **Eval harness**: a checked-in suite of `instruction → expected rule JSON` cases (start with
  the 4 pill examples + every failure in §1d) run in CI; the LLM path must match the suite
  before it ships. Log every prompt→rule pair in production for drift review. This is your
  model-risk-management story when a bank examiner asks how the AI is controlled.

---

## 4. Category vs instance — the scoping model, tested across every token

**The requirement:** "loan template" (category) vs "the GROWMARK renewal template" (instance)
— and the same nuance everywhere it applies.

**Design:** one uniform scope union on every reference-shaped token:

```ts
type Scope =
  | { level: "any" }                                   // all of the kind
  | { level: "category"; category: string }            // a type/class
  | { level: "instance"; id: string; label: string };  // one specific thing (ID is truth,
                                                        // label is display cache — rename-safe)
```

Applied systematically across the existing vocabulary (this is the audit you asked for):

| Token (today) | Category level | Instance level | Verdict |
|---|---|---|---|
| `template` (free text) | request type: Loan Application / Origination / Covenant (= existing `reqtype` field) | a specific request template by `templateId` (live vocab already fetches these) | **Both needed.** Today instance is free-text (C1). Fold `reqtype` + `template` into one scoped token: `request template — any / type / specific`. |
| `stage` | the 4 global stages | **per-template stage** (`templateId + stageId`) — templates define their own stage lists | **Both needed**; flat merge is ambiguous today (C7). |
| `retailer` (free text) | all retailers (or retailer *program* as the grouping) | specific retailer by `retailerId` (live vocab fetches with IDs) | **Both.** Instance must be ID-bound. |
| `program` (free text) | program family | specific program | Same treatment; needs the Coverage endpoint (manual §12 Q7). |
| `customer_name` (free text) | `custtype`: Business / Individual (exists) | specific customer by `customerId` | **Both.** Merge `custtype` + `customer_name` into one scoped customer token. Relationship scope (= this customer across all their requests) is the §6 exposure unlock. |
| `team_member` / assignee params (names) | **team/group** — note: platform has no teams UI, but `iam` supports `?groups=EMPLOYEES`, so groups exist in the backend; today's "Underwriting Team" strings are fictional | specific user by `userId` | **Both, but honesty required**: keep pseudo-teams badged `unconfirmed` until the iam groups model is confirmed; instances go ID-bound now. |
| `loan_product` | Term Loan / Line of Credit (exists) | a specific configured product (the Coverage step's eligible products) | **Instance missing entirely** — matters for `make_offer` and the authority matrix product dimension. |
| form fields (Application Data group, free text) | field *type* (`LOAN_INFORMATION`, `CROP_DETAILS`, `LIVESTOCK`…) — "any livestock field on any form" | `formTemplateId + fieldId` (the alignment doc §5a union) | **Both**, and category-by-fieldType is a genuinely useful middle level the current design misses: "IF any MONEY field on the application exceeds…" |
| documents / checklists | checklist or file-template *type* (`templateType=FILE` exists) | specific checklist/doc template by ID | Both — powers `request_document` / `assign_checklist` params, which are free text today. |
| `core` / booking | core system (FISERV / FMAC) — this *is* a category | a specific booking event (for retry/escalate targeting) | Category exists; instance becomes relevant only for booking-remediation actions. |
| trigger events | event *family* (booking events / document events / decision events) | specific event type | Add family grouping to the picker as the vocabulary grows past ~20 events; families also organize the P1 condField sets. |
| authority (action param, name string) | lane (auto-approve / manual) | specific level by `authorityId` | Instance must go ID-bound (rename-safe); lane targeting is a nice-to-have. |
| `tags` | — | the tag string is its own identity | Free text is correct here; add autocomplete from tags in use. |
| intake (`intake_path`) | path category (Intake Link / Wizard / Blank) | a **specific intake link** by ID | Both — "requests from *this* campaign link" is a real marketing ask; live vocab already fetches public-link forms. |

**Implementation:** extend the v2→v3 condition/action value shape from bare `string` to
`string | Scope`. Pickers get a two-step affordance: pick the kind → "Any / by type / specific…"
with the specific list fed by live vocabulary. `normalizeRule` coerces legacy strings to
`{level:"instance", label: <string>}` with a broken-ref flag until matched to an ID. The
**broken-references audit** (G2) runs over all instance refs nightly.

---

## 5. Approval authority without exception pain

The matrix answers "who *can* approve this." The pain is everything that doesn't fit. Add
four first-class objects around the matrix instead of forcing matrix edits:

1. **Exception requests** — when a deal exceeds a level's box, the holder clicks *Request
   exception* → a structured object `{requestId, authorityId, delta: "amount over by $2,400",
   justification, expiresAt}` routed to the escalation target. Approve/deny in one click **with
   the delta highlighted** (the approver reviews the $2,400, not the whole file cold). Every
   exception is logged with who/why — the examiner trail is automatic. The matrix never
   changes.
2. **Tolerance bands** — per level, optional `overageTolerance` (% or $) with guard conditions
   (e.g., only grade A/B) and a usage budget (n per user per quarter). Deals inside tolerance
   take a **co-sign lane**: the holder + one peer sign instead of bumping a full level.
   Removes ~80% of trivial exceptions (the $92k deal at a $90k limit) without weakening the
   matrix.
3. **Delegations** — `{fromUserId, toUserId, scope: authorityId | all, startsAt, endsAt,
   reason}`; auto-expires; decisions taken under delegation are stamped "as delegate of X."
   Kills the vacation deadlock (AA5).
4. **Time-boxed overrides** — seasonal/campaign raises (`limit +$50k for LOC, March–May`) with
   mandatory expiry, so temporary policy never becomes permanent by forgetfulness.

Plus a **break-glass** path: a designated role can override any gate with a mandatory reason,
which lands in a mandatory after-the-fact review queue. Banks need this; the audit trail is
what makes it safe.

`decideAuthority()` (alignment doc §7) grows one input (active delegations/overrides) and one
output (`lane: "co-sign" | "exception-required"` added to auto/manual/escalate).

---

## 6. Multi-person approvals and multi-task gates

Replace the flat `userIds: Json` with an **approval requirement** the evaluator can enforce:

```ts
type ApprovalRequirement =
  | { type: "any_of";  approvers: Scope[]; }                    // one signature from the pool
  | { type: "n_of";    approvers: Scope[]; count: number }      // committee quorum: 2 of 5
  | { type: "all_of";  approvers: Scope[] }                     // dual/triple sign-off
  | { type: "sequence"; steps: ApprovalRequirement[] };         // officer THEN committee
```

Semantics that matter to a lending team:
- **Separation of duties (maker-checker):** an `exclusions` clause — the request owner /
  preparer / rule author is never an eligible approver of their own item. This is a compliance
  requirement, not a feature.
- **Parallel vs sequential:** `n_of`/`all_of` fan out in parallel; `sequence` gates strictly.
  A committee that only convenes after the officer signs = `sequence[any_of(officers),
  n_of(committee, 2)]`.
- **Votes, not just signatures:** approve / decline / abstain with a quorum-and-majority
  policy and captured dissent notes — committees decline things, and the dissent record
  matters later.
- **Claim semantics for pools:** `any_of` tasks land in a shared queue (mirrors the platform's
  existing Unassigned→Assigned idiom); claim → work → complete; unclaimed past a timeout →
  escalate or return to pool.
- **Different tasks for different people (your second case):** this is a **task group**, not
  an approval: `{ tasks: [{name: "Complete credit analysis", assignee, taskType}, {name:
  "Verify collateral docs", assignee}], completionPolicy: "all" | "any" | n, then: actions[] }`
  — the request can't advance past the gate until the policy is met. The platform already has
  per-customer task sections with To-Do/Submitted/Approved; this reuses that idiom for
  *internal* tasks, so it will feel native in the admin.
- **Absence handling:** requirements resolve through active delegations (§5.3) at
  evaluation time, so a quorum doesn't deadlock on one vacation.

Prisma change: `ApprovalAuthority.userIds` → `requirement Json` (with `normalizeRequirement()`
upgrading old arrays to `{type:"any_of"}`), plus `approval_tasks` and `approval_decisions`
tables so every signature is a row, not a mutation.

---

## 7. Rule schema v3 — many inputs, grouped conditions, conditional outputs

Current v2: one trigger event, one flat AND/OR condition list, unconditional action list.
The asks — multiple inputs, more than one condition per input, more than one output — plus the
§1 fixes, land in one coherent rev:

```jsonc
{
  "schemaVersion": 3,
  "triggers": [                                   // ① multiple inputs (OR-of-events)
    { "event": "LOAN APPROVED", "scope": { /* optional §4 scope, e.g. one template */ } },
    { "event": "OFFER ACCEPTED" }
  ],
  "conditions": {                                 // ② nested groups, 2 levels max in UI
    "logic": "AND",
    "children": [
      { "field": {"kind":"attribute","key":"loan_amount"}, "op": "gte", "value": 250000 },
      { "logic": "OR", "children": [
        { "field": {"kind":"attribute","key":"risk_grade"}, "op": "worse_than", "value": "B" },
        { "field": {"kind":"formField","formTemplateId":"…","fieldId":"…"}, "op": "is_empty" }
      ]}
    ]
  },
  "actions": [                                    // ③ multiple outputs, each optionally gated
    { "type": "assign_user", "params": {"assignee": {"level":"instance","id":"…","label":"Sara"}} },
    { "type": "notify", "params": { … }, "when": { /* per-action condition */ },
      "delayMinutes": 0, "onFailure": "retry" }
  ],
  "else": [ { "type": "add_tag", "params": {"value":"below-threshold"} } ],   // ④ alternate path
  "controls": {                                   // ⑤ the §1 safety rails live in the rule
    "oncePerRequest": true,
    "maxFiresPerHour": 25,
    "missingData": "no_match" | "alert",
    "priority": 100
  }
}
```

Design decisions worth stating:
- **Multiple triggers are OR-of-events**, and the builder must constrain conditions to the
  **intersection** of the triggers' `condFields` (the P1 binding generalizes: a field is
  offerable only if *every* selected trigger provides it). If authors need per-trigger
  conditions, that's two rules — clearer than a mega-rule.
- **Cap visual nesting at 2 levels.** Infinitely nestable groups are how no-code builders
  become unreadable; two levels (`AND of ORs` / `OR of ANDs`) expresses essentially all credit
  policy. The schema allows deeper; the UI doesn't encourage it.
- **`else` is deliberately small** — actions only, no nested else-if chains. If/else-if
  ladders are a routing *table*, which deserves its own future construct, not rule spaghetti.
- **Sentence UX survives**: `WHEN [approved] or [offer accepted] IF [amount ≥ $250k] and
  ([grade worse than B] or [DSCR missing]) THEN [assign Sara] and [notify …] OTHERWISE [tag]`.
  Groups render as parenthesized token clusters — still one readable sentence.
- `normalizeRule` upgrades v2→v3 (`trigger` → `triggers[0]`, flat rules → one group), keeping
  every persisted rule and the NL parser output valid. The parser targets v3 but only ever
  emits what it can prove (single trigger, flat group) — humans add the sophistication.

---

## 8. Out-of-the-box: what makes this *smooth* for a lending team

Ranked by trust-per-effort:

1. **Shadow mode** — every new rule starts in *observe*: it logs "would have fired on request
   X, would have done Y" for N days before it's armable. Builds trust, tunes thresholds, and
   catches C1-style never-matches (a rule that logs *nothing* in shadow is broken). This is
   the single best feature for adoption — lenders don't trust automation they haven't watched.
2. **Backtest** — "this rule would have fired 37 times last quarter" against historical
   requests, with the list. Same engine as shadow mode, pointed backwards.
3. **Rule linter** — on save: overlapping rules (same trigger, intersecting conditions,
   conflicting actions → T4), dead rules (unsatisfiable conditions), broken instance refs
   (G2), missing-data exposure (C2), and the **compliance lints**: auto-reject without a
   letters step (A6), and a **prohibited-basis warning** when routing/auto-decision conditions
   use fields that can proxy protected classes (geography-heavy retailer splits, etc.) —
   flag for fair-lending review, don't block.
4. **Plain-English audit trail** — every fire persists: the sentence, the input snapshot, the
   matrix version, actions + results, and *who/what* (rule vX, enabled by Y on date Z).
   Answers AA6 and is the examiner deliverable. The `reason` string from `decideAuthority()`
   goes here too.
5. **Four-eyes on activation** (G1) — enabling/editing a rule above a materiality threshold
   (touches `set_underwriting_result`, `close_request`, authority levels) requires a second
   approver. Dogfood: it's just an `all_of` requirement (§6) applied to rule changes.
6. **Circuit breaker + kill switch** — per-rule anomaly pause (A2) and one global "pause all
   automations" button. The day something goes wrong, the kill switch is the difference
   between an incident and a story.
7. **Manual/bulk trigger** — "run rule on selected requests" from the Underwriting queue.
   Cheap, and it's how teams migrate existing books onto new policy.
8. **Business calendar** — bank holidays + business-day math before any timer feature ships (T7).
9. **Digest notifications** — per-recipient batching window (A5).
10. **Exposure service** (T6/AA2) — aggregate relationship exposure as a first-class condition
    field and `decideAuthority()` input. Backend-required and genuinely hard (entity
    resolution across borrowers/guarantors), but it is the difference between a demo authority
    matrix and one a credit officer will sign off on. Flag it now as the known ceiling.

---

## 9. Priority order (what to build in what sequence)

| Phase | Items | Why first |
|---|---|---|
| **P0 — correctness of what exists** | N1 reject-don't-coerce, N2 coverage meter, C5 numeric author-time validation, C6 empty operators, T5/A6 execution-status + auto-reject lint | All are small; all prevent *lying to the author* |
| **P1 — the schema moves** | §4 Scope union + ID-bound instances (kills C1/C7/G2 root), §7 v3 schema (triggers[]/groups/else/controls), §6 ApprovalRequirement + decideAuthority with delegations | Everything else hangs off these contracts; do them before more UI accretes on v2 |
| **P2 — trust machinery** | Shadow mode + backtest + run history (needs P1 controls), rule linter v1, circuit breaker | The adoption unlock; also your demo's best moment ("watch it in shadow first") |
| **P3 — reach** | Timers/SLA + business calendar, scheduled triggers (unlocks Covenant/renewals), exception objects + tolerance bands, manual/bulk trigger | Each unlocks a §2 "impossible" row |
| **P4 — depth** | Exposure service, aggregate/historical conditions, sequences/wait-states, LLM parser behind the §3b harness | Backend-heavy; schedule against the admin repo work |

---

## 10. One-paragraph summary for the team

The builder's bones are right, but today it can silently do **less than the author believes**
(partial NL parses, free-text values that never match, missing-data-as-false), can't express
half of real credit policy (nested logic, timers, quorums, exposure), and — once execution
lands — has none of the rails that make automation trustworthy at a bank (edge-triggered
idempotent firing, circuit breakers, shadow mode, audit trail, four-eyes). The fixes are not a
rewrite: a Scope union for category-vs-instance targeting, a v3 schema (multi-trigger, grouped
conditions, gated multi-action + else), an ApprovalRequirement model with delegations and
exception objects, and a reject-don't-coerce AI contract validated against the live
vocabulary. Build P0/P1 before any more surface area — every new feature added on v2 strings
is future migration debt.

### Change log
- **2026-07-14 (v1)** — Initial failure-mode catalog (26 modes across 6 layers), expressiveness
  gap inventory, AI containment design (regex fixes + LLM harness), category/instance scope
  audit across all 16 token kinds, exception-lane authority design, multi-party approval model,
  v3 rule schema, and the trust-machinery roadmap.
