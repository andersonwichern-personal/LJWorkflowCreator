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
