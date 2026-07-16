# Phase 10 QA Handoff — AI Model Upgrade (Gemini 3.5 & Phase 9 Alignment)

**Date**: 2026-07-16
**Author**: Claude (Coder)
**Reviewer**: Gemini (Overseer / QA)
**Branch**: `feature/ai-model-upgrade-phase-10`
**Status**: **READY FOR QA — not signed off.** One deliberate spec deviation needs a ruling: see §3.

---

## 1. Scope delivered

**1. Candidate model list** — `app/api/workflows/parse-ai/route.ts`

`GEMINI_MODELS` now prioritises Gemini 3.5, keeping the `gemini-flash-latest` alias as the anti-rot
backstop:

```ts
const GEMINI_MODELS = [
  ...(process.env.GEMINI_MODEL?.trim() ? [process.env.GEMINI_MODEL.trim()] : []),
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
];
```

`gemini-3.5-flash-lite` is **omitted** against the spec — it does not exist. See §3.

**2. Parser prompt context** — `buildSystemInstruction()`

- Two new instruction lines: one teaching `delayMinutes` as a sibling of `action`/`params` with the
  SLA conversions (2 days = 2880, 24 hours = 1440, 3 days = 4320); one teaching the covenant trigger,
  its three fields, and that age wording ("worse than 90 days") maps to `gt` / `"90"`.
- Example 4 (new): `"when a loan is approved, notify Wael after 2 days"` → `delayMinutes: 2880`.
- Example 5 (new): the `SCHEDULED COVENANT REVIEW` covenant example from the spec, verbatim.
- The prior compound-trigger example renumbered 4 → 6. No other examples changed.

**3. Verification** — `scripts/assert-ai-upgrade.ts` (new, 17 assertions, no network)

Wired into `npm run test` between `assert-parse-ai` and `assert-requirement`.

---

## 2. Verification results

| Check | Result |
| --- | --- |
| `npm run test` | **PASS** — exit 0, 536 assertions (spec projected 519+) |
| `npm run build` | **PASS** — exit 0 |
| `npm run lint` | **PASS** — exit 0, no warnings |
| Live end-to-end (real Gemini, real route) | **PASS** — see below |

Beyond the mocked suite, both Phase 10 behaviours were driven against the **live** API through the
real route:

```
--- "when a loan is approved, notify Wael after 2 days"
  [gemini-3.5-flash] -> HTTP 503   → fell through
  [gemini-3.1-flash-lite] -> HTTP 200
  actions: [{"action":"notify", ..., "delayMinutes":2880}]          ✅

--- "when a scheduled covenant review fires, if days since financials pulled is worse than 90 days, notify Omar"
  [gemini-3.5-flash] -> HTTP 503   → fell through
  [gemini-3.1-flash-lite] -> HTTP 200
  trigger: [{"event":"SCHEDULED COVENANT REVIEW"}]
  conds:   [{"field":"days_since_financials_pulled","operator":"gt","value":"90"}]   ✅
```

Vocabulary cross-checked against `lib/vocabulary.ts`: the covenant event (L816), all three covenant
fields (L198+), `RuleOutput.delayMinutes` (L1267) and its `normalizeRule` passthrough (L1521) are all
real Phase 9 entries. `notify`'s param key is `value` (`paramKeyFor`, L1083), matching the examples.

---

## 3. Spec deviation — `gemini-3.5-flash-lite` does not exist

**Ruling needed from QA.** The spec (§2.1) pins `gemini-3.5-flash-lite`. It is not a real model.

Verified against ListModels and `generateContent` with the project key on 2026-07-16:

| Candidate | Status |
| --- | --- |
| `gemini-3.5-flash` | **Real** — listed; HTTP 503 (high demand) at time of testing |
| `gemini-3.5-flash-lite` | **Does not exist** — absent from ListModels; HTTP 404 `"is not found for API version v1beta"` |
| `gemini-3.1-flash-lite` | Real — HTTP 200 |
| `gemini-flash-latest` | Real — HTTP 503 at time of testing |

**Why it matters now, not hypothetically.** `gemini-3.5-flash` is 503 today, so live traffic *is*
taking the fall-through path. As specced, every request would burn a wasted 404 round-trip on
`gemini-3.5-flash-lite` before reaching a model that answers. The entry could never serve traffic —
it fails 100% of the time, by construction.

This is the same failure the deleted Phase 8 comment warned about (`gemini-2.5-flash` 404ing for new
users). I restored that rationale in the code comment and generalised it: every pinned name must be
one ListModels actually serves.

**Counter-argument QA should weigh:** if `gemini-3.5-flash-lite` is expected to ship soon, pre-pinning
it costs one 404 per fall-through until launch and then works with no code change. I judged the
guaranteed cost not worth the speculative benefit — but this is Gemini's call to overturn.

`assert-ai-upgrade.ts` pins this decision with an assertion, so re-adding the model fails the suite
loudly rather than silently.

---

## 4. Test coverage added

`scripts/assert-ai-upgrade.ts` covers the spec's asks plus one gap I found:

- Gemini 3.5 Flash is the first default candidate.
- Prompt teaches `delayMinutes` and all three conversions (2880 / 1440 / 4320).
- Prompt teaches `SCHEDULED COVENANT REVIEW` and names the covenant fields.
- A delayed action preserves `delayMinutes: 2880` end-to-end through `normalizeRule`.
- The covenant trigger compiles and its field maps to `gt` / `"90"`.
- **Gap filled:** spec §1 requires the loop to fall through on 404/429/503 and degrade to the
  heuristic parser when *all* models fail. `assert-parse-ai.ts` only covered a single 404→next-model
  hop and a non-fall-through HTTP 500. Now asserted: 503→429→200 fall-through, candidates tried once
  each in order, and all-candidates-404 → `engine: "heuristic"` with the user-facing note.

`scripts/assert-parse-ai.ts` L108 updated: its "default fast model is attempted second" assertion
named `gemini-3.1-flash-lite`, now `gemini-3.5-flash`.

---

## 5. Observation — not fixed, out of scope

In the live run the model emitted `{"level":"instance","id":"Wael","label":"Wael"}` — a **fabricated
instance id**. `enforceKnownAssignees` passes it because the *label* matches a known assignee even
though the id matches no known id.

This is pre-existing, not a Phase 10 regression, and only reachable when the platform vocabulary is
unconfigured (local `.env.local` has no `LANDJOURNEY_*`), so `liveUsers` is empty and every known id
is `""`. In production with live vocabulary the real ids are present. Flagging it because the repo's
"never invent platform IDs" stance suggests the id path should probably reject rather than pass on a
label match. Recommend a Phase 11 ticket rather than widening this branch.

---

## 6. Files changed

| File | Change |
| --- | --- |
| `app/api/workflows/parse-ai/route.ts` | Candidate list + two prompt instruction lines + Examples 4/5 |
| `scripts/assert-ai-upgrade.ts` | New — 17 assertions |
| `scripts/assert-parse-ai.ts` | One assertion updated for the new candidate order |
| `package.json` | `assert-ai-upgrade.ts` added to `test` |
