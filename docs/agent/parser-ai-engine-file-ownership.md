# Parser AI Engine — file ownership

One implementation owner per file at a time. Research agents do not edit. The
lead transfers ownership explicitly (recorded here) before another agent edits
a file. Agents commit only their scoped changes; the lead integrates.

## Lead-owned (only honeycomb-lead edits)

- `package.json` (test-chain entries are added by the lead at integration checkpoints)
- `packages/rule-core/src/index.ts` (barrel exports added at integration)
- `packages/workflow-brain/src/index.ts` (barrel; created by foundation, then lead-owned)
- `src/app/core/**` — GENERATED. Nobody hand-edits; only the lead runs
  `npm run sync:angular-core` at integration checkpoints.
- `src/app/brain/**` — GENERATED (new vendored mirror). Same rule.
- `docs/agent/parser-ai-engine-team-ledger.md`, this file
- `docs/parser-ai-engine-architecture.md`, `docs/parser-ai-backend-contract.md`,
  `docs/workflow-brain-context-contract.md` (lead-authored from the interface freeze)
- `docs/parser-ai-evaluation-report.md` (lead-authored from actual eval runs)

## Specialist ownership (Wave 1)

| File | Owner |
|---|---|
| packages/workflow-brain/src/ports.ts | brain-foundation-architect |
| packages/workflow-brain/src/context.ts | brain-foundation-architect |
| packages/workflow-brain/src/brainState.ts | brain-foundation-architect |
| scripts/sync-angular-core.ts | brain-foundation-architect (one-time extension) |
| core-tests/assert-workflow-brain-purity.ts | brain-foundation-architect |
| packages/rule-core/src/parserProvenance.ts | contract-architect |
| core-tests/assert-parser-provenance.ts | contract-architect |
| packages/rule-core/src/parserClauses.ts | clause-compiler |
| core-tests/assert-parser-clauses.ts | clause-compiler |
| packages/rule-core/src/parserGrounding.ts | context-window-grounding-engineer |
| packages/workflow-brain/src/contextCompiler.ts | context-window-grounding-engineer |
| core-tests/assert-parser-grounding.ts | context-window-grounding-engineer |
| core-tests/assert-brain-context-contract.ts | context-window-grounding-engineer |
| docs/data/parser-evals/adversarial.json | security-red-team |
| docs/parser-ai-security-model.md | security-red-team |
| docs/data/parser-evals/manifest.json, gold.json, metamorphic.json | eval-scientist |
| scripts/eval-parser.ts | eval-scientist |

## Specialist ownership (Wave 2)

| File | Owner |
|---|---|
| packages/rule-core/src/nlParser.ts | deterministic-parser-engineer (additive only) |
| packages/rule-core/src/parserCoverage.ts | deterministic-parser-engineer |
| packages/rule-core/src/parserContradictions.ts | deterministic-parser-engineer |
| core-tests/assert-parser-coverage.ts, assert-parser-contradictions.ts | deterministic-parser-engineer |
| packages/workflow-brain/src/aiPort.ts, orchestrator.ts | ai-orchestrator-engineer |
| core-tests/assert-parser-engine-hybrid.ts | ai-orchestrator-engineer |
| packages/workflow-brain/src/candidateNormalization.ts | normalization-safety-engineer |
| core-tests/assert-parser-ai-boundary.ts | normalization-safety-engineer |
| packages/workflow-brain/src/consultant.ts, recommendations.ts, proposals.ts | consultant-conversation-engineer |
| core-tests/assert-brain-consultant.ts | consultant-conversation-engineer |
| packages/workflow-brain/src/ghostSuggestions.ts | ghostwriting-experience-engineer |
| core-tests/assert-ghost-suggestions.ts | ghostwriting-experience-engineer |
| src/app/features/workflows/data/* (new brain files), src/app/features/workflows/ui/* (new consultant/ghost files), workflow-composer.page.ts | angular-integration-engineer |
| src/app/features/workflows/data/draft-engine.service.ts | angular-integration-engineer |

## Specialist ownership (Wave 3)

| File | Owner |
|---|---|
| src/app/features/workflows/data/landjourney-brain-context.adapter.ts | live-transplant-engineer |
| docs/workflow-brain-transplant-manifest.md | live-transplant-engineer |
| core-tests/assert-brain-transplant-parity.ts, assert-brain-context-switch.ts | live-transplant-engineer |
| packages/workflow-brain/src/observability.ts | reliability-observability-engineer |
| docs/parser-ai-operations-runbook.md | reliability-observability-engineer |
| core-tests/assert-brain-observability.ts | reliability-observability-engineer |
| core-tests/assert-parser-properties.ts, assert-parser-security.ts | fuzz-property-test-engineer |
| docs/workflow-consultant-behavior.md | consultant-conversation-engineer |
| docs/ghost-autowriting-spec.md | ghostwriting-experience-engineer |

## Transfers

- `packages/rule-core/src/parserProvenance.ts` → honeycomb-lead (post-handoff
  TS2352 build fix; contract-architect had completed and signed off).
- `core-tests/assert-parser-coverage.ts` → honeycomb-lead (deterministic-parser
  agent's session was killed three times by transient infrastructure errors;
  its modules and the contradictions suite were complete on disk, the coverage
  suite was authored by the lead against the agent's implementation).
