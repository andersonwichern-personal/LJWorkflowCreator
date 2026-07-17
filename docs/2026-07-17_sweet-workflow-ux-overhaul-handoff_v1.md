# Sweet Workflow UX Overhaul — Architect Handoff

Date: 2026-07-17  
Owner: Codex, acting as Head of UX with Anderson's authorization  
Repository: `Sweet Coding Work`  
Worktree: `main` at `fc3f5b7`; changes are intentionally uncommitted and unpushed  
Status: implementation and local verification complete; Architect approval pending

## Outcome

The Angular workflow application has been redesigned as a cohesive Sweet product rather than a
technical rule builder. The primary path is now plain-language creation, clarification, review,
explained testing, and observation. Structured definitions remain deterministic, but their JSON,
policies, and technical controls are excluded from the client path and fail closed behind a
host-provided Internal tools permission and audit seam.

## Experience delivered

- A minimal, responsive Sweet shell using the supplied positive wordmark and a centralized token
  system for color, type, spacing, radius, shadow, focus, and motion.
- An exact 61-circle Sweet spiral reconstructed from the supplied brand SVG. It responds to pointer
  position and typing energy and has explicit reduced-motion and coarse-pointer modes.
- An open-canvas composer with a real labeled textarea, Enter to submit, Shift+Enter for a newline,
  deterministic Submitted/Parsing/Clarification/Understood/Error states, and no fabricated wait.
- A strict interpretation gate: partial or stale parses cannot be observed or saved; confirmed
  suggestions resolve uncertainty without guessing.
- Conversational refinement, plain-language interpretation, explained representative-request
  simulation, visible safeguards, and observation-first lifecycle language.
- A calm editorial workflow index with purpose, lifecycle status, recent activity, attention state,
  responsive controls, loading/empty/error states, and designed confirmations.
- A client-facing detail route that explains exactly what a workflow does, how it behaves, and which
  protections apply without exposing the internal grammar.
- A pending-first Reviews queue with explicit live-activation language, safe approve/decline
  confirmations, and race-safe comparison loading.
- An internal workspace that preserves parser provenance through edits and autosaved drafts, reports
  paused armed workflows correctly, and keeps technical definition/JSON/policies collapsed.

## Safety and correctness changes

- Text edits invalidate old parser results, cancel queued work, and require an exact reparse before
  observation or save.
- Submitted and Parsing states now render in separate Angular frames before synchronous parsing.
- `lj-button` reflects disabled state to the native button and assistive technology.
- List/detail activation validates the armed candidate before confirmation and again before write.
- Reviews identify a `shadow` to `armed` proposal as **Activate live actions**, even when the service
  does not set `proposedEnabled`.
- Conversational substitution resolves people, teams, stages, and authorities through confirmed
  vocabulary; unknown recipients are rejected. The last primary action cannot be removed.
- Parsed sidecar gaps survive manual/policy edits and draft persistence instead of being discarded.
- Otherwise actions are counted and explained as real runs when the evaluator dispatches them.
- Internal editing defaults to denied. `WORKFLOW_ACCESS_POLICY` must be supplied by the authenticated
  host, and access/write attempts must reach its durable audit writer or the operation is blocked.

## Verification evidence

### Automated

- `npm run test` — passed.
  - Parser, normalization, validation, tree, multi-action, NLP, operator, customer, scope, and
    four-eyes/angular-seam suites passed.
  - 28 Sweet UX contract assertions passed.
  - 8 conversational-revision and alternate-path simulation assertions passed.
  - Rule-core purity passed across 17 files.
  - Generated Angular core sync passed across 16 files.
- `npm run build` — passed cleanly with no warnings.
  - Initial bundle: 298.95 kB raw / 84.34 kB estimated transfer before the final no-op scroll trim.
- `git diff --check` — passed during the integrated audit and will be rerun at handoff close.

### Browser QA

- No horizontal overflow at 1440, 1024, 768, or 390 px on the composer and workflow list.
- No horizontal overflow at 390 px on workflow detail, Reviews, or the internal workspace.
- Shift+Enter produced `Line one\nLine two` without submission.
- A partial parse displayed one clarification, marked the unresolved interpretation, and kept
  **Start observing** natively disabled.
- The default direct `/workflows/:id/edit` attempt redirected to `/workflows`, proving the Internal
  tools policy fails closed without a host grant.
- Current list, composer, detail, Reviews, clarification, and mobile states were captured from the
  running application and stored as real PNG files under `public/qa/`.

## Architect review targets

1. Approve the client-first information architecture and observation-first lifecycle language.
2. Approve the fail-closed `WORKFLOW_ACCESS_POLICY` contract and wire it to the admin shell's real
   role/permission source and durable audit log before enabling Internal tools.
3. Confirm that the component-style budget calibration (`8 kB` warning / `10 kB` error) is acceptable;
   the overall application bundle budget is unchanged.
4. Review shared-core changes in `revisions.ts` and `simulationExplainer.ts` together with their
   generated Angular copies and new runtime assertions.
5. After approval, authorize an intentional commit and push to `main`. No commit or push is part of
   this handoff step.

## Known host-dependent follow-ups

- Live API/authenticated-tenant behavior was not exercised because no production credentials were
  placed in scope. The existing `ApiService` and `x-organization` seam is unchanged.
- The standalone app cannot infer real roles. Internal tools remain unavailable until the admin host
  provides `WORKFLOW_ACCESS_POLICY`; this is deliberate fail-closed behavior.
- Browser verification is manual plus deterministic source/runtime assertions. The repository still
  has no Angular component-test or end-to-end test harness; adding one can be a separate Architect-
  approved tranche.

## Visual evidence

- `public/qa/2026-07-17_sweet-composer-desktop_v1.png`
- `public/qa/2026-07-17_sweet-composer-mobile_v1.png`
- `public/qa/2026-07-17_sweet-clarification-desktop_v1.png`
- `public/qa/2026-07-17_sweet-workflows-desktop_v1.png`
- `public/qa/2026-07-17_sweet-workflow-detail-desktop_v1.png`
- `public/qa/2026-07-17_sweet-reviews-desktop_v1.png`

## Handoff rule

Architect review comes next. Do not commit, push, merge, or deploy these changes until Anderson and
the Architect explicitly approve the diff.
