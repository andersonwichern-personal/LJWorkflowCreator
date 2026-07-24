# Parser AI Engine — architecture

Status: v1 (interface freeze) — authored by honeycomb-lead, 2026-07-24.
This document is the coordination contract for the specialist team. Exported
names listed here are FROZEN; changes go through the lead and are recorded in
`docs/agent/parser-ai-engine-team-ledger.md`.

## Package layout and dependency direction

```text
@sweet/rule-core            packages/rule-core/src/       (existing, canonical)
        ↑
@sweet/workflow-brain       packages/workflow-brain/src/  (new, headless)
        ↑
host adapters               src/app/features/workflows/data/*  (Angular)
```

- rule-core never imports the Brain. The Brain never imports Angular, DOM,
  storage, HttpClient, provider SDKs, demo data (`platformData`), or the host
  tree. `core-tests/assert-workflow-brain-purity.ts` pins this mechanically.
- Brain sources import rule-core via relative specifiers
  (`../../rule-core/src/<module>`) — the sync script rewrites these for the
  vendored copy.

## Vendoring

`scripts/sync-angular-core.ts` (extended) manages TWO one-way mirrors:

| Source | Vendored copy | Import rewrite |
|---|---|---|
| `packages/rule-core/src/*.ts` (except index.ts) | `src/app/core/` | none (flat) |
| `packages/workflow-brain/src/*.ts` (except index.ts) | `src/app/brain/` | `../../rule-core/src/` → `../core/` |

Same banner mechanism, same `--check` drift gate. Angular imports the vendored
copies; core-tests import the PACKAGE paths (precedent: assert-revisions.ts).
Nobody hand-edits `src/app/core/**` or `src/app/brain/**`.

## Pipeline (north star)

```text
description
  → span-preserving normalization            (parserClauses)
  → clause segmentation + classification     (parserClauses)
  → deterministic parse                      (nlParser — existing, additive spans export)
  → clause→rule projection + coverage        (parserCoverage)
  → contradiction/unsupported detection      (parserClauses + parserContradictions)
  → [complex only] AI candidate via transport (orchestrator + AiParseTransport)
  → hostile-output normalization + allowlist  (candidateNormalization)
  → entity re-resolution against snapshot    (parserGrounding + context)
  → validation + lint + org policy           (existing rule-core)
  → parse gate (deterministic, fail closed)  (existing parseGate + envelope)
  → clarifications / consultant / ghost      (brain modules)
```

The existing `ParseResult` honesty sidecars and `parseGate` semantics are
unchanged and remain the readiness authority. Everything new is additive.

## Frozen module contracts

### packages/rule-core/src/parserClauses.ts (owner: clause-compiler)

```ts
export interface SourceSpan { start: number; end: number }          // [start,end) over normalized text
export interface NormalizedSource {
  raw: string;                    // original input
  text: string;                   // norm(): lowercased, whitespace-collapsed, trimmed
  toRaw(normIndex: number): number; // offset map back into `raw`
}
export function normalizeSource(raw: string): NormalizedSource;

export type ClauseKind =
  | "trigger" | "condition" | "action-primary" | "action-alternate"
  | "action-guard" | "timing" | "control" | "no-op" | "unsupported" | "unknown";

export interface ParsedClause {
  id: string;                     // stable: derived from input hash + span (djb2-style, no Date/random)
  span: SourceSpan;               // over NormalizedSource.text
  rawSpan: SourceSpan;            // over NormalizedSource.raw
  text: string;                   // exact normalized slice
  kind: ClauseKind;
  material: boolean;              // false only for connectors/noise
  unsupportedReason?: string;     // kind === "unsupported" only (e.g. schedule/recurrence)
}

export function segmentInstruction(raw: string): { source: NormalizedSource; clauses: ParsedClause[] };
export function stableClauseId(sourceText: string, span: SourceSpan): string;
```

Segmentation rules: trigger clause = text before first `,`/`then` boundary
containing the event evidence; `otherwise|else` starts the alternate lane;
`unless|except` = exception clause (condition or unsupported); action `if`
guards attach to the preceding action clause (`action-guard`); delay phrases =
`timing`; shadow/live/cap/once-per = `control`; "otherwise do nothing" variants
= `no-op`; schedule/recurrence language (`every day`, `each week`, `business
days`, `recurring`, `on mondays`…) = `unsupported` with reason. Classification
is vocabulary-driven (EVENTS/FIELDS/ACTIONS evidence), deterministic, and never
guesses: no evidence = `unknown` (material).

### packages/rule-core/src/parserProvenance.ts (owner: contract-architect)

```ts
export const PARSER_ENGINE_VERSION = "2026.07.24-1";
export type EngineMode = "deterministic" | "ai" | "hybrid" | "deterministic-fallback";

export interface ParserProvenance {
  engine: EngineMode;
  parserVersion: string;              // PARSER_ENGINE_VERSION
  promptVersion?: string;             // AI paths only
  provider?: string; model?: string;  // AI paths only, from transport meta
  vocabularyHash?: string;            // BrainContextSnapshot.vocabularyHash
  contextSnapshotId?: string;
  requestId?: string;
  generation: number;                 // description generation this result belongs to
  createdAt: number;                  // epoch ms — INJECTED clock, not Date.now()
  latency?: { totalMs: number; stages: Record<string, number> };
  fallbackReason?: string;            // engine === "deterministic-fallback" only
}

export interface ClauseRuleLink {
  clauseId: string;
  /** Rule paths that represent the clause: "triggers[0]", "conditions.leaf[2]", "actions[1]", "else[0]", "actions[1].when", "actions[1].delayMinutes", "controls.mode"… */
  rulePaths: string[];
  status: "represented" | "no-op" | "unresolved" | "ambiguous" | "uncovered" | "unsupported" | "contradictory";
}

export interface ContradictionFinding {                // lives HERE (contract layer), implemented in parserContradictions.ts
  paths: string[]; clauseIds: string[];
  kind: "mutually-exclusive-values" | "empty-numeric-range" | "negated-and-required" | "duplicate-action-conflict";
  message: string;
}

export interface ParseEnvelope extends ParseResult {   // additive — every ParseResult consumer keeps working
  clauses?: ParsedClause[];                            // import type from "./parserClauses"
  clauseLinks?: ClauseRuleLink[];
  unsupported?: Array<{ clauseId: string; text: string; reason: string }>;
  contradictions?: ContradictionFinding[];
  suggestions?: string[];             // max 3 — enforced by makeEnvelope
  provenance?: ParserProvenance;
}

export function makeEnvelope(base: ParseResult, extras: Partial<ParseEnvelope>): ParseEnvelope; // clamps suggestions to 3, never weakens sidecars
export function isParseEnvelope(v: unknown): v is ParseEnvelope;                                 // superset of the DraftEngine isParseResult guard
```

Transient parser metadata stays OUTSIDE persisted `WorkflowRule` JSON.

### packages/rule-core/src/parserGrounding.ts (owner: context-window-grounding-engineer)

```ts
export interface VocabularySnapshot {
  events: string[]; fields: string[]; actions: string[];            // canonical keys only
  operatorsByKind: Record<string, string[]>;
  instanceOptions: Record<string, string[]>;
  instanceRegistry: Record<string, { id: string; label: string }[]>;
  assignees: string[];
  source: string; version: string;
  hash: string;                       // stableVocabularyHash(...)
}
export function stableVocabularyHash(snapshot: Omit<VocabularySnapshot, "hash">): string; // deterministic content hash (djb2/fnv over canonical JSON — no crypto import needed)
export function staticVocabularySnapshot(): VocabularySnapshot;      // from FIELDS/EVENTS/ACTIONS + static options
export type GroundingVerdict =
  | { kind: "grounded"; canonical: string; instanceId?: string }
  | { kind: "duplicate"; candidates: string[] }
  | { kind: "suggestions"; candidates: string[] }
  | { kind: "unknown" };
export function groundValue(registryKey: string, text: string, snapshot: VocabularySnapshot): GroundingVerdict;
export function groundRule(rule: WorkflowRule, snapshot: VocabularySnapshot): { findings: GroundingFinding[] }; // every key/entity in the rule re-checked
export interface GroundingFinding { path: string; heard: string; verdict: GroundingVerdict }
```

Exact match wins; aliases deterministic; fuzzy = suggestions only; duplicate
labels = clarification; tenant strings are data, never instructions.

### packages/rule-core/src/parserCoverage.ts + parserContradictions.ts (owner: deterministic-parser-engineer, Wave 2)

```ts
export function projectClausesOntoRule(clauses: ParsedClause[], result: ParseResult): ClauseRuleLink[];
export interface ClauseCoverageReport {
  links: ClauseRuleLink[];
  materialUnaccounted: string[];      // clause ids — MUST be empty for readiness
  fabricated: string[];               // rule paths with NO source evidence — MUST be empty
}
export function clauseCoverage(clauses: ParsedClause[], result: ParseResult): ClauseCoverageReport;

export interface ContradictionFinding {
  paths: string[]; clauseIds: string[];
  kind: "mutually-exclusive-values" | "empty-numeric-range" | "negated-and-required" | "duplicate-action-conflict";
  message: string;
}
export function findContradictions(rule: WorkflowRule, clauses?: ParsedClause[]): ContradictionFinding[];
```

`nlParser.ts` change is ADDITIVE ONLY: expose consumed spans on the result
(`consumed?: Array<[number, number]>`) with zero behavior change; every
existing assertion stays byte-for-byte green.

### packages/workflow-brain/src (Brain modules)

- `context.ts`, `ports.ts` — WRITTEN (lead). Read them; they are the freeze.
- `contextCompiler.ts` (grounding engineer): `compileContext(snapshot, request)` →
  bounded, ranked, canonical-serialized context: dedup, rank by focusText
  relevance (deterministic scoring), enforce `maxBytes` with per-section
  truncation reports, produce `snapshotId`/`vocabularyHash` via
  `stableVocabularyHash`. Also `snapshotToParseOptions(snapshot,…): ParseOptions`.
- `brainState.ts` (foundation architect): deterministic session state machine.
  Phases: `discover → scope → draft → gaps → recommend → propose → consent →
  apply → verify → simulate → prepare`. `BrainSessionState` holds: profile,
  snapshotId, description generation, latest ParseEnvelope, open questions,
  recommendations with accept/reject state, authoring history (append-only).
  `reduceBrain(state, event): BrainSessionState` — pure reducer;
  events include `context-switched` (MUST: new snapshotId, discard
  tenant-specific memory, invalidate suggestions/recommendations, keep only
  context-independent facts), `description-changed` (generation++ invalidates
  everything derived), `parse-completed`, `clarification-answered`,
  `recommendation-accepted/rejected`, `ghost-accepted/dismissed`.
- `aiPort.ts` + `orchestrator.ts` (Wave 2): hybrid strategy per the mandate
  (deterministic first; AI only when it adds value; ≤1 bounded structural
  repair; timeout/cancel; fallback envelope always valid).
- `candidateNormalization.ts` (Wave 2): treat transport candidate as hostile:
  structural validation, unknown-key rejection, size/array/string caps, enum
  allowlisting, entity re-resolution via `groundRule`, semantic comparison via
  `clauseCoverage`, then existing `validateRule`/`lintRule`. Fail closed.
- `consultant.ts` / `recommendations.ts` / `proposals.ts` (Wave 2): structured
  consultant contracts (`understanding`, `facts`, `questions`,
  `recommendations`, `watchouts`, `alternatives`, `proposedChanges`,
  `nextBestAction`, `contextUsed`, `canApply`, `requiresApproval`);
  deterministic analyzers produce facts; `RulePatchOp[]` + `applyRulePatch` for
  exact previewed patches; acceptance applies the exact preview then re-runs
  gates; rejection recorded.
- `ghostSuggestions.ts` (Wave 2): request/response contract per spec
  (`suggestionId`, `prefixHash`, `contextSnapshotId`, `ruleVersion`,
  `cursorStart/End`, `insertText`, `displayText`, `kind`, `source`, evidence,
  expiration), deterministic completion engine + suppression policy + ranking +
  staleness keying.
- `observability.ts` (Wave 3): correlation ids, stage timers, dimension
  allowlist, retry/circuit-breaker policy, tenant-scoped cache keys
  (`tenantKey | parserVersion | promptVersion | inputHash | optionsHash |
  vocabularyHash`).

## Wire contract (unchanged endpoint, additive response)

`POST {apiBase}/workflows/parse-ai` via ApiService (bearer + x-organization +
x-landjourney-*). Request `{ text, options: ParseOptions }`. Response: a
`ParseResult`; servers MAY return the additive `ParseEnvelope` fields. The
client keeps its shape-guard-else-fallback behavior. Backend spec lives in
`docs/parser-ai-backend-contract.md`.

## Testing conventions

- New core tests: `core-tests/assert-*.ts`, tsx-runnable, PASS/FAIL lines +
  non-zero exit on failure (copy the harness pattern from assert-parser.ts).
- Import PACKAGE paths (`../packages/rule-core/src/…`,
  `../packages/workflow-brain/src/…`).
- No network, no live model calls, no Date.now()-dependent assertions.
- The lead adds files to the `npm test` chain at integration.

## Non-negotiable invariants (from the assignment)

1. rule-core stays pure and canonical; generated mirrors never hand-edited.
2. ParseResult sidecars and deterministic parseGate never weakened; model
   confidence never overrides a gap.
3. Provider credentials never reach the Angular bundle; ApiService is the only
   transport.
4. Mock mode + deterministic fallback work with zero provider config.
5. Partial interpretations never look ready; unknown entities are questions.
6. The parser translates stated intent — it never invents policy or arms rules.
