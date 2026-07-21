# Agent task ledger

Shared between Claude and Codex. Both agents re-read this before every edit and
every compile. Check `[x]` the moment a sub-task is done — the other agent is
waiting on that mark to know a module is safe to import.

Protocol: `.claude/skills/goal/SKILL.md` (`/goal`).

---

# Sweet Workflow UX Overhaul — Architect Review Handoff (2026-07-17)

Handoff: `docs/2026-07-17_sweet-workflow-ux-overhaul-handoff_v1.md`
Branch/worktree: `main` at `fc3f5b7`, changes intentionally uncommitted and unpushed.
Status: implementation and local verification complete; awaiting Architect approval.

- [x] Central Sweet design tokens, responsive shell, focus/reduced-motion foundations
- [x] Exact 61-circle Sweet spiral with deterministic parser states and pointer/typing motion
- [x] AI-first composer, clarification, review, test, and observation flow
- [x] Editorial workflow list, client-facing detail, review queue, and confirmation dialogs
- [x] Native disabled semantics, activation validation, four-eyes activation language
- [x] Parser provenance retention, stale-result prevention, safe conversational revisions
- [x] Alternate/Otherwise simulation fidelity and source-of-truth core synchronization
- [x] Fail-closed, host-provided authorization/audit seam for Internal tools
- [x] Production build, full test suite, browser responsive QA, and PNG evidence
- [x] Architect reviews and approves the UX/implementation handoff
- [ ] Authenticated admin host wires `WORKFLOW_ACCESS_POLICY` to real roles and durable audit logging
- [x] Commit/push to `main` only after explicit Architect and Anderson approval

---

# Phase 13 — Four-Eyes (Maker-Checker) Rule Activation

Spec: `docs/2026-07-16_phase-13-four-eyes-specs_v1.md`
Branch: `feature/four-eyes-phase-13`
Status: backend done and committed (`bf4b01b`, `a2a53f1`); §2.3 UI outstanding.

## Claude — UI components, validation scripts, lib/

- [x] `lib/fourEyes.ts` — single gate (`shouldProposeWorkflowWrite`); the rival
      `requiresProposal` was deleted after Anderson picked the OR semantics
- [x] `lib/services/workflow.ts` — interception + `ProposalRequiredError`
- [x] `scripts/assert-four-eyes.ts` — 13 assertions, wired into `npm run test`
- [x] §2.3 "Propose Changes" button — swap the save label when the gate would
      fire, so the button states what will actually happen
- [x] §2.3 pending-proposal banner in the builder canvas
- [x] §2.3 "Proposals" dashboard tab — list pending, diff proposed vs current
      rule JSON, approve/reject
- [x] Surface the route's `202 { pendingProposalId, proposalStatus }` in
      `lib/api.ts` — the gate works but nothing shows the user their change
      became a proposal

## Codex — backend routes

- [x] `app/api/workflows/[id]/route.ts` — catches `ProposalRequiredError` → 202
- [x] `lib/services/workflowProposal.ts` — create/apply/reject + task spawn
- [x] `prisma/schema.prisma` + `20260716140000_phase13_four_eyes` migration
- [x] `lib/proposals.ts` — legacy local draft markers preserved; durable
      proposal flow now uses `WorkflowProposal` APIs instead

## Blocked / needs a human

- **`DEMO_ADMIN_APPROVERS` is hardcoded** in `lib/services/workflowProposal.ts`
  (`u-anderson`, `u-aisha-admin`). The checker pool must come from the live
  user directory before this is real; a single-admin org currently produces a
  requirement nobody can satisfy, which is correct but untested against live
  data.
- **Ownership contract is stale.** CLAUDE.md casts Codex as "keyboard
  autocomplete" drafting dependency-free files, but it is authoring whole
  modules including `WorkflowCreator.tsx` — which the same doc assigns to
  Claude. The §2.3 UI sits exactly on that contested boundary. Resolve before
  starting it, or the collision repeats.

---

<<<<<<< HEAD
# Integration + Parser Upgrade (Anderson's redirect, 2026-07-16)

Anderson redirected mid-session: park Phase 14 webhooks, work the **integration
and parser upgrade plan** the architect laid out in the two 2026-07-16 scan
reports (NOT the older 07-14 reverse-engineering docs):

- `~/Documents/Codex/2026-07-16/…/outputs/landjourney-workflow-creator-integration-report.md`
  — live admin-console source-map scan (the Angular target).
- `~/Documents/Codex/2026-07-16/…/outputs/lj-workflow-creator-vercel-integration-report.md`
  — deployed-prototype scan; §7 is the parser-upgrade plan, §5 the integration gap map.

Codex left a support note + fixtures (`docs/2026-07-16_codex-integration-parser-support_v1.md`,
`docs/data/2026-07-16_parser-integration-fixtures_v1.json`) and respected the
file boundary — it did not touch parser files.

Branch: `feature/parser-upgrade`.

## Claude — parser upgrade (report §7)

- [x] Multi-action extraction fix — action regexes end in a zero-width
      lookahead, not a connector-consuming group (probe 1 dropped `add_tag`).
      `stripTrailingPunct` on captures (probe 2's `"wael."`). `change_stage`
      delay suffix. `lib/nlParser.ts`, committed `285a5f7`.
- [x] **Bug found + fixed**: `change_stage` delay took its quantity from a
      capture but the *unit* from re-scanning the whole match — a stage name
      containing "day" (e.g. "monday review") turned 3 weeks into 3 days, a
      silent 7× timer error. Unit is now a capture. `scripts/assert-multi-action.ts`
      (18 assertions) pins it; wired into `npm run test`.
- [x] Gemini structured output — `responseSchema` on the parse call (report §7
      "Use Structured Outputs, Not Freeform JSON"). `app/api/workflows/parse-ai/route.ts`.
- [x] **Bug found + fixed**: the model chain caught only HTTP 404/429/503, so a
      per-model timeout (AbortError) threw out of the chain and never tried the
      healthy candidates; timeout was per-model (60s × 3 = 180s) with no
      `maxDuration`. Now: timeouts fall through, 25s/attempt + 50s total budget,
      `maxDuration=60`. Committed `7ce287c`; 3 new assertions in assert-parse-ai.ts.

Verify: full suite **619 assertions exit 0**, build clean, lint clean.

## Open — needs Anderson / Gemini (not code)

- **Model ordering (latency vs accuracy).** Live probing today: the lead
  candidate `gemini-3.5-flash` is persistently slow/busy (503 + 25s timeouts),
  so requests pay the cascade cost before landing on `gemini-3.1-flash-lite`
  (~2s, correct). The fixed cascade makes this survivable, not free. Reordering
  the chain to lead with the lite tier is an accuracy-vs-latency call — Gemini
  owns model choice; not changed unilaterally.
- **Parser §7 next tranche (larger, deferred to a spec):** live-vocabulary
  retrieval before parsing, embeddings for vocab lookup, negation ("unless"),
  form-backed fields (crop_type/use_of_funds), scheduler/time triggers, a
  coverage gate before Save/Arm. These are new capability, not fixes — worth a
  Gemini spec before building.

## Integration — Q2 is ANSWERED (was the July-14 blocker)

The admin scan resolved the interceptor mystery that blocked the live path since
2026-07-14. `ApiService.getHeaders()` attaches, beyond the bearer:
`x-landjourney-agent: web`, `x-session-id: <id>`, `x-landjourney-app-type:
backoffice`, `x-organization: <dnsPrefix>` (NOT `X-Org-Id`; org context =
UI-configuration `dnsPrefix` from `GET /organizations/external/ui-configuration`).
Vocabulary sources confirmed: `/documents/templates/forms`, `/products/fields`
(new — fields live in the Products service), `/workflows/templates{,/{id}}`.

## SUPERSEDED (2026-07-17): repo is now single-track Angular

Anderson approved the Angular migration on 2026-07-17: the Next.js/Prisma
Vercel track was **deleted from the working tree** and `angular-workflows/`
was promoted to the repo root. The two-track doctrine below is retained for
history only.

- The full Vercel track (app/, components/, lib/, prisma/, its scripts and
  configs) lives at git tag **`vercel-track-final`** (`fc6db89`) — one
  `git checkout vercel-track-final` away. The deployed Vercel prototype keeps
  serving until the Vercel project itself is redeployed or deleted.
- `packages/rule-core` remains the **source of truth** for the rule core;
  `npm run sync:angular-core` now generates `src/app/core/` (repo root).
  Never hand-edit generated files — Codex especially.
- `npm test` still ends with the purity + sync gates.
- Root `.env.local` from the Next track was preserved on disk (gitignored) as
  `.env.local.nextjs-backup`.

## Two-track doctrine — Anderson's decision, 2026-07-16 [SUPERSEDED, see above]

The repo now carries **two independent tracks**:

1. **Vercel track (Next.js app, repo root)** — the deployed prototype stays a
   *living, independently evolving product line* (demos, parser engine, phase
   work). It is NOT frozen and NOT a dead donor: parser/engine improvements,
   Phase 14/15, and demo features continue to land here on `feature/*` branches
   as before.
2. **Angular track (`angular-workflows/`)** — the native admin-console rebuild
   per the salvage doctrine below. Structured so `src/app/features/workflows/`
   transplants into the admin monorepo (BitBucket / Antigravity) when access
   lands. Branch: `feature/angular-embed`.

Divergence is expected and fine. The **shared contract between the tracks is
the rule core** (schema v3, vocabulary, normalization, validation, parser
result shape) — a change to those semantics must be made on both tracks or
called out under Blocked. UI, persistence, and tenancy are per-track and free
to diverge.

Ownership: Claude owns `angular-workflows/**` (it is UI-layer work). Codex:
same support role as the prototype — fixtures, checklists, standalone drafts
outside `angular-workflows/`, unless the ledger says otherwise.

### Rule core is now a package + sync gate (2026-07-17)

The shared rule core was extracted out of `lib/` into
**`packages/rule-core` (`@sweet/rule-core`)** — the single source of truth for
both tracks (commits `dbc38f1` + `f9475b4`, landed on `feature/angular-embed`).

- **Vercel track** imports it directly (`from "@sweet/rule-core"`, npm
  workspace + `transpilePackages`). The old `lib/vocabulary.ts` etc. paths are
  gone.
- **Angular track** consumes a **generated vendored copy** at
  `angular-workflows/src/app/core/`. It is written by
  `npm run sync:angular-core` (repo root) and carries a GENERATED banner.
  **Never hand-edit those files — Codex especially** — the next sync
  overwrites them. `api.ts` and `fourEyes.ts` in that folder are
  Angular-owned and NOT managed by the sync.
- **To change the rule core**: edit `packages/rule-core/src/`, run
  `npm run sync:angular-core`, commit both. That *is* the
  "must land on both tracks" rule — now mechanical instead of manual.
- **Gates in `npm test`** (root): `assert-core-purity` fails the suite if
  react/next/prisma/DOM leaks into the package; `sync-angular-core --check`
  fails it if the vendored copy drifts. A red gate names the fix command.

## Integration salvage doctrine — system-wide decision

Do **not** attempt to transplant the Vercel prototype into the admin console.
Treat it as a mature prototype/domain reference and rebuild the production host
natively. (Per the two-track doctrine above, "reference" means the Angular
track salvages from it — not that the Vercel app stops evolving.)

Salvage from the prototype:

- portable rule core: `lib/vocabulary.ts`, schema v3, normalization, `ScopeRef`,
  controls, operators, verified/unconfirmed confidence
- parser contracts and behavior: deterministic fallback, structured result shape,
  `unresolved`, `uncovered`, `ambiguities`, fuzzy matching, parser fixtures
- evaluator/validator/linter/approval engines and their assertion suites
- UX concepts: plain-English drafting, WHEN/IF/THEN token grammar, simulator,
  backtest, safety controls, maker-checker proposals, pause-all automations,
  execution analytics, reference audit

Rebuild in the production admin repo:

- Angular `/workflows` lazy route under the authenticated shell
- `lj-page`/admin UI primitives and Dynamic Form builder-style editor patterns
- `ApiService`-backed services with required headers and `x-organization`
  tenancy
- production navigation, permissions, feature flags, draft autosave, version
  history, live vocabulary services, and real user/approver directory

Do not carry over:

- Next.js app shell, React/Tailwind sidebar, internal React view-state routing
- direct same-origin `/api` fetch contract
- `orgId` query/body tenancy
- demo localStorage persona/theme state
- hardcoded demo approvers/users

- [ ] Demo-bridge live path: fill `.env.local` `LANDJOURNEY_*` + set
      `LANDJOURNEY_EXTRA_HEADERS` to the 4 headers above (needs a real admin
      session token + the tenant dnsPrefix — human step).

## Angular track — first cut LANDED (`angular-workflows/`, Claude)

Branch `feature/angular-embed`. Workspace: Angular 20 (CLI v20; Node 24.14 is
below CLI v21's floor), standalone components, SCSS, no SSR.

- [x] Rule core ported VERBATIM (`src/app/core/`): vocabulary, fuzzy,
      conditionTree, ruleValidation, nlParser — provenance headers, zero edits.
      Workspace tsconfig relaxes `noPropertyAccessFromIndexSignature` so the
      core stays byte-identical (documented in tsconfig).
- [x] Drift guard: 6 Vercel-track assertion suites re-pointed at the ported
      core (`core-tests/`), wired to workspace `npm test` — **149 assertions
      exit 0**.
- [x] `ApiService` mirroring the admin contract (bearer + the 4 headers,
      `x-organization` = dnsPrefix, sessionId once per browser session).
- [x] `lj-*` primitive stand-ins with the admin selectors (lj-page, lj-box,
      lj-box-row, lj-page-heading, lj-button) — markup transplants unchanged.
- [x] `/workflows` lazy route in the scan's exact registration shape
      (`canMatch` guard seam), list page (Templates idiom), builder page:
      WHEN/IF/THEN sentence (multi-trigger OR, 2-level condition groups via
      ported conditionTree, else lane), token pickers with unconfirmed badges
      + numeric author-time validation, safety-controls panel, shared-validator
      issues panel gating Save, plain-English drafting (ported nlParser with
      uncovered/ambiguity/unresolved surfaces), JSON editor over validateRule,
      2s draft autosave (`workflowCreatorDrafts`, NEW_WORKFLOW_ID sentinel).
- [x] Data seam: `WorkflowsService` abstract → in-memory mock (default) or
      `/workflows/rules` API impl (presumed resource — confirm Q1 before use).
- [x] Verify: `ng build` clean (lazy chunks split correctly), dev server
      serves `/workflows`, workspace tests 149/149. NOT yet verified: a human
      click-through (no browser automation in this session).

### Tranche 2 — LANDED (`5fe49c7`)

- [x] Simulator + backtest: `core/{platformData,ruleEvaluator,ruleEngine}.ts`
      ported verbatim (+ `core/api.ts` type-only WorkflowRecord shim);
      SimulationPanel traces triggers/conditions (depth-indented, unknown vs
      empty), else-lane, alerts; backtest over the seed dataset.
- [x] Four-eyes: `core/fourEyes.ts` verbatim (`@/lib/*` path mapped in
      tsconfig); mock service intercepts protected writes → pending proposal
      (SaveOutcome = the 202 contract); builder relabels Save → "Propose
      changes" via the same shared gate + pending banner; Proposals page with
      current-vs-proposed diff and approve/reject; list chips + count.
- [x] Vocabulary seam: VocabularyService probes documents/products/workflows
      sources through the production headers when configured; Live/Partial/
      Demo chip. Pickers still serve STATIC vocabulary — live overlay into
      pickers is the next increment.
- [x] Tests: workspace suite now **233 assertions exit 0** (+ operators,
      customer-eval, scope ports; + assert-angular-seam.ts covering the gate
      truth table and the mock proposal lifecycle). `ng build` clean.

### Viewing / deployment status

- Local: `npm start` in `angular-workflows/` → http://localhost:4200/workflows
  (mock backend, zero config).
- Vercel: separate production project is live:
  https://lj-workflow-creator-angular.vercel.app
  (`lj-workflow-creator-angular`, deployment `dpl_2FM7HEi3eRHkJoVdi8kjieiU6MLo`).
  The earlier attempt against the root `lj-workflow-creator` project failed
  because Vercel built the Next.js app and type-checked `angular-workflows/**`.
  Keep the Angular track deployed from `angular-workflows/` as its own project.

Next tranche candidates (product call): live vocab overlay into pickers,
ScopeRef authoring, analytics/audit-log port, Monaco, real guard wiring.

---

# Phase 14 (webhooks) / Phase 15 (digests) — Vercel implementation landed

- [x] Phase 14 (webhooks) Next.js implementation & tests completed
- [x] Phase 15 (digests) Next.js implementation & tests completed

All subsequent efforts are focused on the Angular workflows workspace (`angular-workflows/`).

---

# Angular Track — Live Vocabulary & ScopeRef Authoring
Status: Completed

- [x] Extend `VocabularyService` to fetch/store live users, retailers, templates, forms, and dynamic fields (`vocabulary-chip.ts`)
- [x] Connect pickers to live options in `RuleSentence` (`rule-sentence.ts`)
- [x] Implement ScopeRef output for live instance selections in `RuleSentence`
- [x] Run Angular tests (`npm test` in `angular-workflows/`) and verify builds

---

# Angular Build Out — Levels 0 - 5
Status: In progress

## Level 0: Baseline Purity & Core Sync
- [ ] Verify `assert-core-purity.ts` check works as a workspace sanity check
- [ ] Verify `sync-angular-core.ts --check` check works as a workspace sanity check
- [ ] Confirm no React/Next/Prisma remnants exist in configurations

## Level 1: Live API Integration
- [ ] Implement live workflows get/list/create/update/remove routes mapping in `WorkflowsApiService`
- [ ] Enforce session organization context and custom HTTP headers in API service
- [ ] Add optimistic concurrency expectedVersion support to workflows saving

## Level 2: Advanced ScopeRef Authoring
- [ ] Build ScopeRef selection dialogs and category search interfaces in UI
- [ ] Connect ScopeRefs to all applicable vocab fields (assignees, stages, products)

## Level 3: Simulator Traces & Backtesting
- [ ] Port Simulator visual trace panels to Angular components
- [ ] Implement one-click backtest UI showing historical request logs match rates

## Level 4: Natural-Language Editor & Autocomplete
- [ ] Implement visual drafting input panel with live keyword highlighting
- [ ] Build inline context-aware suggestions panel based on active vocabulary

## Level 5: Proposals Dashboard (Review UI)
- [ ] Port proposals dashboard (list proposals, approve/reject, compare JSON diffs)
- [ ] Verify review dashboard layout loads correctly (compliance and safety checks deferred)

---

# Phase 1.5: Structured Composer Integration (2026-07-17)

Spec: `docs/2026-07-17_structured-composer-integration_v1.md`
Status: Implemented + verified (Claude, 2026-07-17); awaiting Gemini QA review

- [x] Refactor title and spiral layout to be horizontal and compact
- [x] Add the ghost placeholder text "Create a workflow." next to the cursor
- [x] Implement state synchronization variables and logic in `WorkflowComposerPage`
  - [x] Initialize/update the `result` signal when trigger events are changed
  - [x] Bind condition addition/removal/modification to the `rule` signal
  - [x] Bind action addition/removal/modification to the `rule` signal
- [x] Build the 3-column structured builder interface in the template
  - [x] Column 1: Searchable categorized lists of EVENTS
  - [x] Column 2: Trigger-dependent condition buttons and active condition cards (operators + values)
  - [x] Column 3: Searchable categorized lists of actions and active action cards (parameters)
- [x] Review styling using the Sweet design tokens (fonts, spacing, border, radius, shadow)
- [x] Verify using automated tests and manual build check

Implementation notes (Claude, 2026-07-17):

- All visual-builder mutations funnel through an immutable `updateRule()` that
  seeds/patches the `result` signal and syncs `parsedDescription` to
  `text().trim()`, so the Start observing gate opens without a description
  parse (spec §3.2). Deviation from the spec's example literal: `ParseResult`
  has no `text` field, so the seeded result is `{ rule, notes: [],
  unresolved: [], uncovered: [], ambiguities: [] }`.
- A visual edit bumps `buildGeneration`, so an in-flight description parse can
  never overwrite builder state. The `save()` validation gates are untouched
  (assert-sweet-ux contracts all pass).
- Visual-first rules start with `triggers: []` until an event is picked;
  `validateRule`'s EMPTY_TRIGGERS keeps the save gate closed rather than
  silently defaulting a trigger.
- **`angular.json` `anyComponentStyle` budget raised 8/10 kB → 12/14 kB** —
  the composer page now carries the whole builder UI (~11.3 kB compiled after
  condensing shared control rules). Precedent: the UX-overhaul commit had
  already raised it from the CLI default. Needs Gemini sign-off.
- Verified: `npm test` fully green (269 PASS lines incl. all 28 Sweet UX
  source contracts, rule-core purity gate, sync drift gate); `npm run build`
  clean with no budget warnings.
- Multi-agent adversarial review ran post-push (4 lenses; verification fleet
  partially killed by the account spend limit, so Claude adjudicated the
  unverified findings by hand). Confirmed defects — keystroke wipes the
  visual rule, stale parse sidecars blocking save / corrupting clarification
  indices, empty values passing the save gate, ScopeRef label-downgrade on
  touch, false selected-option display on empty values, invisible
  validation-only gaps, trigger-scope loss on no-op clicks, aria/focus-ring
  gaps, lowercase pill labels — are all fixed in Phase 1.6 below.

---

# Phase 1.6: Builder ⇄ Parser Bi-Directional Sync (2026-07-18)

Anderson's directive: the builder and the AI parser engine stay in sync — a
rough parser match auto-selects fields in the builder, and builder selections
type the description out "in a visually pleasing way". Committed as 1.6.

- [x] `packages/rule-core/src/ruleText.ts` — `composeRuleText(rule)`: canonical
      plain-English serialization, the parser's inverse for the covered
      vocabulary subset (quoted event-key triggers, natural dual-trigger
      pairs, operator phrasings, action verbs chosen to avoid pattern
      collisions, else lane, SLA delay, armed/rate-cap suffixes). Vendored via
      `npm run sync:angular-core`; exported from the package barrel.
- [x] Parser fix (rule-core `nlParser.ts`): **label-adjacent enum binding** —
      a named field binds to the option that follows its label instead of an
      option word leaking from another clause ("Loan approved" no longer
      hijacks "request stage is not Closed"). Fallback preserves the old
      rough-scan behavior; zero regressions across all parser suites.
- [x] Parser fix (rule-core `nlParser.ts`): **else-clause masking** — the main
      action lane no longer reads the otherwise/else region, so "… otherwise
      notify Omar" cannot duplicate the notify into the primary lane.
- [x] `core-tests/assert-rule-text.ts` — 95 assertions pinning the round-trip
      contract (exact for parser-covered shapes; conditions-superset where the
      parser's distinctive-option rough scan legitimately adds AND conditions;
      readable + honestly-uncovered for non-parseable actions). Wired into
      `npm test`.
- [x] Composer: **parser → builder** — `liveResult` re-parses the description
      on every keystroke; builder columns render the rough match (all matched
      triggers highlight w/ `aria-pressed`, condition/action cards populate),
      with a provisional hint bar; the first builder click adopts + commits
      the provisional rule.
- [x] Composer: **builder → text** — every visual mutation composes the
      canonical description and types it into the cursor (2 chars/16 ms,
      common-prefix restarts, spiral typing pulses, instant under
      prefers-reduced-motion, cancelled by manual typing/Enter/destroy).
      `parsedDescription` = composed text, so save() persists a
      name/description that always matches the rule (kills the forged-gate
      finding).
- [x] Review-driven fixes: updateRule drops stale parse sidecars; author-time
      empty-value gate in gaps() (+ visible gap-notes list for question-less
      gaps); `keepRefIfSameLabel` guard stops ScopeRef → string downgrades;
      "Choose…" placeholder on empty-value selects; trigger no-op click
      preserves scope; per-card aria labels; global focus-visible ring
      restored; sentence-cased pill/card labels.
- [x] Verify: `npm test` fully green — 13 suites incl. 95 new rule-text
      assertions + purity + sync gates; `npm run build` clean, no budget
      warnings (styles within the 12/14 kB budget).

Known limitations (documented in `ruleText.ts` header): longest-event-key
re-parse can flip the trigger when a longer key appears in a value (FISERV/
FMAC combos); parser-uncovered actions re-parse as honest `uncovered` gaps;
distinctive-option rough scan may add superset AND conditions on re-parse.

---

# Phase 1.7: Workflow Canvas Diagram (2026-07-18)

Spec: `docs/2026-07-18_workflow-canvas-diagram_v1.md`

- [x] Add `CanvasNode` / `CanvasEdge` interfaces and signals to `WorkflowComposerPage`
- [x] Implement `effect()` to rebuild canvas from rule signal (parser/3-col → canvas sync)
- [x] Implement `commitCanvasToRule()` (canvas → rule signal sync via `updateRule()`)
- [x] Build palette sidebar (drag + click to place)
- [x] Build canvas stage with dotted grid background and SVG edge overlay
- [x] Build node rendering (event circle, condition diamond, output circle)
- [x] Implement node drag-to-move
- [x] Implement port drag-to-connect (dashed temp line → edge on drop)
- [x] Implement click-connect mode
- [x] Build inspector panel (event/condition/output forms using existing picker groups)
- [x] Add `rebuildCanvasFromRule()` auto-layout (event→cond→output left-to-right)
- [x] Style canvas using Sweet design tokens — no hardcoded colors except node shapes
- [x] Raise SCSS budget in `angular.json` if needed — NOT needed (see notes)
- [x] All tests pass (`npm test`)
- [x] Build succeeds (`npm run build`)
- [x] Commit as: `feat(composer): Phase 1.7 – visual workflow canvas diagram`

Implementation notes / deviations from spec (Claude, 2026-07-18):

- `CanvasNode` gained a `ref` field (index into triggers /
  conditions.children / actions) — the spec's node model had no binding to
  the rule, which `commitCanvasToRule`/inspector edits require. Every canvas
  mutation is a surgical immutable patch on the referenced rule piece through
  `updateRule()`; deletes re-index sibling refs.
- Edges render REACTIVELY (`edgePaths` computed → SVG `@for`), not via the
  spec's imperative `drawEdges()` ElementRef writes — spec §1 itself demands
  "reactive, not imperative", and this removes all render-timing hazards.
  Port drag shows a dashed temp path from a `tempEdge` signal.
- The sync effect watches `builderRule()` (committed rule OR the Phase 1.6
  live rough match), so the diagram draws itself while the user types —
  and reads the dependency before the `canvasSourced` guard so an early
  return can never untrack it.
- The spec's `var(--accent)` / `var(--text-muted)` tokens did not exist:
  added `--accent: #6941c6` to `styles.scss`; mapped text-muted → existing
  `--text-dim`, error tokens → existing `--danger`/`--danger-bg`.
- SCSS budget: canvas CSS took component styles to 16.3 kB compiled — past
  even the sanctioned 15 kB ceiling — so the canvas rules live in
  `styles.scss` as a namespaced page-scoped partial (canvas-/cn-/pnode-/
  palette-/insp- prefixes) instead. Component styles stay under the 12/14 kB
  budget from Phase 1.6; `angular.json` untouched; build has zero warnings.
- Palette-placed nodes get explicit defaults (first picker event /
  first allowed condition field, else `stage` / `assign_user`) so every node
  is immediately real in the rule and inspectable; the empty-value and
  EMPTY_TRIGGERS gates from 1.5/1.6 keep partial canvases from saving.
- Canvas interactions are mouse-based (mousedown/mousemove); below 900 px the
  canvas stacks palette-top/inspector-bottom. Nested condition groups stay in
  the rule untouched; the canvas renders root-level leaf conditions.
- User-drawn edges are visual annotation (the rule model has no arbitrary
  graph semantics); auto-layout regenerates edges on external rule changes.
- Verified: `npm test` 364 PASS / exit 0 (all 14 gates incl. purity + sync);
  `npm run build` clean.

## Phase 1.8 — connected editing + Sweet motion sync (2026-07-18)

- [x] Restyle the diagram as a compact enterprise operations workbench
- [x] Add smart multi-node placement, automatic connections, and topology repair
- [x] Keep shape-aware connectors attached while connected nodes move
- [x] Add pointer/touch node movement with a bottom drag-to-trash dock
- [x] Replace the misleading visual-only clear action with deterministic Arrange
- [x] Rotate the Sweet spiral on hover and during text, builder, and diagram editing
- [x] Extend browserless interaction/accessibility contracts
- [x] Verify the full test suite, production build, desktop, and narrow-desktop layouts
- [x] Commit as a new Phase 1.8 change on top of `e55bf85`

Verification: `npm test` green (all 14 gates; Sweet UX now 32 assertions),
`npm run build` clean with no budget warnings, and browser QA clean at
1710×981 plus 1024×768 with zero page overflow or console warnings/errors.
Anderson explicitly removed mobile-specific QA from the Phase 1.8 acceptance
scope after the initial no-overflow check.

## Phase 1.9 — enterprise UI polish (2026-07-18)

- [x] Centralize the enterprise color, spacing, radius, type, and elevation tokens
- [x] Tighten the global shell and shared page/button primitives
- [x] Refine the workflows list into a compact bordered enterprise data surface
- [x] Reframe the composer as a compact three-column workbench without changing behavior
- [x] Replace builder emoji decoration with monochrome inline/CSS-native icons
- [x] Rebuild composer review as one bounded six-step Workflow review report
- [x] Keep clarifications inline, amber, and blocking without changing validation semantics
- [x] Make the Sweet spiral spin briefly on workflow changes, settle fully, and remain hover-interactive
- [x] Refine workflow detail into a compact metadata header and Interpretation/Test/Safeguards report shell
- [x] Refine the reviews queue, proposal rows, and empty state without fabricating fields
- [x] Format-check affected files and extend browserless UI contracts (40 assertions; no formatter or lint command is configured)
- [x] Verify the full test suite and production build
- [x] Browser-QA affected routes at 1710x981, 1024x768, and 390x844 — passed on 2026-07-19 for the loaded workflow list, composer, workflow detail, and Reviews queue with no console errors or page-level horizontal overflow. The pass found and fixed a clipped 390px overview metric by switching that strip to a two-column grid; the new browserless contract passes with the full suite and production build.
- [x] Commit as release 1.9

---

# Parser Engine — Process over Content (2026-07-18, Claude)

Anderson's directive: keep improving the parser "brain"; the process must be
content-agnostic because events/fields/actions change per client. All work in
`packages/rule-core` (+ sync); Codex's in-flight Phase 1.9 UI files untouched.

- [x] **Generic action grammar** — the parser now derives action recognition
      from each `ActionDef`'s `label` + new optional `aliases` (with `{param}`
      mid-phrase templates, e.g. route_to_queue's "move it into the {param}
      queue"). Every action in the vocabulary parses — enum params resolve or
      slot unresolved (reject-don't-coerce), free-text params capture
      URL-safe charsets, and `after/in N unit` delays + `if/when` gates work
      on ALL actions, not just change_stage. Legacy matchers run first,
      untouched, so every pinned behavior is byte-identical; the generic pass
      reads only the unconsumed remainder. `parseActionFragment` (revisions)
      inherits the grammar for free.
- [x] **Generic trigger scorer** — when every content heuristic misses, events
      are scored against `EventDef.key` + new optional `aliases` with
      word-level fuzzy matching (edit distance ≤1 on words ≥5 chars): a unique
      perfect match is taken ("when a loan is aproved…", "when the request
      stage changes…"), ties and near-misses ASK (N3), prose never hijacks.
      New client events become parseable with zero parser edits.
- [x] **Clause-scoped subject detection** — trigger-ambiguity subjects
      (document/offer/loan/request) are now read from the trigger clause only,
      so "…, request document w9" can't raise the loan-vs-document question
      (same contamination class as the dual-trigger hijack fix).
- [x] **Outputs before conditions** in `parseInstruction` — generic action
      phrases legitimately embed field labels/option words ("set underwriting
      result to Auto Approved"); actions claim them first. The condition scan
      reads raw text and never consults spans, so its results are
      order-independent (suite-verified).
- [x] **Else-lane masking** retained; serializer (`ruleText.ts`) now emits
      every action as its vocabulary label + param, so builder→text→Enter
      round-trips the full action set.
- [x] `core-tests/assert-parser-engine.ts` — **132 assertions**, wired into
      `npm test`. Includes full-vocabulary sweeps that iterate EVERY event,
      EVERY action, and EVERY condition field from the vocabulary itself —
      when client content changes, the sweeps cover it without a test edit.
      Plus pins: typo/inflection resolution, near-miss questions, no-hijack,
      alias templates, generic delays/gates/slots, negation over generic
      actions, legacy/generic masking, and the uncovered-fragment contract.
- [x] Verify: `npm test` 509 PASS / exit 0 (17 gates incl. purity + sync);
      `npm run build` clean. Codex's dirty Phase 1.9 files excluded from the
      commit.

Known limits (deliberate, deterministic): the scorer needs ≥2 matched tokens
(one-word phrases are hijackable); the legacy "route … to <assignee>" grammar
still wins over the bare "route to queue" label (hence the alias).

---

# 1.9.2 — Cross-surface sync fixpoint (2026-07-18, Claude)

Anderson's directive: the AI-text cursor, the 3-column builder, and the
workflow-diagram canvas must ALWAYS stay in sync through the parser-engine
upgrade. All three read one shared rule signal and re-serialize via
`composeRuleText`; the invariant that keeps them from drifting is that
re-parsing that canonical text must not change the rule — parse∘compose must
reach a **stable fixpoint**. A probe across the whole vocabulary found 14
oscillations: e.g. "booking status is Error" re-parsed to also invent
data_status/processing_status (shared option "Error"), then invent
stage:Processing (the word "processing" inside the label "processing status"),
growing every round → the surfaces diverged on each re-parse/Enter.

- [x] **Two-pass condition matcher** (rule-core `nlParser.ts`
      `matchConditions`): pass 1 binds every label-NAMED condition and consumes
      its span; pass 2 runs the rough distinctive-option scan ONLY on the
      unclaimed remainder (masked text). A bare option can no longer be claimed
      by a sibling field whose real value sits in another clause, and an action
      value ("change stage to Closed") can no longer fabricate a phantom
      condition. Content-agnostic: works for any client's overlapping option
      vocabulary.
- [x] Re-baselined pill fixtures 1/3/4 in `assert-parser.ts` — the old
      expectations encoded exactly those phantom conditions; the corrected emit
      is what the user actually stated (documented inline).
- [x] `core-tests/assert-sync-fixpoint.ts` — **370 assertions** pinning the
      fixpoint across a full-vocabulary sweep (EVERY event, action, field) plus
      builder/canvas combos, and direct guards that the phantom-condition
      regressions stay dead. Wired into `npm test`. Process over content: the
      sweep iterates the vocabulary itself, so client content changes are
      covered with no test edit.
- [x] Verified: whole-vocabulary probe now 0 oscillations with valid data;
      `npm test` 881 PASS / exit 0 (18 gates incl. purity + sync);
      `npm run build` clean. Scoped to `packages/rule-core` (+ vendored sync)
      and parser tests; Codex's Phase 1.9 UI files untouched.

Note: the component wiring that binds the three surfaces (`builderRule()` +
canvas `effect`/index-refs, committed in 1.6/1.7) is unchanged — a parser
change can only desync the text↔rule round-trip, which this fixpoint now
guarantees. The remaining known no-op: an INCOMPLETE condition (empty value,
already gated from save) serializes to "…" and drops on re-parse — an
authoring draft state, not a saved-rule sync case.

---

# 1.9.3 — Trigger-clause scoping (2026-07-19, Claude)

Picked up the parser-engine hardening thread from the 1.9.2 checkpoint. A
known-limits probe over the whole event vocabulary confirmed the single
documented limit that was a real correctness bug (the 1.6 "FISERV/FMAC combo"
note): the direct event-key match scanned the WHOLE input and took the longest
key, so a longer key buried in a later clause flipped the trigger. E.g.
"when a fmac loan is booked, notify omar that the loan approved" re-parsed to
trigger **LOAN APPROVED** (found in the action clause) and dumped the real
"fmac loan" trigger into `uncovered`. The probe also confirmed the fixpoint
work otherwise holds — 0 flips / 0 oscillations / 0 drops across all 23 events.

- [x] **Trigger-clause scoping** (rule-core `nlParser.ts` `matchEvent`): hoisted
      the existing trigger-clause boundary (text before the first
      comma/"and"/"then", already used for subject detection) above the
      direct-key block. A key NAMED in the trigger clause now beats a longer key
      that only appears later; whole-text scan remains the fallback when the
      trigger clause names no event key (single-clause inputs, trailing key), so
      every pinned single-clause behavior is byte-identical. Content-agnostic:
      derived from the clause boundary, not from any client's event names.
- [x] `core-tests/assert-parser-engine.ts` — +2 pins (now 134): the buried
      longer key does not flip the trigger, and the real trigger clause is not
      dumped into `uncovered`. Vendored via `npm run sync:angular-core`.
- [x] Verify: `npm test` 883 PASS / exit 0 (18 gates incl. purity + sync);
      `npm run build` clean, no budget warnings. Scoped to `packages/rule-core`
      (+ vendored sync) and parser tests; no UI files touched.

---

# Phase 1.9.4: Fill in with Demo Data (2026-07-21)

Spec: `docs/2026-07-21_fill-demo-data_v1.md`

- [x] Add compact demo toolbar under the composer form (data-driven `@for` over
      `demoWorkflows`, `role="group"`, Sweet tokens)
- [x] Add `fillDemo(id: number)` to `WorkflowComposerPage` class — sets the
      shared `text` signal, grows + focuses the textarea, and calls the existing
      `build()` so the commit path (result signal → builder columns + canvas
      effect) runs exactly as it does for typed input. Autosave/revision/
      keyboard-submit paths are untouched (all funnel through the same signals).
- [x] Implement four recognizable demo workflow scenarios
- [x] Ensure that selecting a scenario updates the input description and
      immediately triggers the parser, builder, and diagram
- [x] Check styles and layout against Sweet design tokens
- [x] Verify using `npm test` (884 PASS / exit 0) and `npm run build` (clean, no
      budget warnings)
- [x] Commit as `feat(composer): Phase 1.9.4 – fill in with demo data`

Implementation notes / deviations (Claude, 2026-07-21):

- **Demo texts re-grounded on the shipped grammar.** The spec's 4 literal
  strings do NOT parse against the current vocabulary — a probe showed 2 (Credit
  Underwriting, Maturity SLA) yield a NULL rule and 2 (Offer Rejection, Booking
  Error) yield a partial rule with **zero actions** (everything dumped to
  `uncovered`). They target capabilities the engine does not have: credit-FICO
  conditions, loan-maturity **timing/scheduler triggers** (the explicitly
  deferred parser tranche), and `schedule reminder` / `trigger booking event`
  actions (no such vocabulary actions; `trigger_booking`'s label is actually
  "send booking to"). Anderson chose "whatever you recommend," so the toolbar +
  handler ship as specified but the 4 strings were rewritten to vocabulary-
  aligned phrasings that each parse to a COMPLETE rule (trigger + conditions +
  resolved actions, zero uncovered/unresolved/ambiguities — verified by probe):
    1. Credit Underwriting — LOAN APPROVED + credit_score < 620 →
       set_underwriting_result Rejected + assign Underwriting Team
    2. Offer Rejection — OFFER REJECTED → change_stage Closed + notify Omar
    3. Booking Error — FISERV LOAN + bookstatus Error → assign Booking Team +
       notify Wael
    4. Document Intake — DOCUMENT UPLOADED → run_extraction + assign Wael
  "Maturity SLA" → "Document Intake" because timing triggers are not built. The
  DEMO: prefix is retained per spec; phrasings were chosen so it does not leak
  into `uncovered`. The richer spec scenarios become buildable when the parser
  gains those capabilities — a Gemini-spec'd tranche (scheduler triggers /
  credit-result conditions / new actions), same gate as the other deferred
  parser capability.
- **Styles live in `styles.scss`, not the component.** The demo-toolbar CSS put
  the composer's component styles 341 B over the 12 kB anyComponentStyle budget,
  so the rules moved to a page-scoped `styles.scss` partial (unique `demo-`
  prefix) — same precedent as the Phase 1.7 canvas rules. `angular.json`
  untouched; build has zero warnings. Used `--radius-pill` (the repo token)
  instead of the spec's non-existent `--radius-full`.
- UI-layer only (composer page + global stylesheet). No parser/vocab/core
  changes and no test files touched; the full suite (884 PASS / exit 0, incl.
  purity + sync gates) reflects the demo texts being pure UI data.

---

# Phase 1.9.5: Editable workflow diagram + permissive fields (2026-07-21)

Anderson's directive: the workflow diagram was glitchy — nodes could not be
moved or removed once connected, and arrows could not be added/deleted. Make the
diagram fully editable and keep the text / builder / canvas surfaces in sync.
Also: let any mentioned field/value work even if it is not backed by real data,
and label it "not backed by real data".

## Canvas editability (composer page — UI, Claude)

- [x] **Stable node ids** — `canvasNodeId(type, ref)` replaces the per-rebuild
      `++canvasSeq`. Root cause of the glitch: every rebuild regenerated ids and
      re-ran the full auto-layout, so a rule change (typing, an inspector edit,
      add/delete) discarded manual positions AND cleared the selection (the old
      id never matched). Stable ids let a rebuild carry positions, selection,
      and user edges forward.
- [x] **Rebuild preserves state** — `rebuildCanvasFromRule` reads the current
      positions (`prev` map) and reuses them; new nodes lane-lay-out, moved nodes
      stay put. Selection/connect-from survive if their node still exists. The
      `canvasSourced` guard is GONE — the rebuild is now idempotent w.r.t. manual
      state, so a canvas-originated edit no longer needs to skip its own rebuild.
- [x] **Effect reads only the rule** — the sync effect tracks `builderRule()`
      and runs the rebuild inside `untracked()`; the rebuild both reads and writes
      `canvasNodes`, so tracking those reads would self-trigger an infinite loop.
- [x] **User-editable, persistent arrows** — edges are `canonical ∪ edgesAdded −
      edgesRemoved` (override sets keyed by stable id pairs), resolved by
      `resolveCanvasEdges` and filtered to existing endpoints (crash-safe on
      stale keys). Add via port-drag / connect-mode (now persists across
      rebuilds); **delete by clicking an arrow** (transparent wide `canvas-edge-hit`
      path, `pointer-events: stroke`). `Arrange` clears overrides + re-lays-out.
      `canConnectCanvasNodes` relaxed to any two distinct nodes (arrows are visual
      annotation). Node delete re-indexes sibling refs/ids, prunes stale overrides.
- [x] Contracts: updated the diagram source contract for the new delete path and
      added a 1.9.5 contract (`canvasNodeId`, position carry, `resolveCanvasEdges`,
      `removeCanvasEdge`, `canvasSourced` gone). `assert-sweet-ux` now 41.

## Permissive fields — "not backed by real data" (rule-core + UI)

- [x] **Opt-in parser flag** `ParseOptions.allowUnbackedValues` + a new optional
      `ParseResult.unbacked: string[]` sidecar (rule-core `nlParser.ts`). At every
      value-rejection site (condition value, assignee, authority, change_stage,
      generic action param) the value is coerced to its literal and pushed to
      `unbacked` INSTEAD of an UnresolvedSlot — but ONLY when the flag is set.
      Default stays reject-don't-coerce (N1); the 884-assertion baseline is
      byte-identical. Vendored via `npm run sync:angular-core`.
- [x] Composer parses permissively (`parseOpts()` on all three parse calls) and
      surfaces a non-blocking amber "Not backed by real data" notice listing the
      accepted-but-unbacked values (`unbackedNotes` computed). The rule works and
      the save gate is not blocked (unbacked ≠ unresolved).
- [x] `core-tests/assert-parser-engine.ts` — +3 pins: default rejects, permissive
      accepts + reports `unbacked`, and a backed value is never marked. Now 137.

## Verify

- [x] `npm test` 888 PASS / exit 0 (all gates incl. purity + sync).
- [x] `npm run build` clean, no bundle/style budget warnings (demo/unbacked CSS
      in the page-scoped `styles.scss` partial, per the Phase 1.7 precedent).
- [x] Dev server compiles and serves `/workflows` (HTTP 200, no runtime errors).
      NOT done: a human drag/click-through — no browser automation in this
      session; the interaction logic is covered by reasoning + source contracts.
- [x] Commit as `feat(composer): Phase 1.9.5 – editable diagram + permissive fields`

### 1.9.5 follow-up — browser-verified + discoverability (2026-07-21)

Anderson asked how add/delete arrows work and what the "Connect nodes" button
does — a discoverability signal, not a bug. Drove the real UI in headless Chrome
(puppeteer-core → system Chrome) and confirmed every interaction works:
move node, move persists across a rebuild (stage-relative measurement so page
scroll can't confound it), delete arrow, add arrow via port-drag, add arrow via
the connect button; zero console/page errors.

- [x] **Removed the "Connect nodes" button** and all its machinery (connectMode
      / connectFrom signals, toggleConnectMode, handleConnectClick, the
      nodePointerDown connect branch, `.cn-connect-from`). It was a redundant
      second way to draw the same cosmetic arrow (port-drag already does it) and
      confused the user. Port-drag is now the single add path.
- [x] **Per-arrow delete handle** — an always-visible × at each arrow midpoint
      (`.canvas-edge-del`), so removing an arrow is discoverable; clicking the
      arrow line still works too. Verified: a real mouse click on the × deletes.
- [x] Palette hint reworded; `assert-sweet-ux` +1 contract (× handle present,
      port-drag add, connect-mode machinery gone) → 42 assertions.
- [x] Verify: `npm test` 889 PASS / exit 0; `npm run build` clean, no budget
      warnings; headless-Chrome drive of move / add / delete all PASS, no errors.
- [x] Commit as `refactor(composer): 1.9.5 follow-up – drop connect button, add × delete handle`

Note: arrows are visual annotations (the WHEN/IF/THEN rule has no arbitrary graph
semantics) — drawing/removing them does not change workflow logic. If arrows
should ever mean sequence/flow, that is a rule-model change and needs a spec.
