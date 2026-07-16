# Phase 8 (Trigger Correctness & Context Autocomplete) — QA Handoff for Gemini (Overseer)

**From:** Claude (Coder)
**Date:** 2026-07-16
**Branch:** `feature/nlp-autocomplete-hardening-phase-8`
**Diff base:** `f1e0079` — **working tree is uncommitted**, review `git diff` + the two new untracked files
**Spec:** `docs/2026-07-16_phase-8-ai-specs_v1.md` (§1 trigger parsing, §2 autocomplete, §3 few-shot, §4 tests)

> Distinct from `docs/2026-07-16_workflow-creator-hardening-phase-8-qa-handoff_v1.md`, which covers the
> resilience/concurrency work order at `4720291`. Same phase number, different work order.

---

## 1. Status at a glance

| Gate | Result |
|------|--------|
| `npm run test` | ✅ 487 PASS / 0 FAIL, exit 0 (23 scripts, incl. the new autocomplete suite) |
| `npx tsc --noEmit` | ✅ clean |
| `npm run lint` | ✅ clean |
| `npm run build` | ✅ clean (compiled in ~2.0s) |

---

## 2. Headline: §1, §3 and §4 were already implemented before this work started

I tested the existing tree against the spec before writing anything, and three of the four
sections were already green. **No rewrite was performed on them.**

- **§1 trigger parsing** — `matchEvent()` already carried every qualified-phrase branch (landed in
  `0a61406`). I probed all 12 spec phrases — both the copula (`"document upload is approved"`) and
  bare (`"document upload approved"`) forms across DOCUMENT/LOAN × APPROVED/REJECTED, CHECKLIST
  COMPLETED, plus both ambiguity cases — and all 12 behave exactly as §1 specifies. **Unchanged.**
- **§3 few-shot prompt** — `buildSystemInstruction()` already carries 4 examples covering the three
  required shapes: else conditions (Ex. 2), assignee objects (Ex. 1/2/3), and the A/B nested split
  (Ex. 3). **Unchanged.**
- **§4 test runner** — `scripts/assert-nlp-parser.ts` already existed and was already wired into the
  `test` array. Rewritten for spec fidelity only (see §4 below), not created.

The only section needing real work was **§2**, which was substantively broken.

---

## 3. §2 — the bug that mattered

Context detection matched the **first** `if`-branch rather than the **nearest** keyword behind the
caret. The regexes (`/\b(?:when|whenever)\b\s*[^,\.]*$/`) ran to end-of-string, so an opening
"when" swallowed the entire sentence:

| Input | Ranked | Should rank |
|---|---|---|
| `when a loan is approved notify wa` | events | **assignees** |
| `when a loan is approved and risk gra` | events | **fields** |
| `whenever an offer is accepted escalate to und` | events | **assignees** |
| `when a loan is approved, assign to wa` | assignees ✅ | assignees |

It only worked when a comma happened to break the regex — i.e. the feature was silently wrong for
the most natural phrasing, and *looked* correct in exactly the demo sentences that use commas.

Three further defects underneath:

1. **1-word windows outranked wider ones.** Matches were collected 1→2→3 words and concatenated, so
   `"document appro"` offered `LOAN APPROVED` (1-word hit on `appro`) above `DOCUMENT APPROVED`
   (2-word hit) — defeating the multi-word capture §2 explicitly asks for.
2. **`acceptSuggestion` stripped the author's commas.** It rebuilt the whole string via
   `input.split(/[\s,]+/).join(" ")`. `nlParser` reads commas as clause boundaries
   (`matchEvent`'s `clauseSep`, `matchOutputs`' lazy captures), so accepting a completion could
   quietly change how the finished instruction parses.
3. **The demo roster never completed.** `buildOverlay()` leaves `instances.users` empty whenever the
   platform is unconfigured — every local/demo run — and the assignee bucket was
   `ASSIGNEES.filter(/team$/i)` + live users only. So **Wael, Sara, Mohammed, Aisha, Omar and Layla
   were never suggested at all**, in the exact flow the spec's own test cases exercise
   (`"notify wael"`, `"notify sarah"`).

### What changed

- **New `lib/autocomplete.ts`** — the engine, pure and framework-free. The logic was previously
  unreachable inside the component; `lib/` + `scripts/assert-*.ts` is this repo's testable seam.
  Context scans backwards for the nearest keyword; candidates are bucketed and ranked by
  *context bucket → widest window → fuzzy rank*; de-dup happens after the sort so an option found by
  both a 1- and 2-word window keeps the wider window.
- **`components/ChatBox.tsx`** — reduced to owning the textarea and dropdown chrome (net −59 lines).
- **`applyCompletion`** splices only the matched window against the byte-for-byte prefix.
- **Matches carry their `windowSize`**, so accepting swaps exactly the words that matched instead of
  re-deriving the window from the finished string (the old heuristic's guesswork).
- **New `scripts/assert-autocomplete.ts`** (15 assertions) + wired into `test`.

---

## 4. §4 — test rewrite

`assert-nlp-parser.ts` passed before and passes now; the rewrite is for spec fidelity:

- Assertion 3 used `"when approved assign to wael"`; the spec says **`"when approved notify wael"`**.
- Coverage went from 3 phrases to all 10 qualified phrases + both ambiguity cases.
- The ambiguity check now also asserts `rule === null`, not just `ambiguities.length > 0`.

---

## 5. Priority review areas (where I want your eyes)

1. **`"and"`/`"or"` → Fields is spec-mandated but suspect for the second assignee.** Per §2, `and`
   maps to Fields — so `"notify wael and sar"` ranks fields ahead of people, even though the author
   is plainly naming a second person. The nearest-keyword fix makes this *more* visible than before
   (previously the leading "when" masked it). I implemented the spec as written. **Confirm the spec
   is right, or we special-case `and` after an assignee keyword.**
2. **I added a 4th bucket, `value`, beyond the spec's three.** Instance operands (retailers,
   templates, stages) were previously filed under *assignee*, which meant `"notify …"` offered stage
   names. They now rank last in their own kind. This is additive and keeps §2's "Assignees (Users &
   Teams)" honest — **confirm the deviation.**
3. **Pre-existing, not fixed: live stage labels may not resolve in the parser.** `buildOverlay()`
   emits template-qualified stage labels (`"Origination › Closed"`), but `matchOutputs`' `change_stage`
   resolves against the plain `FIELDS.stage.options`. So accepting a live stage completion likely
   lands as an unresolved slot. Out of §2's scope; flagging as a Phase 9 candidate.
4. **Sort precedence: context bucket dominates window size.** I read §2's "score by context priority"
   as the primary key, with widest-window as the tiebreak. The two orderings agree on every case I
   tested — **confirm the precedence.**
5. **Two literal-spec deviations, both intentional.** (a) §2 says "Import `fuzzyMatches` in
   ChatBox.tsx" — it is now imported by `lib/autocomplete.ts`, since the matching moved there; the
   intent (fuzzy over substring) holds. (b) §2 says `acceptSuggestion(suggestion)` — the signature is
   now `acceptSuggestion(match: AutocompleteMatch)` so the matched window travels with the match
   rather than being re-guessed.
6. **`useMemo` staleness (judged acceptable).** `candidates` rebuilds when the vocab overlay arrives,
   but an open dropdown isn't recomputed until the next keystroke. Confirm that's fine.

---

## 6. Files to review

| File | Change |
|---|---|
| `lib/autocomplete.ts` | **new** — the engine (context, windows, fuzzy, apply) |
| `scripts/assert-autocomplete.ts` | **new** — 15 assertions |
| `components/ChatBox.tsx` | rewired to the engine; −59 lines net |
| `scripts/assert-nlp-parser.ts` | rewritten for spec fidelity (§4 above) |
| `package.json` | `assert-autocomplete.ts` added to `test` |

**Untouched, verified-as-already-correct:** `lib/nlParser.ts`, `app/api/workflows/parse-ai/route.ts`.
