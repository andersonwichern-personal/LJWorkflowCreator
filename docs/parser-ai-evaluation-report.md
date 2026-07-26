# Parser AI engine — evaluation report

Run date: 2026-07-24 · Parser version: `2026.07.24-1` · Engine evaluated:
**deterministic** (`parseInstruction` + the clause/coverage/grounding layers).
No live provider calls were made in any run recorded here; the AI path is
exercised exclusively through mock transports and the hostile-candidate
review suite. Reproduce with `npm run eval:parser` (corpus in
`docs/data/parser-evals/`, harness `scripts/eval-parser.ts`).

## Corpus

| Group | Cases | Source |
|---|---|---|
| gold | 161 | curated lending-domain instructions, every expectation empirically verified against the shipped parser |
| adversarial | 59 | red-team fixtures (13 threat categories), every expectation empirically verified |
| metamorphic | 56 | derived variants (casing 10, punctuation 10, whitespace 8, connector 8, negation-flip 10, typo 10) |
| **total** | **276** | |

Gold coverage: all 23 event keys, all 18 action keys, every field kind and
operator, multi-trigger, AND/OR logic, action guards, both action lanes,
intentional no-ops, positive/negative delays, controls, category and instance
scopes, duplicate labels, ambiguities, unknown entities, unbacked values,
typos, negation, unless/except, unsupported schedules, plus 14 pinned
known-gap cases (below). 32 gold cases (+16 inherited by mutants) are scored
exhaustively (extra components count against precision).

## Results (deterministic engine, all 276 cases pass)

| Metric | Score |
|---|---|
| trigger precision / recall | 257/257 · 257/257 (1.000) |
| condition precision (exhaustive) / recall | 24/24 · 100/100 (1.000) |
| action precision (exhaustive) / recall | 59/59 · 224/224 (1.000) |
| control accuracy | 10/10 (1.000) |
| full-rule exact match (exhaustive) | 48/48 (1.000) |
| **fabrications (hard bar: must be 0)** | **0** |
| honesty — ambiguity / unresolved / uncovered / unbacked expectations met | 10/10 · 29/29 · 13/13 · 3/3 |

Interpretation caveat: these are pinned-truth scores — the corpus asserts the
parser's HONEST behavior, including its refusals and clarifications. They are
not a claim that every sentence parses to a complete rule; the known-gap
inventory below is the honest failure surface.

## Latency (measured, Node, this machine)

`parseInstruction` p50 **0.065 ms** / p95 **0.096 ms** over 600 runs
(15 sentences × 40 iterations, 10 warm-ups; `assert-brain-observability.ts`
prints the live measurement each run; CI gate at 250 ms). The <100 ms product
target is met with ~1000× headroom. AI-path latency is not measured here — no
live provider runs; the backend budget lives in
`docs/parser-ai-backend-contract.md`.

## Hard quality bars (status)

- Zero fabricated key/entity acceptance across gold+adversarial: **met** (0).
- Material dropped clauses surfaced by the gate: **met** (coverage suite pins
  `materialUnaccounted`/`fabricated` empty for honest parses; dropped clauses
  land in `uncovered`).
- Invalid/unknown model keys rejected or converted: **met**
  (`assert-parser-ai-boundary.ts`, 84 asserts, allowlists + re-grounding).
- Cross-tenant isolation, stale-context/suggestion discard, shared adapter
  contract, brain purity/transplant gate, existing regressions, valid fallback
  envelope on every failure path: **met** (25-suite `npm test` chain green at
  `45bc97e`).
- No live provider calls in CI: **met** (no network anywhere in the chain).

## Known-gap inventory (honest failures, pinned as gold "known-gap" cases)

Severity-ordered; each is DOCUMENTED behavior with a test pinning it, not a
silent defect. The consultant now emits a high-risk watchout for #1.

1. **"unless X" inversion** — parsed as the positive condition X (gold-129/130).
   Mitigated by the consultant's `inverted-condition-risk` watchout; a grammar
   fix requires re-pinning the fixpoint suites.
2. Guard duplication — action `if` gates also land as root conditions (gold-088/089).
3. Bare-substring terminators — captures can truncate at embedded `and`/`then` (gold-161).
4. `add_tag` swallows a trailing delay phrase into the tag literal (gold-139).
5. `route_to_queue` bare label is hijacked by the assign grammar (gold-135).
6. Cross-clause trigger hijack when the trigger clause names no event (gold-144).
7. Decimal truncation in numeric captures ("1.25" → "1", gold-136).
8. `is_empty`/`contains` not authorable from text (gold-138/140).
9. Event-scoped field misses surface only as `uncovered` (gold-137).
10. Same-field OR value lists drop the second value (gold-142/143).
11. Multi-recipient notify collapses to one slot (gold-141).
12. Control phrases double-report into `uncovered` (gold-100..104, gold-145).
13. Trailing schedule language can poison an adjacent param capture (gold-133/134).
14. Duplicate registry labels: first entry silently wins at the parser layer
    (gold-111); `groundValue` reports the duplicate for the clarification layer.
15. Category words double-emit a leaf + category ref (gold-105..107).

## Failure list

Empty — all 276 cases pass at `45bc97e`. Any future failure prints the case id
and per-field diff via `npm run eval:parser` (exit 1).
