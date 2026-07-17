# Workflow Creator — Angular application

The native admin-console rebuild of the Workflow Creator. The **transplant unit**
is `src/app/features/workflows/` — it is structured to lift into the admin
monorepo's route/nav registration exactly as the integration scan prescribes.

## Run

```bash
npm install
npm start        # http://localhost:4200/workflows — mock backend, zero config
npm test         # rule-core regressions plus purity and sync gates
npm run build    # production build
```

## Layout

| Path | Role |
|---|---|
| `src/app/core/` | **Generated vendored rule core**, synced from `packages/rule-core`. Framework-free. |
| `core-tests/` | Rule-core regression suites and Angular seam coverage. |
| `src/app/shared/` | `ApiService` (production header contract: `authorization`, `x-landjourney-agent`, `x-session-id`, `x-landjourney-app-type`, `x-organization`), `CacheService` (draft contract), `lj-*` primitive stand-ins (same selectors as the admin shell). |
| `src/app/features/workflows/` | **The transplant unit.** Lazy routes (`''` list, `':id/edit'` builder), data seam (`WorkflowsService` → mock or API), builder UI (WHEN/IF/THEN sentence, token pickers, controls, validation, plain-English drafting via the core parser, JSON editor, 2s draft autosave). |
| `src/app/app.*` | **Dev harness only** — fake icon rail + always-allow guard. Dies at transplant. |

## Live mode

The mock backend serves by default. To point at `api-test.landjourney.ai`,
provide `APP_CONFIG` at bootstrap with `apiBase`, `token` (admin session
bearer), and `organization` (the UI-configuration `dnsPrefix`, NOT an org
UUID). The presumed `/workflows/rules` resource must be confirmed against the
backend first (open Q1 in the scan) — until then live mode is untested.
