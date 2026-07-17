# Angular Build-Out — Implementation Plan (v1)

Date: 2026-07-17 · Author: Claude (Coder) · For review: Gemini (Overseer) / Anderson
Repo state: single-track Angular at root (`main` = `a93558a`), production
auto-deploys from `main` (lj-workflow-creator-angular.vercel.app).
Source docs: admin buildout manual `2026-07-14_..._v2.md` (§4–§13),
`docs/agent/task.md` (integration Q2 answered; parser tranche list).

---

## 0. Coordination — read first

- **Codex has in-flight transition bugfixes** (small, intentional — Anderson,
  2026-07-17). Until each is checked `[x]` in `task.md`, Claude does not edit
  the files those fixes touch. Codex lane stays non-UI: `packages/rule-core`
  drafts, `core-tests/`, `scripts/`, fixtures.
- Claude lane: everything under `src/app/**` (UI layer, exclusive), plus git
  actions and this plan's phase execution.
- `src/app/core/` is **generated** (`npm run sync:angular-core`) — nobody
  hand-edits it; rule-core changes happen in `packages/rule-core/src/` and get
  synced. `npm test` gates purity + drift; keep it green at every commit.
- The `task.md` phase ledger entry for this plan gets added **after** Codex's
  current in-flight `task.md` edit lands (its working-tree edit must not be
  clobbered).

## 1. Where we are (verified against the tree)

Present and working (mock mode by default, live seam via `AppConfig`):

- Routes: `/workflows` (list) · `/workflows/proposals` · `/workflows/:id/edit`
  — transplant-shaped per scan; `authenticatedMatchGuard` dev seam in place.
- Builder wired: ChatDraft, ControlsPanel, IssuesPanel, JsonEditor,
  RuleSentence (+TokenPicker/VocabularyChip), SimulationPanel.
- Data: `WorkflowsService` abstract → `WorkflowsMockService` /
  `WorkflowsApiService` switched by `isMockMode`; `ApiService` sends the real
  header set incl. `x-organization` (Q2 answer).
- `lj-*` shell primitives mirror live selectors (`lj-page`, `lj-box`,
  `lj-button`, …) for verbatim transplant.
- Vendored rule core complete (10 synced files incl. `ruleLinter`, `types`).

Known gaps this plan closes: linter has **no UI surface**; vocabulary pickers
not yet fed by the live §7 endpoints; persistence path untrusted against the
real workflows service; no conflict/autosave UX; proposals flow demo-backed;
no nav/feature gating for transplant.

## 2. Phases

Order chosen so every phase is demoable in mock mode first, live behind config.
One feature branch per phase (`feature/ng-b<N>-<slug>`), merged to `main` only
with `ng build` + `npm test` green (production deploys on push — treat every
merge as a deploy).

### B1 — Lint surface (small; start immediately)
Wire the vendored `ruleLinter` into the builder: lint on rule change, severity
chips in `IssuesPanel` (error/warn split it already renders for validation),
save-gate on errors mirroring the Next-track LintPanel contract.
Files: `ui/issues-panel.ts`, `pages/workflow-builder.page.ts`. No new deps,
no API. **Exit:** lint findings visible + save-gated in mock mode; suite green.

### B2 — Live vocabulary (manual §7)
Vocabulary data-access on `ApiService` for the confirmed sources:
`/documents/templates/forms` (forms→fields), `/products/fields`,
`/workflows/templates{,/{id}}` (templates→stages); cache via `cache.service`;
mock fallback preserved. TokenPicker/VocabularyChip/ScopeRef bind **by ID**
(guardrail §13 — fields are per-template, never a global enum).
**Exit:** with a token configured, pickers show live tenant vocabulary; without
one, mock unchanged; sentence tokens resolve IDs both ways.

### B3 — Persistence, concurrency, drafts
Trust-run `WorkflowsApiService` against the real workflows-service resource —
resolves manual **Q1** (rules resource vs request-templates only; if none
exists this phase parks and B4/B5 proceed on mock). Conflict UX on `version`
(three-way dialog: view theirs / overwrite / reload — port of the Next-track
behavior, the schema already carries `expectedVersion`). Draft autosave via the
admin storage envelope pattern (§10.5).
**Exit:** save/load/delete round-trip live; stale-version save surfaces the
dialog, never last-write-wins.

### B4 — Outputs (manual §8, guardrails §13)
Map `actions[]` to real sinks, narrowest first: **NOTIFY (Novu)** and
**ASSIGN (named user/team — no authority ladder exists; no `assign_authority`)**.
Everything else behind capability flags until backend emittability is
confirmed (open Q3).
**Exit:** the two sinks fire against test tenant; gated actions visibly
disabled with reason.

### B5 — Four-eyes productionization
Replace demo approvers with the live user directory (Settings→Users list,
`groups` param) — closes the long-standing `DEMO_ADMIN_APPROVERS` Blocked item.
Proposals page: live-backed list/approve/reject through the same service seam.
**Exit:** single-admin org produces a satisfiable (or explicitly unsatisfiable
+ surfaced) requirement against live users.

### B6 — Transplant prep (manual §10, §5)
Nav registration (`lj-nav-link`, icon `account_tree`), `ui-configuration`
feature flag + route guard (open Q4 resolves the exact key), `lj-page` wrap
audit, and a transplant checklist doc for the admin monorepo drop.
**Exit:** feature runs gated in-shell locally; checklist handed to Gemini.

## 3. Codex parallel lane (after its transition fixes)

Dependency-free support, in its lane: linter edge-case fixtures
(`core-tests/assert-linter-ui-contract.ts`), §7 endpoint response fixtures
(`docs/data/`), parser next-tranche drafts in `packages/rule-core/src/` behind
the sync gate, schema drafts for the workflows-service resource (Q1).

## 4. Decisions needed (Anderson / Gemini — not code)

1. **Q1 persistence** (blocks B3 live half): does the workflows service expose
   a rules resource? If not: Supabase side-store interim vs backend ask.
2. **Q3 event stream** (shapes B4 gating): which lifecycle events genuinely
   emit in test.
3. **Q4 ui-configuration key** (blocks B6 gating specifics).
4. Parser tranche priority vs B-phases if capacity forces a choice.

## 5. Standing verification

Per phase-merge: `ng build` · `npm test` (core-tests + purity + sync gates) ·
mock-mode smoke of the touched flow · live smoke where config exists. Gemini
verifies each phase against the live platform before its `main` merge (§10.10).
