# AI Engine — live Gemini accuracy results (2026-07-15)

**Tested:** `POST /api/workflows/parse-ai` with a real `GEMINI_API_KEY`, deterministic
8-case battery, graded by scripted JSON assertions (no human judgment in scoring).
**Code under test:** the live-hardening fixes squashed into `5a2fc13`
(model candidate chain, `massageGeminiRule` shape tolerance, `enforceKnownAssignees`
server-side N1, prompt example + explicit-arm rule).

## Final scorecard — 21/21 checks · engine=gemini 8/8 · latency median 1.6s, max 2.3s

| # | Case (instruction essence) | Checks | Result |
|---|---|---|---|
| 1 | System error + booking status Error → assign Wael | trigger, condition, action | ✓✓✓ |
| 2 | Approved + amount **at least 250k** → Underwriting Team | trigger, `gte 250000`, assignee | ✓✓✓ |
| 3 | **Approved OR rejected** over $500k → escalate + tag `jumbo` | both triggers, `gt 500000`, both actions | ✓✓✓ — *multi-trigger is inexpressible in the heuristic parser; this is the LLM value-add* |
| 4 | Fiserv booking fails → notify Booking Team, **otherwise** tag `clean` | trigger, error cond, notify, else-lane | ✓✓✓✓ |
| 5 | Approved **for business customers** → notify Sara | category `ScopeRef {Business}`, notify | ✓✓ |
| 6 | Assign to **Santa Claus** | not silently accepted; surfaced for a human pick | ✓✓ |
| 7 | "Document is approved" (ambiguous vs loan approval) | no silent LOAN APPROVED guess | ✓ |
| 8 | **"Arm this rule"** + worse-than-C grade + cap 10 fires/hour | `mode:armed`, `maxFiresPerHour:10`, `worse_than C` | ✓✓✓ |

Suggestions were returned on every case (≤3, clickable refinements — e.g. *"Arm this
rule?"*, *"Add a 'high-risk' tag?"*).

## Degraded-availability run (same battery, earlier in the day)

Google's flash tier was intermittently failing (`gemini-flash-latest` 503 "high
demand"; preview model slow). Observed guarantees held:
- **Every request returned a valid drafted v3 rule** — the heuristic fallback engaged
  with the explanatory note; zero user-facing errors.
- Heuristic-expressible cases still passed (13/21 checks — the misses were multi-trigger,
  else-lane, and controls cases the deterministic parser cannot express by design).

## Defects found live → fixed in `5a2fc13`

1. Spec-pinned `gemini-2.5-flash` **404s** ("no longer available to new users") →
   candidate chain w/ env `GEMINI_MODEL` override; fallthrough on model-level 404/429/503.
2. LLM mirrors the vocabulary snapshot's `key` naming into the rule
   (`triggers:[{key}]`, `actions:[{key,value}]`, lowercase logic) → boundary massage +
   exact-shape prompt example.
3. **"Santa Claus" fabrication** despite prompt instructions → `enforceKnownAssignees`
   (code-level reject-don't-coerce; unknown names become UnresolvedSlots with fuzzy
   suggestions).
4. Explicit *"arm this rule"* ignored → prompt rule added; verified (case 8).

## Open questions for review
- Candidate list ordering after the `gemini-3.1-flash-lite` prioritization (merged in
  `5a2fc13`) — re-verified working, engine=gemini at ~1.9s.
- Prompt-injection surface: live tenant data (user/template/form-field names) is embedded
  in the system prompt — recommend a sanitization pass before GA.
