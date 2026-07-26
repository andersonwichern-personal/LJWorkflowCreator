# Parser AI Engine — agent team ledger

Build: **Workflow Brain + Parser AI Engine Expansion**
Integration branch: `feature/parser-ai-engine-expansion` (based on `origin/main` @ `d329223`)
Lead: `honeycomb-lead` (Claude Fable 5, effort max — the highest supported level; literal
`ultra` is not a supported effort value in this Claude Code build, 2.1.218)
Started: 2026-07-24

## Orchestration substrate — honest record

The assignment specified Superset-native orchestration (tasks, per-specialist
workspaces, sessions). Ground truth in this session:

- `superset --version` → **1.16.1** (CLI installed)
- `superset projects list --local` / `agents list --local` → **"Error: Not logged
  in — Run: superset auth login (or set SUPERSET_API_KEY)"**
- No Superset MCP server is configured in this Claude Code session.
- Installing/obtaining credentials is prohibited by the assignment itself.

**Consequence:** Superset task/workspace/session objects could NOT be created
programmatically. Fallback used (recorded per the assignment's blocked-dependency
rule): the harness task list (task IDs #1–#18, mirroring the required roster
1:1) is the operational status board, and specialists run as isolated Claude
agent sessions coordinated by the lead, with exclusive file ownership per
`parser-ai-engine-file-ownership.md`. No Superset IDs exist; none are invented.
Smallest next action to restore Superset-native bookkeeping: `superset auth
login` by Anderson, then re-link this branch's work to a Superset project.

- `gh auth status` → authenticated as `andersonwichern-personal` (draft PR possible).
- `claude --version` → 2.1.218 (Claude Code); model `claude-fable-5`.

## Baseline (before any edit)

- `npm ci` → clean (exit 0)
- `npm test` → **green** (all core-tests suites; 370 sync-fixpoint assertions;
  purity gate: 18 files pure; sync gate: 17 files in sync)
- `npm run build` → **green** (bundle generation 3.523 s)
- Baseline commit: `d329223` "feat(composer): predictive ghost-text sub-bar and Tab completion"

## Roster

| # | Agent | Task ID | Wave | Model/effort | Files (ownership) | Status | Evidence / commit |
|---|-------|---------|------|--------------|-------------------|--------|-------------------|
| 0 | honeycomb-lead | #1 | all | claude-fable-5 / max | integration branch, package.json, docs/agent/* | in progress | — |
| 1 | repo-cartographer | #2 | 1 | claude-fable-5 / inherit | read-only | DONE | module map + donor lessons + 15-risk register (in-session report) |
| 2 | brain-foundation-architect | #3 | 1 | claude-fable-5 / inherit | packages/workflow-brain/{package.json,tsconfig.json,src/{brainState,index}.ts}, scripts/sync-angular-core.ts, core-tests/assert-workflow-brain-purity.ts | DONE | 38/38 purity+reducer asserts; dual-mirror sync; flagged TS2352 in teammate file |
| 3 | contract-architect | #4 | 1 | claude-fable-5 / inherit | packages/rule-core/src/parserProvenance.ts, core-tests/assert-parser-provenance.ts | DONE | 54/54 asserts; TS2352 cast fixed by lead (ownership transferred post-handoff) |
| 4 | clause-compiler | #5 | 1 | claude-fable-5 / inherit | packages/rule-core/src/parserClauses.ts, core-tests/assert-parser-clauses.ts | DONE | 88/88 asserts; tiling invariant; conservative-split doctrine |
| 5 | context-window-grounding-engineer | #6 | 1 | claude-fable-5 / inherit | packages/rule-core/src/parserGrounding.ts, packages/workflow-brain/src/contextCompiler.ts, core-tests/assert-parser-grounding.ts, core-tests/assert-brain-context-contract.ts | DONE | 41/41 + 42/42 asserts; reusable provider contract suite |
| 6 | security-red-team | #7 | 1 | claude-fable-5 / inherit | docs/data/parser-evals/adversarial.json, docs/parser-ai-security-model.md | DONE | 59 fixtures, 59/59 empirically verified; findings: send_webhook SSRF gap, over-broad arm trigger, registry-less instance fields |
| 7 | eval-scientist | #8 | 1 | claude-fable-5 / inherit | docs/data/parser-evals/{manifest,gold,metamorphic}.json, scripts/eval-parser.ts | in progress | — |
| 8 | deterministic-parser-engineer | #9 | 2 | claude-fable-5 / inherit | packages/rule-core/src/nlParser.ts (additive spans export), parserCoverage.ts, parserContradictions.ts, core-tests/assert-parser-coverage.ts, assert-parser-contradictions.ts | pending | — |
| 9 | ai-orchestrator-engineer | #10 | 2 | claude-fable-5 / inherit | packages/workflow-brain/src/{aiPort,orchestrator}.ts, core-tests/assert-parser-engine-hybrid.ts | pending | — |
| 10 | normalization-safety-engineer | #11 | 2 | claude-fable-5 / inherit | packages/workflow-brain/src/candidateNormalization.ts, core-tests/assert-parser-ai-boundary.ts | pending | — |
| 11 | consultant-conversation-engineer | #12 | 2 | claude-fable-5 / inherit | packages/workflow-brain/src/{consultant,recommendations,proposals}.ts, core-tests/assert-brain-consultant.ts | pending | — |
| 12 | ghostwriting-experience-engineer | #13 | 2 | claude-fable-5 / inherit | packages/workflow-brain/src/ghostSuggestions.ts, core-tests/assert-ghost-suggestions.ts | pending | — |
| 13 | angular-integration-engineer | #14 | 2 | claude-fable-5 / inherit | src/app/features/workflows/data/{workflow-brain.service.ts,workflow-brain-context.token.ts,standalone-brain-context.adapter.ts,parser-ai.contract.ts,ghost-suggestion.service.ts}, src/app/features/workflows/ui/{workflow-consultant.ts,ghost-textarea.ts}, composer page integration | pending | — |
| 14 | live-transplant-engineer | #15 | 3 | claude-fable-5 / inherit | src/app/features/workflows/data/landjourney-brain-context.adapter.ts, docs/workflow-brain-transplant-manifest.md, core-tests/assert-brain-transplant-parity.ts | pending | — |
| 15 | reliability-observability-engineer | #16 | 3 | claude-fable-5 / inherit | packages/workflow-brain/src/observability.ts, docs/parser-ai-operations-runbook.md, core-tests/assert-brain-observability.ts | pending | — |
| 16 | fuzz-property-test-engineer | #17 | 3 | claude-fable-5 / inherit | core-tests/assert-parser-properties.ts, core-tests/assert-parser-security.ts | pending | — |
| 17 | independent-release-reviewer | #18 | 3 | claude-fable-5 / inherit | read-only until findings accepted | pending | — |

Effort note: specialists inherit the session's effort (max-equivalent); the
Agent tool in this build exposes model override but not a per-agent literal
`ultra` flag. No teammate was silently downgraded to a smaller model.

## Wave log

### Wave 0 — lead setup (2026-07-24)
- Environment checks, baseline (above), branch created from origin/main.
- Lead read first-hand: types.ts, vocabulary.ts (type layer), nlParser.ts (full),
  parseGate.ts, clarifications.ts, revisions.ts, ruleValidation.ts,
  draft-engine.service.ts, api.service.ts, app-config.ts, sync/purity scripts,
  2026-07-22 AI-gateway handoff. Interface freeze authored by lead.
- Decision: new tests import package paths (precedent: assert-revisions.ts),
  not the vendored copies — decouples specialist work from sync timing.
- Decision: `packages/workflow-brain` vendors to `src/app/brain/` via the
  extended sync script, with the import rewrite `../../rule-core/src/` → `../core/`.

### Wave 1 — integration checkpoint (2026-07-24)
- Anderson (live message) asked for more agents in parallel; the assignment's
  six-concurrent cap was raised. Safety basis: exclusive disjoint file
  ownership + lead-only integration/commits. Wave 2 agents (deterministic-parser,
  ai-orchestrator, consultant, ghostwriting) and Wave 3 reliability were
  dispatched early where dependencies had landed; normalization-safety followed
  once parserGrounding landed.
- Lead fixes applied post-handoff: parserProvenance.ts TS2352 double-cast
  (contract-architect had completed; ownership transferred to lead — recorded
  in file-ownership doc); ports.ts gained `repairHint?` (lead-owned file).
- Deviations accepted: brain purity scan is comment-stripped (raw scan is
  unsatisfiable against frozen doc comments); BrainEvent has no ghost events
  (ghost staleness lives in ghostSuggestions' own dismissal registry).
- Security findings routed: SSRF/URL validation → candidateNormalization spec
  (step 8) + backend contract; arm-language containment → orgPolicy/four-eyes
  (documented, fixtures pin parser-level behavior honestly); registry-less
  instance fields → live adapter must always supply tenant option lists.
- package.json (lead): npm test chain += 5 Wave-1 suites; `npm start` honors
  `WORKFLOW_CREATOR_PORT` (default 4200) per the workspace-port requirement.

### Wave 2 — integration checkpoint (2026-07-24)
- Commits: `bf452ae` (Wave 1), `9232df3` (Wave 2). All gates green at 9232df3:
  24-suite npm test chain, core purity (23 files), brain purity, mirrors in
  sync (22 core + 13 brain), production build 2.7 s, eval 276/276 with 0
  fabrications, measured parseInstruction p50 0.065 ms / p95 0.096 ms.
- Lead reconciliation applied: orchestrator readVerdict + review-input builder
  adapted to the landed CandidateVerdict/CandidateReviewInput contract
  (repairs.length > 0 ⇒ engine "hybrid"); hybrid-suite stubs updated to match.
- Deterministic-parser agent's session was killed 3× by transient
  infrastructure errors; modules + contradictions suite were complete on disk,
  the coverage suite was finished by the lead (transfer recorded).
- DONE: tasks #9–#13, #16. Remaining: #14 angular-integration, #15
  live-transplant, #17 fuzz/property, #18 independent release review, final
  eval report + transplant manifest + architecture doc refresh.

### PAUSE POINT (2026-07-24, Anderson's instruction)
- Anderson (live) instructed: commit at a pausing point and push to main —
  explicitly overriding the original brief's "never merge to main" for this
  checkpoint. State pushed is purely additive engine groundwork: zero changes
  to existing UI behavior (the composer still runs the d329223 predictive bar;
  the new brain/ghost/consultant modules are not yet wired into Angular).
- Push: fast-forward of origin/main from d329223 to this branch head.

### UI phase — angular-integration checkpoint (2026-07-24, final for this session)
- Anderson (live, low on tokens) instructed: finish the UI phase only, then
  push to main. Tasks #15 (live-transplant), #17 (fuzz/property), #18
  (independent release review) and the final evaluation-report/transplant-
  manifest docs are DEFERRED — explicitly not done, not claimed.
- angular-integration-engineer (task #14) DONE: WORKFLOW_BRAIN_CONTEXT DI
  token + StandaloneBrainContextProvider (plain class, passes the shared
  provider contract suite), WorkflowBrainService (reducer-backed, envelope
  wrapping, stale/tamper-safe accept), deterministic-only GhostSuggestionService
  (aiCapability pinned false, zero network), <lj-workflow-consultant> advisory
  brief (accessible, reduced-motion, no raw JSON), minimal composer diff
  (+115/−9: ghost engine swap keeping Tab/ArrowRight + new Esc dismiss;
  consultant wired through the existing updateRule path so the save invariant
  holds; patchless accepts never rewrite the author's description),
  assert-brain-angular-seam suite. ui/ghost-prediction.ts deprecated in place.
- Gates at this checkpoint (lead-verified): 25-suite npm test chain green,
  purity gates green, mirrors in sync (22 core + 13 brain), build green
  (initial bundle 381 kB), eval 276/276, 0 fabrications.
- In-app-browser/DevTools runtime QA was NOT performed this session (requires
  the interactive Superset workspace); static a11y/behavior contracts are
  pinned by assert-sweet-ux + assert-brain-angular-seam instead.

### Wave 3 — checkpoint (2026-07-26, commit 18c2c14)
- Anderson (live): "keep going until you run out" then "once done push to
  main". Both remaining implementation specialists were killed mid-read by the
  account's monthly spend limit on 07-24 and resumed cleanly on 07-26 after it
  lifted (no partial files had reached disk).
- fuzz-property-test-engineer (#17) DONE: 65-assert property suite (seeded
  xorshift 0x5EED2026) + 49-assert security gate (all 59 adversarial fixtures
  now enforced inside npm test, payload zoo, abort/concurrency, oversized/
  unicode floors, telemetry hygiene). Findings: F1 HIGH negation bypass for
  add/remove verb heads; F2/F3 LOW fail-closed coverage edges (allowlisted).
- live-transplant-engineer (#15) DONE: LandjourneyBrainContextProvider over a
  LiveContextTransport seam (52-assert parity suite incl. the shared provider
  contract, 21-assert context-switch suite), transplant manifest with the
  CONFIRMED vs PRESUMED endpoint table. Finding: static-ASSIGNEES fallback
  let demo names resolve under a degraded live roster.
- Lead fixes (both verified by the full chain): negation verb heads now
  include add|remove with the tag-matcher exclusion (F1); ParseOptions.assignees
  is presence-based — provided-but-empty fails closed (transplant finding).
  F1 property pins flipped to the corrected behavior.
- docs/parser-ai-evaluation-report.md published from measured runs (276/276,
  0 fabrications, p50 0.065 ms / p95 0.096 ms, 15-item known-gap inventory).
- Gates at 18c2c14: 29-suite npm test green, build green, eval 276/276,
  mirrors in sync. Independent release review (#18) dispatched over
  d329223..HEAD; verdict pending.

### Independent release review — three rounds (2026-07-26, task #18 DONE)
- Round 1 (at 18c2c14): BLOCKED. P1-1 coverage negation-fallback false
  fabrication (confirmed with repro), P2-1 NEG_RE replica drift, P2-2 NUL
  bytes in contextCompiler, P3-1..7. Zero P0s; security posture certified.
- Lead fix round (e020835): P1-1/P2-1/P2-2/P3-1/P3-2/P3-3/P3-4 fixed;
  P3-5/6/7 deferred with recorded rationale. Same commit shipped the
  unless/except honest-unsupported parser fix (known-gap #1).
- Round 2: original findings CONFIRMED-FIXED, but the unless fix introduced
  NEW-1 (P1: else-lane exception clause vanished from the gate), NEW-2 (P2:
  wrong staleness counter), NEW-3 (P2: version not bumped), NEW-4 (P3) —
  BLOCKED again. Honest note: the reviewer caught a real hole in the lead's
  own fix.
- Lead fix round 2 (f38300f): masked exceptions surfaced into `uncovered` on
  every return path (coverage case Q), content-based parse staleness,
  PARSER_ENGINE_VERSION → 2026.07.26-1 everywhere, early-return guidance kept.
- Round 3 (final): all repros re-run, full regression sweep U1–U8 clean,
  nothing new in the 14-file diff, gates 1860 PASS / 0 FAIL. Verdict:
  **RELEASABLE**. Residual note: provenance.generation stamps the composer's
  buildGeneration (a different counter than the brain's) — cosmetic, doc-note
  material only.

### Hybrid live-path wiring + focused review (2026-07-26, final)
- Certified state pushed to main at 04d890d; work continued per Anderson's
  standing "keep working" instruction.
- DraftEngineService (c1ea76d): live-mode Build now runs the full hybrid trust
  pipeline client-side — deterministic first, parse-ai consulted only on gaps
  over the unchanged {text, options} wire, backend answers reviewed as hostile
  input (reviewCandidate) before reaching the composer; mock mode
  byte-identical; snapshot via WORKFLOW_BRAIN_CONTEXT so the Landjourney
  transplant swaps adapters, not pipeline code. Seam suite pins the wiring.
  A stray Superset worktree gitlink was scrubbed and .claude/worktrees/
  gitignored.
- Focused independent review of that diff: 29/29 end-to-end probes with the
  REAL reviewCandidate (valid/hostile/donor-era/null/timeout/abort candidates
  all reach the composer guard-valid or degrade honestly). Verdict RELEASABLE
  with two P2s + one P3, all fixed same-session as prescribed: repairHint now
  forwarded on the repair POST (backend contract §Request revved to accept
  it); a rejected snapshot promise no longer memoizes (live-adapter
  resilience); incoming ai/hybrid provenance preserved in the brain session
  ledger instead of being re-stamped deterministic.
- Remaining known deferrals (unchanged, honest): interactive browser QA;
  live backend endpoints (PRESUMED table in the transplant manifest);
  P3-5/6/7 from review round 1; ghost AI transport (capability pinned false
  until a workflows/suggest endpoint exists).
