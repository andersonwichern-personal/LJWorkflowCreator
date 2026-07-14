# Demo Bridge — Implementation Notes (Option B)

**Created:** 2026-07-14
**Author:** Claude (Coder)
**Implements:** Option B ("demo bridge") from
[`2026-07-14_workflow-creator-admin-buildout-manual_v2.md`](2026-07-14_workflow-creator-admin-buildout-manual_v2.md) §11,
and §8 step 2 of [`…admin-integration-scan_v1.md`](2026-07-14_workflow-creator-admin-integration-scan_v1.md)
("keep field/event/action vocab fetched, not hardcoded").
**Status:** Built, lint + build green, fallback path smoke-tested. Live path **blocked on
manual §12 Q2** (interceptor headers) — wired and waiting for the missing header(s).

---

## 1. What was built

The Next.js prototype keeps its UX and the **frozen v2 rule schema** (untouched), but its
pickers now sync live platform building blocks when configured, with graceful static fallback:

| Piece | File | Role |
|---|---|---|
| Server client | `lib/platform.ts` | Fetches §7 endpoints (users, retailers, `workflows/templates` + stages, forms) with env-driven bearer + org; defensive parsing since response bodies are [INFER] |
| Proxy route | `app/api/platform/vocabulary/route.ts` | `GET /api/platform/vocabulary`; token never reaches the browser; always 200 with a `source: "live" \| "static"` discriminator |
| Overlay | `lib/liveVocabulary.ts` | Merges live values onto static token option lists (live first, static kept so the representative-data simulation still matches) |
| UI wiring | `WorkflowCreator.tsx`, `RuleSentence.tsx` | Fetch-on-mount; **"● Live vocabulary" / "○ Demo vocabulary" chip** in the page header (tooltip = counts or fallback reason); condition-value + action-param pickers prefer live options |
| Config | `.env.local.example` | `LANDJOURNEY_API_BASE`, `LANDJOURNEY_API_TOKEN`, `LANDJOURNEY_ORG_ID`, `LANDJOURNEY_EXTRA_HEADERS` |

**Live → picker mapping** (only *adds option values* to existing verified tokens):

| Live source | Feeds |
|---|---|
| `iam` users (EMPLOYEES) | `team_member` field; `assign_user` + `notify` params |
| `iam` retailers | `retailer` field |
| `workflows/templates` stages | `stage` field; `change_stage` param |
| `workflows/templates` requestType | `reqtype` field |
| `documents/templates/forms` | fetched + counted only (operand binding deferred, see §3) |

## 2. Guardrails honored (manual §13)

- **No new events** — trigger vocabulary untouched (System Events is client-mocked in test).
- **No role/authority ladder** — users land as named assignees only.
- **Schema frozen** — rule JSON v2 byte-identical; no persistence change (Supabase as before).
- **No hand-rolled auth in the client** — token is server-side; the interceptor mystery is
  isolated behind `LANDJOURNEY_EXTRA_HEADERS`.

## 3. Deferred (needs §12 answers first)

- **ID-bound operands** (`{formTemplateId, fieldId}` per manual §9) — needs Q5 (`dependsOn`
  shape) + Q6 (enum casing); today's overlay is label-level by design.
- **`trigger.scope`** (bind a rule to template+stage) — needs Q1/Q3 (real event stream).
- **Form-field condition operands** — forms list is fetched; per-form field fan-fetch and a
  dynamic FIELDS group is the next increment once ID-binding lands.

## 4. How to activate the live path

1. Antigravity answers **Q2** (what the HTTP interceptor adds beyond the bearer).
2. Fill `.env.local`: base, token (from an authenticated admin session), org UUID, and the
   missing header(s) as JSON in `LANDJOURNEY_EXTRA_HEADERS`.
3. Restart. Chip flips to **● Live vocabulary**; per-section failures degrade partially
   (whatever loads is used; errors listed in the chip tooltip).

**Verified:** `npm run lint` + `npm run build` clean; `GET /api/platform/vocabulary` without
env returns `{"source":"static","reason":"platform env not configured (…)"}` and the app runs
fully static.
