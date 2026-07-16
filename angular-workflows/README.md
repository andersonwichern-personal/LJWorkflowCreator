# Workflow Creator — Angular track

The native admin-console rebuild of the Workflow Creator (two-track doctrine:
`../docs/agent/task.md`). The **transplant unit** is `src/app/features/workflows/`
— it is structured to lift into the admin monorepo's route/nav registration
exactly as the 2026-07-16 integration scan prescribes.

## Run

```bash
npm install
npm start        # http://localhost:4200/workflows — mock backend, zero config
npm test         # 149 rule-core assertions (ported Vercel-track suites)
npm run build    # production build
```

## Layout

| Path | Role |
|---|---|
| `src/app/core/` | **Shared rule core**, ported VERBATIM from the Vercel track (`lib/*.ts`). The contract between tracks — semantic changes must land on both. Framework-free. |
| `core-tests/` | The Vercel track's assertion suites, re-pointed at the ported core. Drift guard. |
| `src/app/shared/` | `ApiService` (production header contract: `authorization`, `x-landjourney-agent`, `x-session-id`, `x-landjourney-app-type`, `x-organization`), `CacheService` (draft contract), `lj-*` primitive stand-ins (same selectors as the admin shell). |
| `src/app/features/workflows/` | **The transplant unit.** Lazy routes (`''` list, `':id/edit'` builder), data seam (`WorkflowsService` → mock or API), builder UI (WHEN/IF/THEN sentence, token pickers, controls, validation, plain-English drafting via the core parser, JSON editor, 2s draft autosave). |
| `src/app/app.*` | **Dev harness only** — fake icon rail + always-allow guard. Dies at transplant. |

## Live mode

The mock backend serves by default. To point at `api-test.landjourney.ai`,
provide `APP_CONFIG` at bootstrap with `apiBase`, `token` (admin session
bearer), and `organization` (the UI-configuration `dnsPrefix`, NOT an org
UUID). The presumed `/workflows/rules` resource must be confirmed against the
backend first (open Q1 in the scan) — until then live mode is untested.

## What is deliberately NOT here yet

Simulator/backtest, proposals (four-eyes), authorities, analytics, audit log,
live vocabulary sync, ScopeRef authoring, form-field (ff:) operands, Monaco.
These exist on the Vercel track; port order is a product call.
