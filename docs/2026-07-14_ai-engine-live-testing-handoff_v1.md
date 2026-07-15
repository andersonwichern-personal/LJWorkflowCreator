# Handoff: AI Engine live testing — pick up here (paused 2026-07-14 evening)

**For:** Claude (Coder), next session
**Branch:** `feature/ai-engine-upgrade` — commit `96509d8` is pushed; the working tree has
**one uncommitted, mid-flight edit that currently breaks the build** (details in §2).
**User's standing instruction:** run the live Gemini accuracy tests, then **open the PR for review**.

---

## 1. Where things stand

| Item | State |
|---|---|
| AI engine implementation | ✅ Complete + committed (`96509d8`): dynamic Gemini fetch w/ vocab+live context, JSON mode, validate/normalize of LLM rules, graceful heuristic degrade, heuristic parity (live parse options server-side), ChatBox chips append + engine badges. 7/7 suites, build, lint were green at that commit. |
| `GEMINI_API_KEY` | ✅ User added to `.env.local` (never print/commit it). |
| Live sanity test | ❌ First live call fell back to heuristic — see §3 discovery log. |
| Model fix | ⏸ **In progress, tree broken** — see §2. |
| Live accuracy battery | ⏳ Not run yet — planned cases in §4. |
| PR | ⏳ Not opened yet — see §5. |
| Dev server | Stopped. `?? scripts/assert-requirement.ts` is an untracked stray (another agent's Phase 3 work — leave it alone). |

`origin/main` = `c54a15b` and now contains Phase 2 (`1fb512f`) + the AI stub (`e8826da`);
this branch is exactly **1 commit ahead of main**, so `gh pr create --base main` will show
only the AI-engine diff.

## 2. ⚠️ FIRST TASK: finish the model-fallback edit (tree currently does not compile)

`app/api/workflows/parse-ai/route.ts` — I replaced the constants block with:

```ts
const GEMINI_MODELS = [ (env GEMINI_MODEL if set), "gemini-flash-latest", "gemini-3-flash-preview" ];
const GEMINI_TIMEOUT_MS = 30_000;
```

but was interrupted **before updating `callGemini`**, which still references the old
`GEMINI_MODEL` at ~line 139 → `tsc` error `TS2552`. To finish:

1. Rework `callGemini` to accept a model name (or loop internally): try `GEMINI_MODELS`
   in order, **falling through to the next model only on a model-level 404** (the
   "no longer available" case); any other error propagates to the existing
   heuristic-degrade catch in `POST`.
2. Dedupe the list (env value may equal a default).
3. `npx tsc --noEmit` → 0, then `npm run test && npm run build && npm run lint`.

## 3. Discovery log (why the change was needed — don't re-litigate)

- Spec hardcodes `gemini-2.5-flash`; live call returns **404 "no longer available to new
  users"** — even though ListModels still lists it. The key otherwise works.
- `gemini-flash-latest` (alias) **works** — HTTP 200, `modelVersion: gemini-3.5-flash`.
- Measured **12.3s** on a trivial prompt vs the old **12s timeout** → timeout raised to 30s.
  If battery latency is consistently bad, consider `gemini-3.1-flash-lite` (also available
  to this key) as the default instead — test before switching.
- Useful checks (redact the key in any output):
  `GET https://generativelanguage.googleapis.com/v1beta/models?key=…&pageSize=50`

## 4. Then: run the live accuracy battery

Start `npm run dev` (loads `.env.local`), confirm `engine:"gemini"` on a sanity call, then
POST each case to `/api/workflows/parse-ai` and grade. Planned cases:

| # | Instruction | Expect |
|---|---|---|
| 1 | "If there is a system error and booking status is Error, assign to Wael" | SYSTEM ERROR · bookstatus=Error · assign_user Wael |
| 2 | "When a loan is approved and loan amount is at least 250k, assign to Underwriting Team" | LOAN APPROVED · loan_amount gte 250000 |
| 3 | "When a loan over $500,000 is approved or rejected, escalate to the credit committee and add tag jumbo" | **multi-trigger** [APPROVED, REJECTED] · gt 500000 · assign_authority + add_tag (heuristic can't do this — the LLM value-add case) |
| 4 | "When a Fiserv loan booking fails, notify the booking team, otherwise tag it clean" | FISERV LOAN/bookstatus Error · notify · **else** add_tag clean |
| 5 | "When a loan is approved for business customers, notify Sara" | category ScopeRef {level:category, Business} |
| 6 | "When a loan is approved, assign to Santa Claus" | **no fabrication** — unresolved slot or suggestion |
| 7 | "When a document is approved, notify sara" | ambiguity question OR gated DOCUMENT APPROVED (observe + report) |
| 8 | "Arm this rule: when risk grade is worse than C on an approved loan, assign to Wael and cap at 10 fires per hour" | controls: mode armed · maxFiresPerHour 10 · risk_grade worse_than C |

Grade each: `engine === "gemini"`, rule non-null (server already validates), semantic
expectations above, suggestions ≤ 3, notes personable, latency. **LLM output is
non-deterministic — report observed accuracy honestly, don't cherry-pick.** Delete any
test workflows if you save any (battery shouldn't need to).

## 5. Finally: commit + open the PR

- Commit the model-fallback fix (+ mention measured latency + battery results).
- `gh pr create --base main --head feature/ai-engine-upgrade` — body should cover: what
  the engine does (context-aware parse, validate-not-trust, degrade path), the model-rot
  fix (alias default + env override + 404 fallback chain), heuristic-parity note, and the
  **accuracy battery scorecard**. Ask Gemini/Antigravity to review prompt-injection
  surface (vocab snapshot embeds live tenant data into the prompt) and the suggestions UX.
- Permission note: `gh pr create` works with `--body-file` (inline heredoc bodies were
  blocked by the permission classifier in past sessions).

## 6. Session conventions (carry over)

- Multi-agent setup: Claude codes; **Gemini/Antigravity reviews + merges** (it has merged
  everything through Phase 2 + stub onto main already). Branch-per-feature, PR as review
  surface, never merge to main yourself.
- All work green-gated: `npm run test && npm run build && npm run lint` + runtime E2E
  before commit. Never commit `.env.local`, `tsconfig.tsbuildinfo`, `.vscode/`, `scratch/`.
