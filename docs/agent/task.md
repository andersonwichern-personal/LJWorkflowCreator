# Agent task ledger

Shared between Claude and Codex. Both agents re-read this before every edit and
every compile. Check `[x]` the moment a sub-task is done — the other agent is
waiting on that mark to know a module is safe to import.

Protocol: `.claude/skills/goal/SKILL.md` (`/goal`).

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

## Two-track doctrine — Anderson's decision, 2026-07-16

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

