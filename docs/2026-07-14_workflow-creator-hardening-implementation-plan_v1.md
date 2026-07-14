# Hardening Implementation Plan — Workflow Creator + Approval Authority

**Created:** 2026-07-14
**Baseline commit:** `48d17b6` (main — *after* the alignment-refinements PR #2 merge)
**Implements:** `2026-07-14_workflow-creator-failure-modes-and-hardening_v1.md` (the WHAT/WHY)
**Audience:** implementing agents (Claude in this repo, Gemini as verifier). This is a work
order: every phase lists exact files, contracts, algorithms, tests, and acceptance criteria.

---

## 0. Ground rules — read before writing any code

### 0a. What is ALREADY DONE at the baseline (do not re-implement)
The alignment-refinements PR (`6779df8`…`48d17b6`) already delivered:

| Done | Where |
|---|---|
| ID-bound form-field conditions (`FormFieldRef`, `condFieldKey/Label/Kind/Def`) | `lib/vocabulary.ts:~975-1015` |
| Live per-form field fetch → `LiveField[]` registry (bounded by `MAX_FORM_FETCHES`) | `lib/platform.ts` (`toLiveFields`) |
| Live fields grouped in the condition picker (`ff:<form>:<field>` encoding) | `components/RuleSentence.tsx` (`FF_PREFIX`, `fieldOptionsFor`) |
| Org identity from session: `/api/platform/me` → `getOrgId()` memoized in the client | `app/api/platform/me/route.ts`, `lib/api.ts` |
| `execution` descriptor (`sink`/`status`) on every `ActionDef` | `lib/vocabulary.ts` (ACTIONS) |
| Action executor: `POST /api/execute` — `notify`→Novu (env-gated), `assign_authority`→evaluator, all others honestly report status | `app/api/execute/route.ts` |
| `decideAuthority()` v1 (covers/lanes/escalation-chain/reason) | `lib/authorityEngine.ts` |
| Traced dry-run simulator + per-action execution-status chips | `lib/ruleEvaluator.ts`, `components/SimulationPanel.tsx`, `components/TraceView.tsx` |
| Rule-execution audit log (`rule_executions` table + service + UI + simulate route logging) | `prisma/migrations/20260714182151_*`, `lib/services/execution.ts`, `components/AuditLogs.tsx`, `app/api/workflows/simulate/route.ts` |
| `.env.local.example` retitled; matrix decision preview in Approval Authorities | repo root, `components/ApprovalAuthorities.tsx` |

**Remaining scope** (this plan): NL-parser honesty, schema v3, Scope refs for
category-vs-instance, ApprovalRequirement, shadow mode / backtest / linter / circuit breaker,
and the deferred stubs.

### 0b. Conventions
- **No new runtime deps.** Validation is hand-rolled (`lib/ruleValidation.ts`), tests are
  `tsx`-run assertion scripts (the repo's existing practice; `tsx` is already in devDeps).
  Do not add zod/vitest/jest without a separate decision.
- **Back-compat is permanent.** `normalizeRule()` must forever read legacy v1
  (`{event,conds,outputs}`), v2, and v3. Same for `normalizeRequirement()` (Phase 3). No
  data migration rewrites persisted `rule_json`.
- **Never regress the honesty system**: `confidence` badging, `execution.status` chips, and
  `ruleUsesUnconfirmed()` must keep working through every schema change.
- **Every phase ends green**: `npm run lint && npm run build && npm run test` (test script
  added in Phase 0) before the next phase starts. One PR per phase.

### 0c. Errata & consistency register (deviations from the two analysis docs — deliberate)
| # | Prior doc said | This plan does | Why |
|---|---|---|---|
| E1 | Hardening §7 example shows numeric condition values as JSON numbers (`"value": 250000`) | **Condition/param values stay `string`** in v3 (`"250000"`), validated numeric at author time | The entire codebase (TokenPicker, evaluators, persisted rows) uses string values with `Number()` coercion at eval. Changing the wire type buys nothing and risks silent breakage of saved rules. |
| E2 | Hardening §8 proposed a `workflow_runs` table | **Extend the existing `rule_executions` table** (add `mode` column) | The table, service, UI, and migration already exist at baseline; a second run table would be redundant. |
| E3 | Hardening §6a table listed `assign_authority` as purely "backend-required" | Executor already resolves it via `decideAuthority()` and returns routing; the **hard gate** remains backend-required | Landed in the baseline PR; keep the distinction: *resolution* is live, *enforcement* is not. |
| E4 | Hardening §4 `Scope` union proposed for *all* refs including condition fields | Condition fields keep the existing `ConditionFieldRef` (attribute string \| FormFieldRef); **`ScopeRef` is introduced for values/params** (assignees, templates, retailers, customers, stages) | `ConditionFieldRef` already ships and serves the field-side need; retrofitting it into `ScopeRef` is churn without new capability. The category/instance nuance lives in *values*, which are bare strings today. |
| E5 | Hardening §1d/N-fixes implied parser fixes могли land on v2 | Phase 0 parser fixes land on **v2** (sidecar `unresolved`, not persisted); parser emits v3 only after Phase 1 | Keeps Phase 0 shippable independently. |

---

## 1. Locked contracts (the specifications everything follows)

These are locked *specs*, not a single commit: each type lands with its phase (v3 types in
Phase 1, `ScopeRef` in Phase 2, `ApprovalRequirement` in Phase 3). Phase 0 touches none of
them.

### 1a. Rule schema v3 — `lib/vocabulary.ts`
```ts
export const RULE_SCHEMA_VERSION = 3;

/* -- triggers ------------------------------------------------------------ */
export interface TriggerRef {
  event: string;                    // EventDef.key
  /** Optional instance scope, e.g. only requests from one template (Phase 2). */
  scope?: ScopeRef;
}

/* -- conditions: recursive groups ---------------------------------------- */
export interface ConditionLeaf {
  field: ConditionFieldRef;         // unchanged from baseline
  operator: string;
  value: string;                    // E1: never JSON numbers. Phase 2 widens instance-shaped
                                    // fields to `string | ScopeRef` (§4.1); numerics stay string.
}
export interface ConditionGroup {
  logic: CondLogic;                 // "AND" | "OR"
  children: ConditionNode[];
}
export type ConditionNode = ConditionLeaf | ConditionGroup;
export function isGroup(n: ConditionNode): n is ConditionGroup {
  return (n as ConditionGroup).children !== undefined;
}

/* -- actions -------------------------------------------------------------- */
export interface RuleOutput {
  action: string;
  params: Record<string, string | ScopeRef>;   // widened in Phase 2; string-only until then
  /** Optional per-action gate, same node type as the root conditions. */
  when?: ConditionGroup;
  /** Reserved for the timer engine (Phase 5). Persisted, ignored by the evaluator until then. */
  delayMinutes?: number;
  onFailure?: "retry" | "skip" | "halt";       // default "retry"
}

/* -- controls (the safety rails live in the rule) ------------------------- */
export interface RuleControls {
  mode: "shadow" | "armed";         // default "shadow" — every rule observes before acting
  oncePerRequest: boolean;          // default true  (T2 idempotency)
  maxFiresPerHour: number;          // default 25    (A2 circuit breaker threshold)
  missingData: "no_match" | "alert";// default "no_match" (C2)
  priority: number;                 // default 100; lower runs first (T4)
}
export function defaultControls(): RuleControls { /* the defaults above */ }

/* -- the rule -------------------------------------------------------------- */
export interface WorkflowRule {
  schemaVersion: number;            // 3
  triggers: TriggerRef[];           // ≥1; OR semantics across triggers
  conditions: ConditionGroup;       // root group; children may nest
  actions: RuleOutput[];
  else?: RuleOutput[];              // fires when triggers match but conditions don't
  controls: RuleControls;
}
```

**Depth caps (stated once, enforced twice):** the *UI* never creates nesting deeper than
**2 levels** (root + one sub-group). The *validator* rejects depth > **4** (headroom for
programmatic writers). These are different numbers on purpose — do not "align" them.

### 1b. `ScopeRef` — category vs instance (Phase 2)
```ts
export type ScopeRef =
  | { level: "any" }
  | { level: "category"; category: string }                 // e.g. requestType, custtype
  | { level: "instance"; id: string; label: string };       // id = platform UUID; label = display snapshot
```
Serialized params/values are `string | ScopeRef`. A bare `string` is the legacy/free-text
form; helpers below make consumers total:
```ts
export function scopeLabel(v: string | ScopeRef): string;    // display
export function scopeInstanceId(v: string | ScopeRef): string | null;
export function isLegacyString(v: string | ScopeRef): v is string;
```

### 1c. `ApprovalRequirement` (Phase 3)
```ts
export type ApprovalRequirement =
  | { type: "any_of";  approvers: Approver[] }
  | { type: "n_of";    approvers: Approver[]; count: number }
  | { type: "all_of";  approvers: Approver[] }
  | { type: "sequence"; steps: Exclude<ApprovalRequirement, {type:"sequence"}>[] }; // no nested sequences
export interface Approver { id: string; label: string }      // instance-level ScopeRef shorthand
```
`normalizeRequirement(raw)`: legacy `userIds: string[]` → `{type:"any_of", approvers:
userIds.map(u => ({id:"", label:u}))}` (empty id = legacy-unresolved; the broken-refs audit
reports it, nothing breaks).

### 1d. Parser result with unresolved slots (Phase 0)
```ts
export interface UnresolvedSlot {
  where: "action-param" | "condition-value" | "event";
  actionIndex?: number;           // for action-param
  conditionIndex?: number;        // for condition-value
  param?: string;                 // e.g. "assignee"
  heard: string;                  // raw captured text
  suggestions: string[];          // fuzzy matches from the (live) option list
}
export interface ParseResult {
  rule: WorkflowRule | null;
  notes: string[];
  unresolved: UnresolvedSlot[];   // sidecar — NEVER persisted into rule JSON
  uncovered: string[];            // input spans the parser did not consume (N2)
  ambiguities: { question: string; options: string[] }[];  // N3
}
```

---

## 2. PHASE 0 — Parser honesty + author-time validation (no schema change)

**Fixes:** N1 (invented values), N2 (silent partial parse), N3 (event misclassification),
N4 (negation), C5 (numeric author-time), C6 (empty operators), plus evaluator consolidation.

### 2.1 `lib/nlParser.ts` — reject, don't coerce
- **N1:** In `matchOutputs`, delete the `fromOriginal()` fallback for `assign_user` and
  `notify`. Resolution order for a captured name: exact (case/space-insensitive) match
  against the assignee option list → accept; else fuzzy candidates (see 2.5) → emit the
  action with **empty param** + an `UnresolvedSlot` carrying `heard` + `suggestions`; never
  fabricate a value. `add_tag` keeps free text (tags are self-identifying — hardening §4) but
  trims/normalizes. Text-condition values for instance-shaped fields (`retailer`,
  `customer_name`, `template`, `team_member`, `main_borrower`, `program`) resolve the same
  way against live/static options: no match → `UnresolvedSlot` on the condition.
- **N2 coverage:** track consumed character spans. `matchEvent`, each condition regex, and
  each output regex record `[start,end)` of their match in the normalized text. After
  parsing, compute the leftover: split unconsumed text on the consumed spans, drop stopwords/
  connectors (`when/if/then/and/or/the/a/is/,/./fires`), keep fragments ≥ 3 words →
  `uncovered[]`. Note: span tracking needs the regexes to run with indices — use `d` flag
  (`/…/d`, ES2022 — supported by the repo's TS target; verify `tsconfig.json` `lib` includes
  `ES2022` and add if missing).
- **N3 ambiguity:** in `matchEvent`, when a generic keyword matches (`approved`, `rejected`,
  `declined`) **and** a disambiguating noun is present (`document`, `offer`, `signature`),
  do not pick — emit `ambiguities: [{question: "Did you mean document approval or loan
  approval?", options: ["LOAN APPROVED", "DOCUMENT APPROVED"]}]` and return `rule: null`.
  Only auto-pick when exactly one interpretation survives.
- **N4 negation:** before output matching, scan for `(don't|do not|never|without)\s+
  (assign|notify|close|tag|change)` — matched verbs are excluded from output matching, and a
  note explains: `Ignored negated instruction: "don't assign to Wael".`
- The parser **still emits v2** in this phase (E5); `ParseResult` gains the new sidecar
  fields with empty defaults so `ChatBox` compiles before and after Phase 1.

### 2.2 `components/ChatBox.tsx` — surface the honesty
- `run()` passes the full `ParseResult` up: `onDraft(rule, meta)` where
  `meta = { unresolved, uncovered, ambiguities }`.
- **Uncovered banner** (amber, prominent — not a bullet): `⚠ I didn't understand: "…" — the
  drafted rule does NOT include this.` One line per fragment.
- **Ambiguity picker:** render the question with one button per option; clicking re-runs
  `parseInstruction` with the choice pre-resolved (pass `{ forceEvent }` as a new optional
  second arg to `parseInstruction`).

### 2.3 `components/WorkflowCreator.tsx` + `components/RuleSentence.tsx` — unresolved chips
- `WorkflowCreator` holds `unresolved: UnresolvedSlot[]` state (from chat meta; cleared on
  manual token edit of that slot). `save()` blocks while `unresolved.length > 0` with toast
  `Resolve the highlighted values before saving.`
- `RuleSentence` accepts `unresolved?: UnresolvedSlot[]`; a slot's pill renders in the danger
  palette with the label `needs your pick` and opens its picker pre-filtered to
  `suggestions`. Selecting a value calls a new `onResolve(slot)` callback.

### 2.4 Operators & author-time validation
- `lib/vocabulary.ts` `OPERATORS`: add to **every** kind: `{value:"is_empty", label:"is
  empty"}`, `{value:"is_not_empty", label:"is not empty"}`. Add a new kind entry
  **`orderedEnum`** to `FieldKind` (`"enum" | "text" | "numeric" | "orderedEnum"`) with the
  enum operators plus `{value:"worse_than", label:"is worse than"}`, `{value:"better_than",
  label:"is better than"}`. Flip `risk_grade` to `kind: "orderedEnum"` (options already
  ordered A→E). Audit every `switch`/lookup on `FieldKind` for exhaustiveness
  (`OPERATORS[kind]`, `TokenPicker` numeric flag, `RuleSentence` value picker, evaluators).
- Evaluator semantics for the empty ops — precise, because `traceCondition` currently guards
  with `known &&`: **unknown ≠ empty.** When the resolver reports `known: false` (field not
  in the data model at all), `is_empty` does **not** match (and `missingData: "alert"`
  alerts, Phase 1). When `known: true` and the value is `null`/`""`, `is_empty` matches —
  so `evaluateCondition` handles the empty ops *before* its `fieldValue === null → false`
  guard, and `traceCondition` routes empty-ops through `evaluateCondition` whenever
  `known` is true (its `known &&` prefix stays for all other operators). `is_not_empty` is
  the inverse; `worse_than/better_than` → index comparison in the field's `options` order
  (unknown value = worst, matching `authorityEngine.gradeIndex` semantics).
- `RuleSentence`'s enum handling (`isEnum = kind === "enum" && !!def`) must treat
  `orderedEnum` as enum for the value picker; grep for every `=== "enum"` comparison.
- **C5:** `RuleSentence` value picker for numeric fields: on free-text select, reject
  non-parseable input inline (`TokenPicker` gets `validate?: (v)=>string|null`; error string
  renders under the input, Enter disabled). `is_empty`/`is_not_empty` hide the value pill
  entirely (no value needed) — `displayValue` and `plainSummary` must render them as
  `<field> is empty`.

### 2.5 `lib/fuzzy.ts` (new, ~30 lines)
`export function fuzzyMatches(input: string, options: string[], max = 3): string[]` —
case-insensitive: exact → prefix → substring → Levenshtein ≤ 2 (only for inputs ≥ 4 chars).
No dependency; hand-roll Levenshtein. Used by the parser (2.1) and later the linter.

### 2.6 Evaluator consolidation (prevents operator drift)
`lib/ruleEngine.ts#evalCondition` and `lib/ruleEvaluator.ts#evaluateCondition` both implement
operator semantics. **Single source:** keep `ruleEvaluator.evaluateCondition` as the one
implementation (it already takes resolved values); rewrite `ruleEngine.evalCondition` to
resolve the field then delegate. New operators are added in exactly one place. Add a test
asserting both paths agree on a matrix of (kind × operator × value) cases.

### 2.7 Tests (`scripts/assert-parser.ts`, `scripts/assert-operators.ts`) + `npm run test`
- `package.json`: `"test": "tsx scripts/assert-parser.ts && tsx scripts/assert-operators.ts"`
  (extended each phase).
- Parser eval suite (the hardening §3b harness, deterministic edition) — minimum cases:
  the 4 ChatBox pill examples (must parse byte-identical to today's output);
  `assign to Santa Claus` → unresolved slot, no fabricated assignee;
  `assign to wael` → resolves "Wael";
  `…and request tax returns` → `uncovered` contains the fragment;
  `when a document is approved…` → ambiguity (not silently LOAN APPROVED);
  `don't assign to Wael, notify Sara` → notify only + negation note;
  `loan amount over 250k` → `gt/250000`; `risk grade worse than B` → orderedEnum op.

### Phase 0 acceptance
No fabricated values can reach a saved rule; a partial parse is visually loud; `npm run test`
green; existing saved rules load and render unchanged.

---

## 3. PHASE 1 — Schema v3 (triggers[], groups, else, controls)

**Fixes:** C3 (nested logic), plus the persistence substrate for T1–T4/A2/C2 (`controls`)
and multi-trigger/else expressiveness. **Everything in this phase is contract 1a.**

### 3.1 `lib/vocabulary.ts`
- Add the 1a types; bump `RULE_SCHEMA_VERSION = 3`; `emptyRule()` returns
  `{schemaVersion:3, triggers:[{event: EVENTS[0].key}], conditions:{logic:"AND",children:[]},
  actions:[], controls: defaultControls()}`.
- **`normalizeRule(raw)` upgrade algorithm** (idempotent; add `scripts/assert-normalize.ts`
  fixtures for v1/v2/v3/garbage):
  1. v3 detected (`Array.isArray(r.triggers)`) → validate-shape pass: coerce missing
     `controls` via `defaultControls()`, drop malformed children (same leaf filter as
     baseline), recurse groups. **Normalize guarantees shape only — it never alters depth
     or drops valid nodes; depth policy belongs to the validator (§3.2).**
  2. v2 (`r.trigger?.event`) → `triggers: [{event}]`; `conditions.rules[]` →
     `{logic, children: rules}` (leaves unchanged — `RuleCondition` is assignment-compatible
     with `ConditionLeaf`); `actions` unchanged; `controls: defaultControls()`.
  3. legacy v1 (`r.event`) → v2 shape first (existing code path), then step 2.
- `ruleUsesUnconfirmed`: walk `triggers[]` (any unconfirmed event) + recursive walk of
  `conditions` leaves + actions. Extract a shared `walkLeaves(group): ConditionLeaf[]`
  helper — the evaluators, linter, and audit all need it.
- **Multi-trigger condition constraint (hardening §7):**
  `allowedFieldsForTriggers(events: string[]): FieldDef[]` = set-intersection of each
  event's `condFields`. Add `allowsFormFields: boolean` to `EventDef` — `true` for the
  events that currently spread `APP_DATA` into `condFields` (REQUEST SUBMITTED, LOAN
  APPROVED, LOAN REJECTED) — and form-field refs are offerable iff **every** selected
  trigger has it. Keep `allowedFieldsForEvent` as the single-event wrapper.

### 3.2 `lib/ruleValidation.ts` (new — the one validator)
```ts
export interface RuleIssue { severity: "error" | "warning"; code: string; message: string; path?: string }
export function validateRule(raw: unknown): { rule: WorkflowRule | null; issues: RuleIssue[] }
```
Errors (block save): unknown schemaVersion after normalize; `triggers.length === 0`; unknown
event key; group depth > 4; leaf with unknown attribute key; operator not in the field
kind's set; numeric leaf with non-numeric non-empty value (empty-op exempt); unknown action
key; enum action param not in `paramOptions`; `actions.length === 0` **when
`controls.mode === "armed"`** (shadow rules may be actionless while observing);
`maxFiresPerHour < 1`; attribute leaf whose field is outside
`allowedFieldsForTriggers` intersection.
Warnings (save allowed, shown in UI + linter): unconfirmed tokens; form-field leaf under a
trigger set where `allowsFormFields` is not universal; `else` present but empty; depth > 2
(beyond UI cap). **`lib/services/workflow.ts`**: delete both inline v2/legacy validation
blocks in `createWorkflow`/`updateWorkflow`; call `validateRule` and throw on errors —
one validator everywhere (client pre-save + service).

### 3.3 Evaluators
- `lib/ruleEvaluator.ts` — becomes the only semantic engine:
  `evaluateGroup(group, resolve): {matched: boolean, traces: ConditionTrace[]}` (recursive;
  OR short-circuits true, AND false; traces flattened with a `depth` field added to
  `ConditionTrace` so `TraceView` can indent). Trigger check:
  `rule.triggers.some(t => requestMatchesEvent(request, t.event))` — record which matched.
  `missingData: "alert"`: a leaf with `actual === null` (and op not `is_empty`/`is_not_empty`)
  sets a new `SimulationTrace.alerts: string[]` entry instead of just failing; `matched`
  is still false (fail-closed) but the alert is visible and audit-logged.
  When `matched === false` and `rule.else?.length`, populate
  `elseActions: string[]` (described like `actions`) — trigger-matched-only: `else` requires
  at least one trigger to have matched, otherwise neither list populates.
- `lib/ruleEngine.ts` — `matchingRequests`/`workflowsForEvent` re-route through the
  evaluator (`workflowsForEvent`: `w.ruleJson.triggers.some(t => t.event === evt.type)`).
  Kill any remaining duplicated logic.

### 3.4 Builder UI
- `components/RuleSentence.tsx`:
  - **Triggers:** the WHEN segment renders `triggers.map` pills joined by a static `or`
    word-token + a dashed `+ or event` pill (hidden once `triggers.length >= 3` — keep
    sentences readable). Removing the last trigger is blocked. Changing triggers re-filters
    conditions via `allowedFieldsForTriggers` (keep the baseline behavior: form-field
    leaves survive if allowed).
  - **Groups:** root children render as today; a child group renders as a bordered inline
    cluster `( leaf OP leaf )` with its own logic toggle. Affordances: `+ and` (adds leaf to
    root), `⊕ group` (adds an empty sub-group, only at root — enforces the 2-level UI cap),
    per-group `×`. State updates are pure functions over the tree — add
    `lib/conditionTree.ts` with `addLeaf/addGroup/updateLeaf/removeNode(path)` helpers
    (path = number[]), unit-tested (`scripts/assert-tree.ts`), so the component stays dumb.
  - **Else:** collapsed `OTHERWISE` section after THEN; same action-pill UI bound to
    `rule.else`; empty state = dashed `+ otherwise` pill that materializes the array.
  - **Controls:** a small `⚙ controls` popover (not pills): mode (Shadow/Armed segmented
    control with the shadow explanation), once-per-request checkbox, fires/hour number,
    missing-data select, priority number. Armed + unconfirmed tokens → confirm dialog
    restating the hardening warning.
- `plainSummary` (in `WorkflowCreator.tsx`): `When A or B fires, if X and (Y or Z), then …;
  otherwise …. [shadow]` — mode suffix only when shadow.
- `components/WorkflowSidebar.tsx`: each row shows a `shadow`/`armed` chip next to the
  enabled toggle (data already on the record).
- Starter templates: upgrade literals to v3 (single trigger, flat root group,
  `defaultControls()` — i.e. shadow). `applyStarter` already `structuredClone`s.

### 3.5 Ripple updates (compile-driven, listed so nothing is missed)
`lib/api.ts` (types only) · `lib/nlParser.ts` (emit v3: `triggers:[{event}]`, root group;
`forceEvent` arg from 2.2) · `app/api/workflows/simulate/route.ts` (normalize → v3 before
eval; log `alerts`) · `components/SimulationPanel.tsx` + `TraceView.tsx` (multi-trigger
line, depth-indented traces, else-actions row, alerts row) · `components/AuditLogs.tsx`
(render `eventName` as the *matched* trigger; add mode column in Phase 4) ·
`lib/analytics.ts` + `components/WorkflowActivity.tsx` (any `rule.trigger.event` access →
`triggers[0]`-safe helpers; grep for `\.trigger\.` and `\.conditions\.rules` repo-wide) ·
`components/WorkflowCreator.tsx#save()` — relax the current hard guard `Add at least one
action (THEN) before saving` to match the validator: actions are required only when
`controls.mode === "armed"` (shadow rules may observe action-less).

### Phase 1 acceptance
All v1/v2 fixtures normalize to valid v3 (assert-normalize green); a 2-level rule
round-trips build→save→reload→evaluate; multi-trigger OR verified in simulator; `else`
actions trace correctly; validator blocks each error class (assert-validation.ts covers
every error code); UI cannot produce depth > 2; all rules default to shadow.

---

## 4. PHASE 2 — ScopeRef: category vs instance everywhere it matters

**Fixes:** C1 (free-text identity), C7 (stage collisions), A4 (assignee drift), G2
(broken refs), and the hardening §4 audit rows that are still string-typed.

### 4.1 Types & helpers
Contract 1b into `lib/vocabulary.ts`. Widen `RuleOutput.params` and keep `ConditionLeaf.value`
as `string` **except** for instance-shaped fields where the value may be a `ScopeRef`
(type: `string | ScopeRef`). `paramKeyFor` unchanged. Update `displayValue`,
`plainSummary`, `describeAction`, `TraceView` via `scopeLabel()` (total functions — no
`[object Object]` regressions; add a render test).

### 4.2 Which tokens get which levels (implementation of the hardening §4 table)
| Token | `any` | `category` | `instance` (id source) |
|---|---|---|---|
| condition `template` | ✓ | requestType (absorbs the separate `reqtype` field — keep `reqtype` working but hide it from the add-condition picker) | `LiveTemplate.id` |
| condition `retailer` | ✓ | — | `LiveOption.id` (iam retailers) |
| condition `customer_name` | ✓ | Business/Individual (absorbs `custtype` the same way) | customer id (**no live endpoint yet** → category+free-text only; instance level ships disabled with a hint) |
| condition `stage` / action `change_stage` | ✓ | the 4 global stages (category) | `templateId:stageId` from `LiveTemplate.stages` — label rendered `Template › Stage` (kills C7) |
| condition `team_member`, params `assignee`/`notify recipient` | — | pseudo-teams (existing ASSIGNEES teams, badged unconfirmed) | `LiveOption.id` (iam users) |
| `assign_authority` param | — | — | `AuthorityRecord.id` (already fetched) |
| trigger `scope` | ✓ (default) | — | template instance (only trigger scope shipped now) |
| `program`, `loan_product` instance, intake-link instance | deferred — no live id source yet; leave `string` and list in §7 |

### 4.3 UI: two-step value picker
`TokenPicker` gains optional `scoped?: { categories: PickerOption[]; instances:
PickerOption[] }`: renders three sections — **Any** / **By type** / **Specific** (instances
get the search box; categories are chips). `onSelect` returns a `ScopeRef` via a new
`onSelectScope` callback (keep `onSelect(string)` for un-scoped fields — both optional,
exactly one required; assert in dev). `RuleSentence` wires scoped pickers for the 4.2 rows,
fed from `overlay` (live) with static fallbacks.

### 4.4 Evaluation semantics
`resolveField` comparisons for instance refs: match on `id` when the request carries ids
(live data), fall back to case-insensitive label match when it doesn't (seed data) — one
helper `scopeMatches(v: string|ScopeRef, actualId: string|null, actualLabel: string)`
used by both evaluators. Category refs compare against the request's category attribute
(`requestType`, `custtype`, global stage). `any` always matches (its purpose is trigger
scope + "field present at all" combos with `is_not_empty`).

### 4.5 Broken-refs audit — `GET /api/workflows/audit-refs`
For the org: load workflows + live vocabulary; walk every rule (triggers.scope, leaves,
params) collecting instance refs; report `{workflowId, path, label, status:
"ok" | "missing" | "legacy-unresolved"}` (missing = id absent from live vocab;
legacy-unresolved = string value on an instance-shaped slot). Surface as a "References"
panel in the sidebar footer with count badge; wire into the Phase 4 linter. (Cron/nightly is
the admin repo's job; here it's on-demand.)

### 4.6 NL parser
Instance resolution (2.1) now emits `ScopeRef` instances when a live id resolves; category
words (`any origination`, `business customers`, `line of credit`) map to category refs —
add these patterns + tests.

### Phase 2 acceptance
`retailer is <picked instance>` matches live-id data and seed-label data; two same-named
stages from different templates are distinct tokens; saved legacy string rules still
evaluate (label fallback) and appear in audit-refs as `legacy-unresolved`; assignee params
carry ids; no `[object Object]` anywhere (render test).

---

## 5. PHASE 3 — ApprovalRequirement: quorums, sequences, separation of duties

**Fixes:** AA4, AA5 (engine-side), maker-checker; substrate for exceptions (Phase 5).

### 5.1 Prisma (one migration: `add_approval_requirements`)
```prisma
model ApprovalAuthority {
  // existing fields stay; userIds retained (deprecated) for rollback safety
  requirement Json? @map("requirement")      // ApprovalRequirement; null = derive from userIds
}
model ApprovalTask {
  id          String   @id @default(uuid())
  orgId       String   @map("org_id")
  authorityId String   @map("authority_id")
  requestId   String   @map("request_id")
  requirement Json                                  // snapshot at creation
  status      String   // "open" | "approved" | "declined" | "expired"
  createdAt   DateTime @default(now()) @map("created_at")
  decisions   ApprovalDecision[]
  authority   ApprovalAuthority @relation(fields: [authorityId], references: [id], onDelete: Cascade)
  @@index([orgId, requestId])
  @@map("approval_tasks")
}
model ApprovalDecision {
  id        String   @id @default(uuid())
  taskId    String   @map("task_id")
  approverId String  @map("approver_id")
  approverLabel String @map("approver_label")
  verdict   String   // "approve" | "decline" | "abstain"
  note      String?
  createdAt DateTime @default(now()) @map("created_at")
  task      ApprovalTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
  @@unique([taskId, approverId])                     // one vote per person
  @@map("approval_decisions")
}
```
Migration SQL includes the tenant-RLS policies **copied from the
`add_rule_executions_table` migration's idiom** (same org_id predicate — read that file
first and mirror it exactly). Backfill: `requirement = {"type":"any_of","approvers":
[{"id":"","label":<each userIds entry>}]}` in the same migration (SQL `UPDATE … SET
requirement = …` generated from `user_ids`).

### 5.2 Engine — `lib/authorityEngine.ts` v2 (pure, superset of v1)
```ts
export interface DecisionContext {
  decisions: { approverId: string; verdict: "approve"|"decline"|"abstain" }[];
  exclusions: string[];            // approver ids barred (maker-checker: request owner, rule author)
  delegations: { fromId: string; toId: string }[];   // active only; resolution is caller's job
}
export interface RequirementStatus {
  satisfied: boolean;
  outstanding: Approver[];         // who can still act (post-exclusion/delegation)
  declined: boolean;               // any_of/n_of: enough declines that it can never satisfy
  step?: number;                   // sequence: current step index
}
export function evaluateRequirement(req: ApprovalRequirement, ctx: DecisionContext): RequirementStatus;
```
Semantics: exclusions remove approvers from eligibility *before* counting; delegations
substitute eligibility (delegate may act; decision records the delegate,
"as delegate of X" is display-layer); `any_of` = 1 approve; `n_of` = `count` approves,
`declined` when `approvers.length - declines < count`; `all_of` = every non-excluded
approver approves, any decline → declined; `sequence` = steps gate strictly, `step` =
first unsatisfied, and the sequence is `declined` when its current step is declined
(later steps are never evaluated). `decideAuthority` signature unchanged; `AuthorityLevel` gains
`requirement?: ApprovalRequirement` and the `reason` string names the requirement
(`"…manual review: 2 of 5 committee"`).

### 5.3 Service & API
`ApprovalAuthorityService`: accept/validate `requirement` (max 5 sequence steps, count ≤
approvers, non-empty approver lists; validation errors as today's `Error` pattern);
`normalizeRequirement` applied on read. New `ApprovalTaskService`: `createForDecision`
(authority + request + snapshot), `castDecision(taskId, approverId, verdict, note,
exclusions)` — re-evaluates and transitions status; unique-vote violations → 409. Routes:
`POST /api/platform/authorities/tasks`, `POST …/tasks/[id]/decisions`,
`GET …/tasks?requestId=`. Demo org fallback matches existing authority routes.

### 5.4 UI — `components/ApprovalAuthorities.tsx`
Drawer: replace the members checklist with a requirement editor — type segmented control
(`Anyone / N of / Everyone / Sequence`), approver multi-select (live users via overlay;
pseudo-teams badged), count stepper for `n_of`, step list (max 5, each step is one of the
first three types) for `sequence`. Matrix table: MEMBERS column → REQUIREMENT summary
(`any of 3`, `2 of 5`, `L1 → committee`). Decision preview panel extends with the
requirement line + an interactive "who approved" checkbox simulation calling
`evaluateRequirement` live (pure function — no API).

### 5.5 Tests (`scripts/assert-requirement.ts`)
Quorum math (2-of-5 with 1 decline / 4 declines→declined), all_of with exclusion, sequence
gating, maker-checker exclusion of the sole approver → `outstanding: []` + not satisfied
(deadlock surfaces, engine does not invent eligibility), delegation substitution,
legacy-userIds normalize.

### Phase 3 acceptance
Legacy authorities keep working untouched (normalize path); a 2-of-5 committee task
round-trips create→2 approvals→satisfied; preparer exclusion enforced; `assign_authority`
executor output includes the requirement summary in `reason`.

---

## 6. PHASE 4 — Trust machinery: shadow enforcement, backtest, linter, circuit breaker

### 6.1 Shadow/armed enforcement
- Migration `add_execution_mode`: `rule_executions` gains `mode String @default("shadow")`
  (E2 — extend, don't add a table).
- `POST /api/workflows/simulate` and the (future) event-driven path both stamp `mode` from
  the rule's `controls.mode`. **Armed execution path:** a new
  `POST /api/workflows/[id]/fire` route — body `{requestId}` — normalizes the rule, runs the
  evaluator, and when `matched && controls.mode === "armed"`: checks `oncePerRequest`
  (existing `rule_executions` row with status FIRED + same workflow/request → skip with
  status `SKIPPED_DUPLICATE`), checks the rate cap (count FIRED rows in the last hour ≥
  `maxFiresPerHour` → auto-pause: `enabled=false` + status `PAUSED_RATE_LIMIT` + a `notify`
  execution to the rule author if Novu configured), then dispatches each action through the
  `/api/execute` logic **in-process** (extract `executeAction(action, params, ctx)` from
  the route into `lib/services/actionExecutor.ts` — named to avoid confusion with the
  existing `lib/services/execution.ts` audit-log service; the route becomes a thin wrapper)
  honoring `onFailure` (`retry` = 1 retry then record; `halt` = stop remaining actions).
  All three new outcomes — `SKIPPED_DUPLICATE`, `PAUSED_RATE_LIMIT`, `PAUSED_ORG` (6.4) —
  are added to `EXECUTION_STATUSES` and logged as `rule_executions` rows, not just returned. Shadow rules take the identical path but skip dispatch
  and log `mode:"shadow"`. This route is the seam the admin repo's real event bus will call.
- `AuditLogs.tsx`: mode chip column; filter tabs All/Armed/Shadow.

### 6.2 Backtest — `POST /api/workflows/backtest`
Body `{rule}` (unsaved OK). Runs the evaluator over `REQUESTS` (seed) — and, when the live
bridge is configured, over `POST /workflows/requests/search` results mapped through the
existing platform parsing — returning `{total, matches: [{requestId, name, matchedTrigger,
actions}], alerts}`. UI: a "Backtest" button beside Simulation showing `would have fired on
N of M requests` with the list. (Time-windowed backtests need event history — deferred with
the event stream, §7.)

### 6.3 Linter — `lib/ruleLinter.ts`
`export function lintRule(rule, ctx: {workflows, liveVocab|null, authorities}): RuleIssue[]`
(reuses `RuleIssue`). Checks, each with a stable `code`:
`DEAD_CONDITION` (same field twice with contradictory `is` values under AND; numeric
`gt X` + `lt Y` with X ≥ Y) · `OVERLAP` (another enabled armed rule shares ≥1 trigger and
its root-group leaves are a subset — heuristic, warning only) · `BROKEN_REF` (audit-refs
result) · `MISSING_DATA_EXPOSURE` (leaf on a field the seed/live data never populates,
`controls.missingData === "no_match"`) · `AUTO_REJECT_WITHOUT_NOTICE` (armed +
`set_underwriting_result: Rejected` or `close_request` without a paired letter/notify
action — **error**, not warning: A6) · `PROHIBITED_BASIS_REVIEW` (armed routing/decision
action + conditions on `retailer`/geo-shaped fields → warning: "flag for fair-lending
review") · `GATED_TOKEN_ARMED` (armed + any `execution.status !== "executable-now"`).
Runs in `save()` (blocking on errors) and renders as a collapsible issues panel under the
rule builder. Tests: one fixture per code (`scripts/assert-linter.ts`).

### 6.4 Kill switch
Migration `add_org_controls`: `model WorkflowOrgControls { orgId String @id @map("org_id");
automationsPaused Boolean @default(false) …; @@map("workflow_org_controls") }` (+RLS).
`fire` route checks it first (`status: "PAUSED_ORG"`). UI: a banner toggle on the Workflows
page header (`⏸ Pause all automations`), confirm dialog, visible-when-paused amber banner.

### Phase 4 acceptance
A shadow rule never dispatches; flipping to armed dispatches exactly once per request;
rate-cap auto-pause observable in audit log; backtest returns the same matches as N
individual simulations; every linter code has a red/green fixture; kill switch halts the
fire route.

---

## 7. PHASE 5 — Deferred (interfaces only; do NOT build bodies until unblocked)

| Item | Blocker | Prepared seam |
|---|---|---|
| Timers/SLA, `delayMinutes`, business calendar | No scheduler in a serverless prototype; needs admin-repo worker or cron | `RuleOutput.delayMinutes` persisted; evaluator ignores |
| Scheduled/recurring triggers (Covenant reviews, renewals) | Same scheduler | `TriggerRef` stays event-shaped; add `{schedule}` variant later — do not pre-add |
| Exceptions / tolerance bands / delegation UI / overrides / break-glass (hardening §5) | Needs ApprovalTask flows in real use first | `DecisionContext.delegations` already consumed by the engine; tables `delegations`/`exception_requests` sketched in hardening §5 — create with their feature, not before |
| Aggregate exposure (T6/AA2), historical conditions | Entity resolution + backend query capability | `AuthorityInput` gains `exposure?: number` — add the optional field now (engine treats as amount when present, documented) |
| Real event-driven firing | Admin repo: real event stream (manual §12 Q3) + interceptor headers (Q2) | the `fire` route (6.1) is the entry point |
| Four-eyes on rule activation (G1) | Wants ApprovalTask UX proven | model armed-toggle as an ApprovalTask with `all_of(2)` — design note only |
| Notification digest (A5) | Real Novu volume first | executor already centralizes notify — single insertion point |

---

## 8. Cross-phase test & rollout summary

- `npm run test` grows monotonically: `assert-parser`, `assert-operators`, `assert-tree`,
  `assert-normalize`, `assert-validation`, `assert-requirement`, `assert-linter`,
  `assert-render` (scopeLabel/no-object-Object), `assert-evaluator-parity` (2.6).
- **Deploy notes per phase:** Phases 0–2 are code-only (rule JSON is a `Json` column — no
  migration). Phase 3 and 4 each carry one Prisma migration; run `prisma migrate deploy`
  against Supabase **before** merging to main (Vercel build runs `prisma generate` only).
  Every new table copies the RLS idiom from `20260714182151_add_rule_executions_table`.
- **Rollback:** each phase is one PR; `normalizeRule`/`normalizeRequirement` make forward
  data readable by rolled-back code *except* v3-only features (groups/else/multi-trigger
  degrade: a v2 reader sees `triggers[0]` only) — therefore never roll back past Phase 1
  once v3 rules are saved; instead fix-forward. State this in each phase PR description.
- **Do-not list (standing):** don't touch the parallel-console chrome (it's throwaway —
  alignment doc §3); don't rename `rule_executions`; don't convert values to numbers (E1);
  don't add an `assign_authority` hard gate (E3); don't build Phase 5 bodies early.

### Change log
- **2026-07-14 (v1)** — Initial implementation plan for the remaining hardening scope at
  baseline `48d17b6`, with locked v3/ScopeRef/ApprovalRequirement contracts, five phases,
  per-phase tests/acceptance, and the errata register (E1–E5) reconciling the analysis docs
  against the already-merged alignment work.
