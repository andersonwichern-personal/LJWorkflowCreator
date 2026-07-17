# Conversational Composer — Roadmap (v1)

Date: 2026-07-17 · Author: Anderson (directive, recorded verbatim by Claude)
Status: **AUTHORITATIVE — supersedes the B1–B6 build-out sequencing.**
B1/B2 are landed (main `16003ed`); B3–B6 are PAUSED in favor of this roadmap.

## Architecture principle

Preserve **When → If → Then → Otherwise** as the canonical backend model while
replacing it in the client experience with a conversational,
verification-driven workflow.

North-star: Describe intent → Answer focused questions → Review the
interpretation → Try it against real examples → Activate.

Behind the scenes: Natural language → Parser → Logical rule → Validation →
Simulation → Runtime. The logical rule remains structured and deterministic;
the client simply doesn't construct it manually.

## Phases

### Phase 1 — Canonical rule contract
Backend rule is the source of truth. Schema explicitly represents: trigger
events, nested condition logic, matched/unmatched actions, entity references,
operational policies, schema version, parser provenance + confidence.
Separate parsing metadata: original description, detected clauses, component
per clause, unresolved clauses, ambiguous entities, unsupported instructions,
overall semantic coverage. **An incomplete rule must never be treated as a
successful parse.**

Acceptance: the $250,000 walkthrough condition cannot be silently dropped ·
"Otherwise, do nothing" is an intentional no-op · "Underwriting Team" resolves
or is flagged · "No lint issues" cannot appear while unresolved clauses
remain · unsupported instructions block activation.

### Phase 2 — Parser + validation pipeline
Clause identification → classification (event / requirement / outcome /
exception / operational) → canonical rule → entity resolution → compare back
to description → report anything unrepresented. Statuses: Understood · Needs
confirmation · Unsupported · Contradictory · Missing required information.
Confidence alone never publishes. Quality gates: every material clause
represented, every required parameter valued, every entity resolved, valid
structure, actions available to the client, org-policy compliant.

### Phase 3 — AI-first composer page
Description field + example prompts + "Build workflow". After parsing: a
plain-language interpretation + a short checklist. No "When/If/Then",
condition groups, operators, or JSON in the client path. Edits happen through
conversation; each revision regenerates the canonical rule, validates, and
re-presents.

### Phase 4 — Clarification loop
One or two targeted questions at a time, suggested answers + free text. After
each answer: update rule, re-run coverage, show revised interpretation, clear
the resolved warning. While clarification is pending, the partial rule is NOT
editable — labeled "Draft interpretation — needs N answers". Simulation/
activation stay disabled if the missing answer could materially change
behavior.

### Phase 5 — Explained simulation
Auto-run the completed rule against representative requests. Summary (tested /
would run / skipped / could not evaluate) + per-request plain-language
explanations sourced from the deterministic evaluation trace — never invented
by an AI. Filters by outcome; totals always from the current rule version;
changing the description invalidates old results.

### Phase 6 — Safety controls become org policy
Remove Shadow/Armed, once-per-request, max-fires, missing-data strategy, and
priority from the client page; replace with a read-only "Protections applied"
section. Backend applies them from org policy + risk classification.
Admins get a separate audited policy console.

### Phase 7 — Controlled activation
States: Draft → Needs clarification → Ready to test → Ready to activate →
Observing → Active → Paused. Final review shows plain-language workflow,
resolved entities, simulation results, protections, approval requirement.
Primary action "Start in observation mode"; the client never sees "shadow".

### Phase 8 — Role-gate technical tooling
Visual builder + JSON stay for internal roles only (client author / client
approver / internal operator / platform administrator). JSON read-only for
most; direct JSON application restricted and audited.

## Delivery sequence

| Release | Outcome |
|---|---|
| **MVP 1** | Semantic-coverage validation + activation blocking |
| MVP 2 | AI composer with read-only interpretation |
| MVP 3 | Clarification questions + conversational revisions |
| MVP 4 | Explained simulation results |
| MVP 5 | Centralized protections + observation-mode activation |
| Later | Admin tooling, analytics, conflict detection, parser learning |

> The critical first release is not the visual redesign. It is preventing
> partial parser output from being presented as a valid workflow.

## MVP 1 implementation notes (Claude, 2026-07-17)

Existing assets: `nlParser.ParseResult` already carries the sidecar
(`unresolved`, `uncovered`, `ambiguities`); chat-draft renders it but emits
only the bare rule — the builder forgets the gaps. MVP 1 therefore:
1. `packages/rule-core/src/parseGate.ts` — deterministic gate: sidecar →
   RuleIssues (UNCOVERED_CLAUSE / UNRESOLVED_ENTITY / AMBIGUOUS_CLAUSE, all
   blocking) + semantic coverage + readyToSimulate/readyToActivate.
2. Parser: recognize "otherwise, do nothing" (and variants) as an intentional
   no-op — consumed, noted, never `uncovered`, no empty `else` lane.
3. Builder carries parse provenance; parse-gap issues compose with lint into
   the same panel + save gate. Provenance clears when the user manually edits
   the rule (the description is no longer the source of truth for it).
