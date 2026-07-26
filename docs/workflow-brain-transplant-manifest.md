# Workflow Brain — Landjourney transplant manifest

Status: v1 — authored by live-transplant-engineer, 2026-07-26.
Companion to `docs/workflow-brain-context-contract.md` (the boundary) and
`docs/parser-ai-backend-contract.md` (the parse endpoint). This document is the
operational checklist for moving the Brain from the standalone workspace into
the authenticated Landjourney admin console. The backend is OUTSIDE this repo;
nothing here asserts an unverified endpoint works — see the CONFIRMED/PRESUMED
table and the explicitly-unverified list.

## 1. Required host ports

The Brain composes from `BrainPorts` (packages/workflow-brain/src/ports.ts).
The admin shell must supply:

| Port | Live implementation | Notes |
|---|---|---|
| `WorkflowBrainContextProvider` | `LandjourneyBrainContextProvider` (src/app/features/workflows/data/landjourney-brain-context.adapter.ts) over a `LiveContextTransport` | the transport is the ONLY host seam; the class has zero Angular imports |
| `HostCapabilityPort` | shell-owned, fail closed | `live-vocabulary` gates ALL registry fetches; absent port = everything off |
| `BrainClock` | shell-owned `() => Date.now()` wrapper | the Brain never reads the wall clock directly |
| `BrainTelemetrySink` | shell telemetry, behind `guardedTelemetry` (observability.ts) | dimension allowlist; nothing above `public-vocabulary` may be echoed |
| `AiParseTransport` (optional) | `POST {apiBase}/workflows/parse-ai` through the real `ApiService` | per docs/parser-ai-backend-contract.md; absent = deterministic-only mode, fully functional |

## 2. Adapter wiring (exact DI override)

The standalone workspace defaults `WORKFLOW_BRAIN_CONTEXT`
(src/app/features/workflows/data/workflow-brain-context.token.ts) to the
standalone provider. The admin shell overrides the token at its composition
root — never with `if (demo)` branches in feature code:

```ts
// admin shell composition root (admin monorepo, outside this repo)
import { firstValueFrom } from 'rxjs';
import { WORKFLOW_BRAIN_CONTEXT } from '.../workflow-brain-context.token';
import { provideLandjourneyBrainContext } from '.../landjourney-brain-context.adapter';

providers: [
  {
    provide: WORKFLOW_BRAIN_CONTEXT,
    useFactory: () => {
      const api = inject(ApiService);      // the REAL admin ApiService
      const org = inject(ORGANIZATION_CONTEXT); // however the shell exposes dnsPrefix
      return provideLandjourneyBrainContext({
        transport: {
          get: <T>(service: string, path: string, _signal?: AbortSignal) =>
            firstValueFrom(api.get<T>(service, path)),
          // Wire the AbortSignal into the observable teardown when the shell's
          // HTTP layer supports it (e.g. takeUntil(fromEvent(signal, 'abort'))).
        },
        tenantKey: org.dnsPrefix,
        capabilities: inject(BRAIN_CAPABILITIES),
      });
    },
  },
]
```

Tenant switch = construct a NEW provider (the instance is per-tenant by
construction) and dispatch `context-switched`; the reducer
(packages/workflow-brain/src/brainState.ts) discards tenant memory. There is no
cross-tenant cache to clear because none can exist: fetched vocabulary lives on
the per-tenant instance, and every derived cache key includes
`tenantKey` + `vocabularyHash` (`buildCacheKey`, observability.ts).

## 3. Auth and tenant dependencies

- All HTTP goes through the admin `ApiService`: `authorization: Bearer <token>`,
  `x-organization: <dnsPrefix>`, `x-landjourney-agent: web`,
  `x-landjourney-app-type: backoffice`, `x-session-id`. Hand-rolled `fetch` is
  prohibited (src/app/shared/api.service.ts doctrine); the adapter's contract
  suite pins that no `fetch(` appears in the adapter.
- Auth NEVER enters the Brain or the adapter: no tokens, no header names, no
  credentials in this repo's code or tests. The transport closure carries them
  implicitly on the host side of the seam.
- `tenantKey` = the UI-configuration `dnsPrefix` (NOT an org UUID). It is
  opaque to the Brain — an identity/cache-partition key, nothing more.

## 4. Live data sources (CONFIRMED vs PRESUMED)

`REGISTRY_ENDPOINTS` in the adapter is the single correctable table — fix a
path there and every fetch, source record, and test fixture follows.

| Registry | Service / path | Status | Evidence |
|---|---|---|---|
| templates | `workflows /templates` | CONFIRMED | docs/2026-07-15_live-scraping-results_v3.md; docs/2026-07-14_workflow-creator-admin-integration-scan_v1.md; docs/2026-07-15_live_schema.json `endpoints`; vocabulary-chip.ts |
| forms | `documents /templates/forms` | CONFIRMED | integration scan v1 (`GET /documents/templates/forms`); vocabulary-chip.ts |
| fields | `products /fields` | CONFIRMED | vocabulary-chip.ts ("task.md-confirmed source", B2) |
| users | `iam /users` | PRESUMED | confirmed variant is org-scoped: `iam /organizations/{orgId}/users?page=0&groups=EMPLOYEES&...` (vocabulary-chip.ts), which first needs `orgId` from `iam /users/me` (CONFIRMED, scan v1) |
| retailers | `iam /retailers` | PRESUMED | confirmed variant is org-scoped: `iam /organizations/{orgId}/retailers?page=1&pageSize=1000` (vocabulary-chip.ts) |
| stages | `workflows /stages` | PRESUMED | confirmed derivation flattens `stages` from `workflows /templates` + `/templates/{id}` detail (vocabulary-chip.ts; admin-buildout manual §7); a flat listing is an assumption |
| teams | `iam /teams` | PRESUMED | no repo evidence; named in the context registry vocabulary only |
| authorities | `iam /authorities` | PRESUMED | approval-authorities feature docs describe the concept, not a live path |
| programs | `products /programs` | PRESUMED | no repo evidence; named in the context registry vocabulary only |

Corrections belong in `REGISTRY_ENDPOINTS` only — adapter logic, source
records, and the parity fixtures all key off that table. If a registry needs
the org-scoped two-step (orgId lookup, then scoped listing), implement it
inside the HOST transport behind the same `get(service, path)` seam, or extend
the table — do not fork the adapter.

## 5. Capabilities and feature flags

Fail-closed, never granted by profiles (`HostCapabilityPort`):

| Capability | Effect when present | Effect when absent |
|---|---|---|
| `live-vocabulary` | adapter fetches the registry table | NO fetch attempted; every registry EMPTY, sources record `unavailable`; snapshot stays valid |
| `parse-ai` | orchestrator may call `AiParseTransport` | deterministic parser only |
| `ghost-suggestions-ai` | reserved for the future `workflows/suggest` path | deterministic ghost only (current shipped state) |
| `consultant-ai` | reserved | deterministic consultant only |
| `simulation-data` | separate authorized data port | no simulation data — never smuggled into vocabulary snapshots |

Host feature flags ride `ContextIdentity.featureFlags` (opaque to the Brain).
`allowedActionKeys` currently mirrors the static rule-schema action keys; a
host authorization capability that narrows per-tenant authoring should replace
that list at gather time (adapter comment marks the spot).

## 6. Server routes required (outside this repo)

1. `POST {apiBase}/workflows/parse-ai` — the NORMATIVE contract is
   docs/parser-ai-backend-contract.md (authorize on bearer + x-organization,
   sanitize, structured output, allowlist enforcement, one bounded repair,
   deterministic degrade, redacted logging, per-tenant rate limit).
2. Registry GETs of §4 — confirm every PRESUMED row before rollout.
3. Future: `POST {apiBase}/workflows/suggest` for live-AI ghost autowriting
   (same trust pipeline; contract in docs/ghost-autowriting-spec.md). Until it
   exists the deterministic ghost path serves alone.
4. Unconfirmed persistence: `workflows /rules` (+ `/rules/proposals`) is the
   PRESUMED persistence resource (workflows.service.ts, README "Live mode",
   open Q1) — required for `relatedWorkflows` to become non-empty.

## 7. Configuration values

| Value | Where | Notes |
|---|---|---|
| `apiBase` | shell config | e.g. `https://api-test.landjourney.ai`; empty = mock mode in this repo |
| `token` | shell auth session | bearer; never stored in this repo |
| `organization` (dnsPrefix) | shell org context | becomes `x-organization` AND the adapter's `tenantKey` |
| capability set | shell entitlement service | at minimum `live-vocabulary` to leave demo vocabulary behind |
| server secrets | admin backend only | `CF_ACCOUNT_ID`, `CF_GATEWAY_ID`, `CF_AIG_TOKEN`, `GEMINI_API_KEY` — never client-side |

## 8. Transplant sequence

1. Vendor/import the Brain packages + adapter files into the admin monorepo
   (lead-owned sync path); keep `packages/**` untouched.
2. Confirm every PRESUMED row of §4 against the staging backend; correct
   `REGISTRY_ENDPOINTS` where reality differs.
3. Implement the `LiveContextTransport` wrap over the real `ApiService` (§2).
4. Provide the DI override of `WORKFLOW_BRAIN_CONTEXT` in the admin shell.
5. Wire `HostCapabilityPort` with `live-vocabulary` ON for a staging tenant.
6. In a staging session, run the SHARED contract suite and the parity suite
   against the REAL backend: instantiate `LandjourneyBrainContextProvider`
   with a Node-side transport carrying a staging bearer, then execute
   `runContextProviderContract("landjourney-live(staging)", ...)` and the §3
   parity fixtures of core-tests/assert-brain-transplant-parity.ts. All
   contract assertions must pass unchanged; parity fixtures must resolve
   against real registry labels (adjust fixture NAMES, never assertions).
7. Turn on `parse-ai` only after the backend passes its own contract tests
   (docs/parser-ai-backend-contract.md §examples) in staging.
8. Canary one tenant; watch telemetry (engine mode, degrade reasons, registry
   `unavailable` counts) before widening.

## 9. Rollback

Revert the single DI override so `WORKFLOW_BRAIN_CONTEXT` falls back to
`provideStandaloneBrainContext` (the token's default factory) — that is the
FULL feature rollback: zero Brain changes, zero data migrations, the composer
keeps working on the static vocabulary. Capability kill-switch is even
cheaper: dropping `live-vocabulary` empties every registry fail-closed without
redeploying (see the caveat below before relying on it as a user-facing mode).

## 10. Explicitly unverified

- Every PRESUMED path in §4 (users, teams, stages, authorities, retailers,
  programs — plus the org-scoped vs flat question for users/retailers).
- The `workflows /rules` persistence contract (README "Live mode" open Q1) —
  and therefore `relatedWorkflows` population.
- Response envelope shapes: the adapter tolerates bare arrays and
  `{items|rows|data|results|content}` wrappers with `{id,label}/{id,name}/
  {uuid,title}` rows; anything else maps to zero entries (fail closed). Real
  pagination semantics (page sizes, cursors) are NOT implemented — confirm
  whether registries page and extend the transport if so.
- API-stamped registry versions: the adapter honors `version`/`etag` when
  present, else derives a content hash. Whether the live services stamp
  versions is unverified.
- KNOWN SEAM (documented, not fixable in the adapter): rule-core's parser
  falls back to the static demo `ASSIGNEES` when `ParseOptions.assignees` is
  EMPTY (packages/rule-core/src/nlParser.ts, `opts?.assignees?.length ? … :
  ASSIGNEES`). A fully-degraded live snapshot (users registry down AND no
  teams) therefore still lets demo NAMES resolve at the parser layer, even
  though the snapshot itself contains no demo data. The parity suite pins the
  honest half (live-registry names go unresolved, snapshot carries no demo
  fallback); closing the seam needs a rule-core change (owner:
  deterministic-parser-engineer) — e.g. an explicit "no fallback" marker when
  a live profile supplies the options.
