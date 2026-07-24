# Ghost autowriting — behavior spec

Status: v1, owner `ghostwriting-experience-engineer` (2026-07-24). Engine:
`packages/workflow-brain/src/ghostSuggestions.ts`; contract test:
`core-tests/assert-ghost-suggestions.ts`. Frozen names per
`docs/parser-ai-engine-architecture.md`.

## What a ghost is

A ghost is a single inline continuation offered at the caret: the exact
`insertText` that, appended to the current prefix, extends the author's
instruction. It begins precisely where the prefix ends (space-vs-comma joints
are computed, never guessed), suggests at most ONE clause, and only ever
speaks entities that exist in the current `BrainContextSnapshot`. When nothing
safe and useful exists the engine returns `null` — silence is a feature, and
the overlay simply shows nothing.

## Request policy (host + `ghostPolicy`)

`ghostPolicy(state, deterministic)` is evaluated on every candidate render.
Gate order, first hit wins:

| Gate | reason | allow | useAi |
|---|---|---|---|
| IME composition active | `ime` | false | false |
| Selection (`cursorStart !== cursorEnd`) | `selection` | false | false |
| Caret not at end of text | `cursor-not-at-end` | false | false |
| Prefix < 8 chars or < 2 words | `too-short` | false | false |
| Host offline | `offline` | true | false |
| Recent 429/limit signal | `rate-limited` | true | false |
| `ghost-suggestions-ai` capability absent | `no-capability` | true | false |
| Deterministic ghost is sufficient | `deterministic-sufficient` | true | false |
| Everything clear | `ok` | true | true |

- `allow: false` suppresses ALL ghosting; `allow: true, useAi: false` still
  shows the deterministic ghost. AI capability is host-provided and fail
  closed (`HostCapabilityPort`), never inferred.
- "Sufficient" = deterministic kind `grounded-entity` or `clause-completion`.
  `missing-outcome` / `exception-path` are structural hints, so AI refinement
  is still allowed on top of them.

Debounce and cancellation (Angular layer obligations):

- Deterministic path runs synchronously on every keystroke — it is pure CPU.
- AI path: fire only after a **>= 600 ms** typing pause, **at most one
  in-flight request**, and **cancel (AbortSignal) on every input, cursor,
  generation, or context-snapshot change**. Never issue per-keystroke calls.
- The transport is `GhostSuggestTransport` (host adapter over ApiService);
  its response is UNTRUSTED and must pass `validateGhostCandidate`.

## Deterministic path (`deterministicGhost`)

Runs against a phrase bank built from the snapshot (assignees,
`instanceOptions` labels, `instanceRegistry` labels) plus canonical rule-core
vocabulary (field/operator/action/event labels + event-word tokens) and a
small connective set. Tenant entities come ONLY from the snapshot. Steps, in
order, first producer wins:

1. **Entity argument** — `assign to Wa` / `notify Om`: partial (>= 2 chars)
   after the verb prefix-matches snapshot labels only → kind
   `grounded-entity`, evidence cites the registry (`snapshot:assignees`,
   `registry:<key>:<id>`, `options:<key>`).
2. **Word/window completion** — trailing windows of 4 → 1 words (>= 3 chars)
   prefix-match the bank; longest window wins, ties break lexicographically.
   Remainder carries the phrase's own casing. Kind `grounded-entity` for
   snapshot labels, else `clause-completion`.
3. **Missing outcome** — trigger stated (event evidence), no action evidence
   yet → `, assign to <first snapshot assignee>`; requires non-empty
   `snapshot.assignees`, else null. Kind `missing-outcome`.
4. **Exception path** — condition + action present, no `otherwise`/`else` →
   `, otherwise do nothing` (an explicit no-op is always safe). Kind
   `exception-path`.

Hard rules: caret must be at end of text; never suggest text already present
(substring check); stop at one clause; NEVER suggest thresholds, amounts,
approval routing, arming/mode changes, or any entity absent from the snapshot.

## AI path (`validateGhostCandidate`)

The transport candidate is hostile input. Accepted only when ALL hold:
object with string `insertText`, 1–120 chars, single line, no control chars;
adds text not already present; every capitalized multi-word phrase grounds
against snapshot labels (unknown entity → reject); contains at least one known
domain term (snapshot label or canonical vocabulary phrase/token) — free
prose and prompt-injection payloads ground nowhere and are rejected. The
result is re-keyed from the request state (`source: "ai"`); candidate-supplied
evidence/ids are discarded and rebuilt as safe refs.

## Staleness and dismissal

Every suggestion is keyed by `prefixHash` (djb2 of the prefix),
`contextSnapshotId`, `ruleVersion`, `generation`; `expiresAtGeneration =
generation + 1`. `ghostIsFresh` demands ALL keys match — any edit, undo,
parse-version bump, or snapshot invalidation discards the ghost (emit
`stale-discarded`, never render). Dismissals (`makeGhostDismissals`) are
in-memory `(prefixHash, insertText)` pairs scoped to a generation: an Esc'd
ghost is not re-offered for the same prefix, and `clearBefore(generation)` on
the next generation forgets it. Nothing is persisted.

## Rendering contract (Angular layer)

- Inline, non-value overlay aligned to the composer textarea: ghost text is
  visually muted, is NOT part of the input value, and never moves the caret.
- **Tab** accepts (insert `insertText` at the caret, emit `accepted`);
  **ArrowRight at end-of-text** may also accept (d329223 precedent); **Esc**
  dismisses (record dismissal, emit `dismissed`). Touch: an explicit tappable
  chip/affordance accepts — no hidden gesture.
- Partial accept (word-by-word), when offered, emits `partially-accepted`.
- `prefers-reduced-motion`: no typing/reveal animation — ghost appears and
  disappears instantly.
- Accessibility: one `aria-live="polite"` announcement per NEW suggestion
  (e.g. "Suggestion available: press Tab to accept") — never per keystroke,
  never re-announced for the same suggestionId.
- Render only if `ghostIsFresh(...)` and not dismissed; re-check before accept.

## Telemetry

`emitGhostTelemetry(sink, event, dims)` with events `offered | accepted |
partially-accepted | dismissed | stale-discarded | suppressed`. Dimensions are
enum-shaped only (`source`, optional `latencyBucket`); values failing the
enum-shape allowlist are dropped. Deliberately NOT recorded: author text,
prefixes, insertText, entity labels, tenant vocabulary, prompts, provider
payloads, ids derived from customer content. Undefined sink = no-op.

## Privacy and cost budget

- No per-keystroke AI calls; >= 600 ms debounce; one in-flight max; cancel on
  invalidation. Deterministic path is synchronous and free.
- Latency budget: deterministic ghost renders in the same frame; AI path p95
  < 1.5 s or the result is discarded as stale on arrival.
- The AI request carries only `{ prefix, contextSnapshotId, requestId }`
  through the host transport (ApiService; provider credentials never reach
  the browser bundle beyond that seam).

## Relationship to the d329223 predictive bar

`ui/ghost-prediction.ts` (`predictWorkflowGhost`) is SUPERSEDED by this
engine; the composer swap (replacing the `ghostRaw` computed and
`onComposerKeydown` accept path with Brain calls) is the Angular teammate's
task. Mapping:

| d329223 construct | Engine equivalent | kind |
|---|---|---|
| CLAUSE_RULES trigger-word → action clause (rules 1–3) | `suggestMissingOutcome` (snapshot assignee, comma joints) | `missing-outcome` |
| CLAUSE_RULES verb-argument rules (`assign to` / `notify` …) | entity-argument completion vs snapshot | `grounded-entity` |
| CLAUSE_RULES `and notify Wael` recipient add-on | not carried over (entity chaining = invention risk) | — |
| PHRASE_BANK curated openers/connectives | connective set + vocabulary labels/tokens | `clause-completion` |
| PHRASE_BANK live vocabulary (ASSIGNEES/FIELDS/OPERATORS/ACTIONS/EVENTS) | snapshot bank + rule-core vocabulary bank | both |
| `completeLastWord` 4→1-word windows | `completeWindow`, same windows, deterministic tie-break | both |
| implicit "if the credit score is below 620" suggestions | dropped — thresholds are policy invention | — |
| (no equivalent) | exception path, AI refinement, staleness keys, dismissals, telemetry | new |
