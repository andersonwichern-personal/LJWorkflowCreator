# Workflow Creator — Admin Build-Out Manual (for Antigravity)

**Created:** 2026-07-14
**Author:** Anderson Wichern (live scan + synthesis by Claude via browser inspection)
**Supersedes:** `2026-07-14_workflow-creator-admin-integration-scan_v1.md` (v1 is the summary;
this v2 is the full build manual with real data contracts and a file-by-file plan).
**Target agent:** Antigravity — you will have the real Angular admin repo (BitBucket). This
document tells you everything needed to add the Workflow Creator as a first-class section of
`admin-test.landjourney.ai` and wire it to live inputs and outputs.

---

## 0. How to read this document

Everything below is split into **[OBSERVED]** (real runtime behavior I confirmed by driving
the live app on 2026-07-14) and **[INFER]** (a strong hypothesis you must confirm against
source before relying on it). I never read the product's source; I reverse-engineered the
running app (DOM component tags, network calls, routing, localStorage, the Monaco JSON
editor). Treat **[OBSERVED]** as ground truth for behavior and **[INFER]** as a to-verify.

**The mental model for this build:** a "workflow" in Landjourney today is not a separate
object — it is the **Request Template** (owned by the `workflows` service) which sequences
**stages** and composes **dynamic forms / checklists** (owned by the `documents` service).
The Workflow Creator you are building is a **new authoring surface** that produces a
**rule object** (`WHEN event → IF conditions → THEN actions`) whose operands are the *same*
building blocks (stages, form fields, retailers, products) and whose actions target the
*same* downstream surfaces (offers, underwriting, booking, notifications). "Sync with
existing inputs and outputs" = **read those building blocks live to populate the builder,
and target those real surfaces with actions** — never hardcode a parallel vocabulary.

---

## 1. Confirmed stack & conventions [OBSERVED]

| Concern | Reality |
|---|---|
| Framework | **Angular** (Zone.js; `__zone_symbol__*` globals; `<app-root ng-version>`) |
| UI kit | **Angular Material + CDK** (`mat-icon`, `cdk-live-announcer`, `cdk-describedby-message-container`) — CDK drag-drop is used in builders |
| Component prefix | **`lj-`** — `lj-shell`, `lj-main-layout`, `lj-main-sidebar-v2`, `lj-nav-link-list`, `lj-nav-link`, `lj-page`, `lj-side-panel`, `lj-avatar`, `lj-guide-panel` |
| Bundling | Hashed bundles + **lazy route chunks** (`main-*.js`, `polyfills-*.js`, `chunk-*.js` fetched on navigation) → the app uses `loadChildren`-style lazy feature modules |
| Code editor | **Monaco** (the "Edit JSON" modal is a Monaco instance) |
| Icons | Material Symbols (outlined); nav labels are icon ligatures |
| Font | Inter |
| Brand accent | Teal **`#4FC6A5`** (`rgb(79,198,165)`) = primary button color |
| Notifications | **Novu** (`api.novu.co/v1/inbox/*`) — in-app inbox already wired |
| Docs / guide | `docs.landjourney.ai/docs/manifest.json` feeds `lj-guide-panel` |
| PDF/doc render | Nutrient / PSPDFKit (`nutrient-analytics-user-id`) |
| Session replay | OpenReplay (`__openreplay_uuid`) |

**Storage envelope [OBSERVED]:** localStorage values are wrapped in a custom versioned
serializer prefixed `"$%$v02$%$:"` (this is also why the auth token has a `compressedToken`
sibling). Do **not** `JSON.parse` these directly — go through the app's storage service.

---

## 2. Shell, routing & where the page slots in [OBSERVED]

### Component tree
```
app-root
└── lj-shell
    └── lj-main-layout
        ├── lj-main-sidebar-v2          ← thin left icon rail
        │   └── lj-nav-link-list → lj-nav-link (mat-icon + label + routerLink)
        └── router-outlet
            └── lj-page                 ← per-section chrome: title, subtitle, action bar
```

### Top-level routes (nav order)
`/home` · `/requests` · `/templates` · `/intake-links` · `/customers` · `/offers` ·
`/underwriting` · `/loans` · `/booking-events` · `/root-tools` · `/system-events` ·
`/settings` (footer).

### Routing conventions
- **Editors nest under the section:** `/templates/forms/:uuid/edit`,
  `/templates/requests/:uuid/edit`. IDs are UUIDs.
- **List/tab state lives in query params, not sub-routes:** `?tab=N` (tab index) +
  `?currentPage=N` (pagination). Settings uses real sub-routes though:
  `/settings/users`, `/settings/retailers`, …

### Where the Workflow Creator goes
- **Routes:** `/workflows` (list) and `/workflows/:uuid/edit` (builder) — mirror
  `/templates/*/edit`. Lazy-load the feature module via `loadChildren`.
- **Nav:** add one `lj-nav-link` in the sidebar config, suggested position **between
  Templates and Intake Links** (it's a configuration surface). Icon ligature: `account_tree`
  or `rule`. Label: **Workflows**.
- **Chrome:** wrap pages in `lj-page` so the header/action-bar matches every other section.
- **Gate visibility** on the per-org `ui-configuration` flag (see §5).

---

## 3. API topology — the complete verified map [OBSERVED]

**Base:** `https://api-test.landjourney.ai`. Domain-partitioned services (path prefixes):

| Service | What it owns | Endpoints confirmed live (method) |
|---|---|---|
| **`/iam/`** | identity, org, users, retailers | `GET /iam/users/me` · `GET /iam/organizations/{orgId}/users?page=0&groups=EMPLOYEES&include_disabled=false&page_size=10` · `GET /iam/organizations/{orgId}/retailers?page=1&pageSize=1000` |
| **`/workflows/`** | request lifecycle + **request templates (= workflows today)** | `GET /workflows/requests/overview` · `POST /workflows/requests/search` (underwriting/queues) · `GET /workflows/templates` (request-template list) |
| **`/documents/`** | forms, files, checklists, extraction, public forms | `GET /documents/templates/forms` · `GET /documents/templates/forms/{uuid}` · `GET /documents/templates/files?templateType=FILE` · `GET /documents/external/forms?accessMode=PUBLIC_LINK&page=0&pageSize=20` |
| **`/credit/`** | core-banking / booking | `GET /credit/booking-events?page=0&page_size=20` |

**Tenant scoping [OBSERVED + INFER]:** `iam` calls carry the org UUID **in the path**
(`/iam/organizations/1577b554-df12-4dca-8430-cf307ab39389/...`). `workflows`/`documents`
calls do **not** show an org in the URL, so tenant context for those is **[INFER]** carried
by the auth token / an interceptor header. A bare `fetch` with only `Authorization: Bearer
<token>` returned **500**, confirming the interceptor adds more than the bearer. **→ Always
call through the app's existing `HttpClient` interceptor / data-access services. Never
hand-roll fetches or reconstruct auth.**

**Pagination is inconsistent across services [OBSERVED] — a real gotcha:**
- Client route lists: `?currentPage=0`
- `credit`: `?page=0&page_size=20` (snake_case, 0-indexed)
- `iam` users: `?page=0&page_size=10` (snake_case)
- `iam` retailers & `documents` external: `?page=1&pageSize=1000` / `?page=0&pageSize=20`
  (camelCase, and retailers is **1-indexed**)
→ When you add workflow endpoints, follow the **`workflows`-service** convention (confirm it),
and don't assume a global paging contract.

---

## 4. Which surfaces are REAL vs client-MOCKED [OBSERVED] — build-critical

This is the single most important thing to internalize before wiring "outputs." In the test
tenant, several surfaces render from **mock data in localStorage**, not the API:

| Surface | Data source | Real API? |
|---|---|---|
| Requests / Underwriting | `POST /workflows/requests/search`, `GET /workflows/requests/overview` | ✅ **Real** (localStorage `underwriting-data` is filter/cache state) |
| Templates (requests) | `GET /workflows/templates` | ✅ Real |
| Templates (forms/files/checklists) | `GET /documents/templates/*` | ✅ Real |
| Booking Events | `GET /credit/booking-events` | ✅ Real |
| Users / Retailers | `GET /iam/organizations/{orgId}/*` | ✅ Real |
| **System Events** | `system-events-mock-data` (localStorage) — page made **no** data API call | ❌ **Mocked** |
| **Offers** | `offers-queue-data`, `offers_data:{uuid}` (localStorage) — no data API call | ❌ **Mocked** |

**Consequences for the workflow engine:**
1. **You cannot subscribe to "System Events" as a live trigger bus** in test — it's a mock
   list. The real lifecycle signals live inside `/workflows/requests/*` and `/credit/*`.
   Confirm in source whether a real event stream/webhook exists.
2. The demo's "booking error → escalate" story must be **seeded/scripted** (already flagged in
   the foundation brief; the 16 GB local profile can't fire Fiserv/FMAC events organically).
3. Don't let the builder offer triggers/actions that only exist as mock — gate every
   aspirational token behind a "backend-confirmed-emittable" capability flag.

---

## 5. Feature-gating (`ui-configuration`) [OBSERVED key + INFER mechanism]

localStorage holds `uiConfiguration_backoffice` (inside the `$%$v02$%$` envelope). Section
visibility is per-org. **[INFER]** the nav-link list and route guards read this config to
decide what a tenant sees. **Build task:** add a `workflows`/`workflowCreator` flag to that
config schema, gate **both** the `lj-nav-link` and the route guard on it, and enable it for
the demo tenants (Growmark / FCS). Confirm the exact flag key + loader in source (likely an
`iam`/config endpoint hydrating `uiConfiguration_backoffice`).

---

## 6. The builder to clone: Dynamic Form builder [OBSERVED]

The Workflow Creator's UX bar and scaffolding already exist as the **Dynamic Form builder**
(`/templates/forms/:uuid/edit`, hydrated by `GET /documents/templates/forms/{uuid}`). Reuse
its patterns wholesale.

**Layout**
- **Left config rail:** Name; **Section Type** toggle `INLINE | STEPS | TABS`; "Display
  Review" checkbox; **Add Section**; **Import from Form** (typeahead to pull sections from an
  existing form — a reuse pattern worth copying for "import from existing workflow"); **Add
  Fields** (filterable palette).
- **Center canvas:** **CDK drag-and-drop** of sections & fields; per-field enable toggle +
  drag handle; collapsible "Hide Fields".
- **Top action bar (in `lj-page`):** **Preview**, **Edit JSON** (Monaco over the same
  model), **version history** icon, **Save**, **Delete**, **Back to list**.
- **Drafts persist in localStorage before Save** (`dynamicFormsDrafts`; siblings
  `requestDrafts`, `requestTemplatesDrafts`, `entitiesDraftState`). Save commits to the API.

### 6a. Real dynamic-form JSON schema [OBSERVED — pulled from the Monaco editor]
A form definition is an **array of sections**:
```jsonc
[
  {
    "id": "9fe9c8d2-67e3-4ae2-b0cd-b27dfd8de365",   // uuid
    "name": "New Form Section",
    "description": "",
    "layout": "ONE_COLUMN",                          // enum: ONE_COLUMN | (TWO_COLUMN?) — verify
    "direction": "COLUMN",                           // enum: COLUMN | ROW — verify
    "fields": [],
    "dependsOn": null                                // ← conditional visibility (see below)
  },
  {
    "id": "9eaa8799-39c6-46e9-b141-a107db3e9dbb",
    "name": "Information",
    "description": "section description",
    "layout": "ONE_COLUMN",
    "direction": "COLUMN",
    "fields": [
      {
        "column": 0,
        "fieldType": "INPUT",                        // see enum below
        "id": "56c15433-b33d-47b2-a843-f97b600ce384",
        "label": "Name",
        "name": "newField1",                         // stable machine key
        "parameters": { "placeholder": "", "type": "text" },
        "required": true
      },
      { "column": 0, "fieldType": "NUMBER",           "id": "…", "label": "Phone #",          "name": "newField2", "parameters": { "placeholder": "" }, "required": true },
      { "column": 0, "fieldType": "LOAN_INFORMATION", "id": "…", "label": "Loan Information",  "name": "newField3", "parameters": {}, "required": true },
      { "column": 0, "fieldType": "LIVESTOCK",        "id": "…", "label": "New field",         "name": "newField4", "parameters": {}, "required": true }
    ],
    "dependsOn": null
  }
]
```

**`dependsOn` is the platform's existing conditional-logic primitive** (section/field shows
based on another field's value). This is the closest native analog to a workflow condition —
**study its exact shape in source; your rule `conditions` should reuse the same operand
model (field id + operator + value) so the two systems speak the same language.**

**`fieldType` enum [OBSERVED from the palette — confirm exact casing in source]:**
`INPUT` (with `parameters.type`: text/…), `CHECKBOX`, `NUMBER`, `MONEY`, `SELECT`, `DATE`,
`RADIO`, `TEXT`, `NOTE`, `FILE_UPLOAD`, `REPEATABLE_CARD`, `BORROWERS`, `LOAN_INFORMATION`,
`LOAN_SOURCES`, `LOAN_PURPOSE`, `DISCLAIMER`, `YES_NO_QUESTIONNAIRE`, `CROP_DETAILS`,
`USE_OF_FUNDS`, `LIVESTOCK`, `SUBMIT_BUTTON`, `ON_SCREEN_APPROVAL`, `COMPUTED`.
→ **Fields are per-template. A rule that references a field must reference `{formTemplateId,
fieldId}`**, never a hardcoded global field name (confirms foundation brief §4).

### 6b. The current "workflow" object: Request Template [OBSERVED]
`/templates/requests/:uuid/edit`, backed by `GET /workflows/templates` (list) and
**[INFER]** `GET /workflows/templates/{uuid}` for one. It's a **4-step wizard**:
1. **Parameters** — `name`, `requestType` (`Loan Application` | `Origination` | `Covenant`),
   and an **ordered, drag-reorderable, deletable list of STAGES**
   (observed: `Application → Under Review → Approved`). **These stages are the trigger
   points a workflow rule hangs off.**
2. **Documents** — attaches forms/checklists; on load it **fan-fetches each referenced form**
   `GET /documents/templates/forms/{uuid}` (composition-by-ID).
3. **Coverage** — product / retailer / eligibility coverage.
4. **Message** — the customer-facing intake message.

**[INFER] request-template shape:**
```jsonc
{
  "id": "uuid",
  "name": "Organic Bank of America Loan Application - DO NOT EDIT",
  "requestType": "LOAN_APPLICATION",            // Loan Application | Origination | Covenant
  "stages": [ { "id": "…", "name": "Application", "order": 0 }, … ],
  "documents": [ { "formTemplateId": "uuid", … } ],
  "coverage": { /* products / retailers / eligibility */ },
  "message": "…"
}
```

---

## 7. The inputs the builder must sync (live pickers) [OBSERVED endpoints]

Populate every picker from live data — this is what "sync with existing inputs" means. The
Intake-Links screen already fetches this exact composition set, so copy its data-access:

| Builder picker | Source (verified) |
|---|---|
| Request templates & their **stages** | `GET /workflows/templates` (+ `/{id}` for stages) |
| **Dynamic forms** and their **fields** (condition operands) | `GET /documents/templates/forms` → `GET /documents/templates/forms/{id}` |
| Document **checklists / files** | `GET /documents/templates/files?templateType=FILE` (+ checklist type) |
| **Retailers** (routing/assignment) | `GET /iam/organizations/{orgId}/retailers?page=1&pageSize=1000` |
| **Users / groups** (assignment target) | `GET /iam/organizations/{orgId}/users?groups=EMPLOYEES&…` |
| **Products / Coverage** | Coverage step source (confirm endpoint; likely `workflows` or a products service) |
| **Request type** enum | `Loan Application` / `Origination` / `Covenant` |
| Public-link forms | `GET /documents/external/forms?accessMode=PUBLIC_LINK` |

---

## 8. The outputs (action sinks) [OBSERVED surfaces + verified vocab]

Map rule `actions[]` onto these real surfaces; where you show execution status, read it back
from them. Keep unconfirmed ones behind the capability flag (§4).

| Action / effect | Target surface | Verified status vocabulary |
|---|---|---|
| Make/route an **offer** | `/offers` (⚠️ mocked in test) | queues: Unassigned / Assigned / All / Rejected |
| Route to **underwriting** / set result | `/underwriting` → `POST /workflows/requests/search` | My / Unassigned / Assigned / **Auto Approved / Approved / Rejected** / All |
| Trigger **booking** to core | `/booking-events` → `GET /credit/booking-events` | Not Sent → In Flight → Sent → Confirmed / Partially Confirmed / Unconfirmed / **Error**; two dims: **Data Status** + **Processing Status**; columns: Request ID, Loan, Data Status, Processing Status, Created, Updated |
| Reflect **loan** outcome | `/loans` | Term Loans / Lines of Credit |
| **Notify** a user/team | **Novu** inbox (already wired) | in-app notification — natural first real action |
| **Assign** to user/team | `iam` users/retailers | assign to named person/team (⚠️ **no role/authority ladder exists** — do not build one) |
| Change request **stage** | `workflows` request | Initiated → Processing → Approved → Closed |
| Log an event | System Events (⚠️ **mocked**) | 6 types: `FISERV LOAN`, `FMAC LOAN`, `LOAN APPROVED`, `LOAN REJECTED`, `OFFER ACCEPTED`, `SYSTEM ERROR` |

---

## 9. The rule schema — the contract both builds honor

Keep the versioned schema already agreed in
`2026-07-13_workflow-creator-live-integration-refinements_v1.md`, but bind operands to **real
platform IDs** (per §6a/§7) so a rule authored in the builder is executable:

```jsonc
{
  "schemaVersion": 2,
  "trigger": {
    "event": "STAGE_ENTERED",                 // capability-flagged enum; see §4/§8
    "scope": { "requestTemplateId": "uuid", "stageId": "uuid" }   // bind to real stage
  },
  "conditions": {
    "logic": "AND",                            // AND | OR
    "rules": [
      { "field": { "formTemplateId": "uuid", "fieldId": "uuid" },  // real field ref (§6a)
        "op": "gte", "value": 250000 }
    ]
  },
  "actions": [
    { "type": "ASSIGN", "params": { "userId": "uuid" } },
    { "type": "NOTIFY", "params": { "channel": "novu", "template": "…" } }
  ],
  "enabled": true
}
```
- Reuse the **`dependsOn` operand model** (§6a) for `conditions.rules` so the form engine and
  the rule engine share condition semantics.
- Every `trigger.event` / `action.type` carries a **`confirmedEmittable`/capability flag**;
  the builder only surfaces confirmed ones by default.
- Persist per-tenant. **[INFER]** either a new `workflows`-service resource
  (`/workflows/rules` or `/workflows/automations`) — preferred for production — or the
  Supabase `WorkflowCreator` store as a demo side-store (see §11).

---

## 10. File-by-file build plan (Angular embed)

Verify each path against source first; names below follow observed conventions.

1. **Recon in-repo:** find the `Routes` array feeding `router-outlet` and how `/templates`
   declares its lazy child + `forms/:id/edit`; find the nav config behind `lj-main-sidebar-v2`
   / `lj-nav-link-list`; find the `HttpClient` interceptor + the `documents`/`workflows`
   data-access services; find the Dynamic Form builder module (it is your scaffold).
2. **Feature module:** `workflows/` lazy module (`loadChildren`) with routes `''` (list) and
   `':id/edit'` (builder), each page wrapped in `lj-page`.
3. **Nav + gating:** add the `lj-nav-link` (icon `account_tree`, label "Workflows"); add a
   `ui-configuration` flag; gate nav + a `CanActivate` route guard on it (§5).
4. **List page:** Templates-list idiom — columns Name / Type / Updated At, search box, row
   hover actions (duplicate / edit / delete), "Create New" primary (teal) button.
5. **Builder page:** clone the dynamic-form-builder shell — left config rail, CDK drag-drop
   canvas rendering the `WHEN/IF/THEN` rule (P3 sentence UX from the prototype), top bar with
   Preview + **Edit JSON (Monaco)** + version history + Save/Delete. Reuse the `*Drafts`
   localStorage draft pattern (through the storage service / `$%$v02$%$` envelope).
6. **Wire inputs (§7):** build data-access that reuses existing services to fill pickers
   (templates→stages, forms→fields, retailers, users, products). Bind operands to real IDs.
7. **Wire outputs (§8):** map `actions[]` to real sinks; start with **NOTIFY via Novu**
   (already wired, lowest risk) and **ASSIGN**; gate booking/offer/system-event actions
   behind the capability flag until backend emittability is confirmed.
8. **Persistence:** call the `workflows`-service rule endpoint (or Supabase side-store for
   demo). This is largely a **backend task** — a workflow engine is ~80% backend (foundation
   brief §5).
9. **NL/chat entry (optional for demo):** the prototype's `nlParser` produces the same rule
   object; keep the demo path deterministic (canned parse) before any live LLM call.
10. **Build + lint**, then hand to Gemini (Overseer) for verification against the live
    platform before merge to `main`.

---

## 11. Reconciling the standalone Next.js prototype

| | Standalone prototype | Embedded product |
|---|---|---|
| Stack | Next.js + React + Supabase + Vercel | **Angular + Material** + `api-test.landjourney.ai` |
| Where | `Sweet Coding Work` repo, branch `feature/workflow-creator-ui` | admin monorepo (BitBucket) |
| Files | `app/page.tsx`, `components/RuleSentence.tsx`, `lib/vocabulary.ts`, `lib/services/workflow.ts`, `lib/nlParser.ts` | new Angular `workflows` feature module |
| Persistence | Supabase `WorkflowCreator` (greenfield) | `workflows`-service resource **[INFER]** |
| Role | **proves UX + the rule schema** | ships to real tenants |

**Keep the schema, port the UI.** The React components are the *spec*, not source. The rule
JSON (§9) is stack-agnostic and is the shared contract. Two viable end-states:
- **A. Full embed (recommended for production):** re-implement the builder in Angular
  (RxJS + Material + CDK), persist via the `workflows` service. Real inputs/outputs.
- **B. Demo bridge (fastest to a stage demo):** keep the Next.js app, but make its vocabulary
  **fetched live** from the endpoints in §7 (through a small read proxy / the same bearer +
  tenant header the interceptor uses) so the demo shows real templates/fields/retailers.
  Persist rules in Supabase. Migrate to A after the demo.

Decide A vs B against the answer to Q1 in §12 (does a real engine/endpoint exist).

---

## 12. Open questions to resolve against source (ranked)

1. **Does the `workflows` service already expose a rules/automation resource** (persist +
   evaluate), or only request templates? Read this first — it flips the build from "hard
   engine" to "wire up existing."
2. **Exactly what does the HTTP interceptor add** beyond the bearer (tenant/org header? token
   decompression from `compressedToken`)? Required to call any endpoint (bare bearer → 500).
3. **Is there a real event stream** the engine can trigger on, or is the only "event" surface
   the mocked System Events list? Which of `doc_uploaded`, `sig_signed`, `checklist_done`,
   `stage_entered`, etc. does the backend genuinely emit?
4. **`ui-configuration` mechanism** — exact flag key, loader endpoint, and how new sections
   register into nav + guards.
5. **Exact `dependsOn` schema** (operator set, value shape) so `conditions.rules` can reuse it.
6. **Confirm the enums** — `fieldType`, `layout`, `direction`, `requestType`, stage names —
   exact casing/values in source (I inferred casing from labels).
7. **Products / Coverage endpoint** (the Coverage wizard step's data source).
8. **Persistence decision** — new `workflows` table vs Supabase side-store (§11).
9. **Growmark / FCS demo script** — which effects fire live vs must be seeded (booking/core
   can't fire on the local 16 GB profile).

---

## 13. Guardrails carried forward (do not regress)
- **No role/authority ladder exists** — Settings→Users is a flat list (with a `groups` param,
  e.g. EMPLOYEES, but no roles UI). Use "assign to named user/team," not
  `assign_authority`.
- **Event bus is thin/mocked** in test — verified event types are the 6 lifecycle types, not
  the mockup's 25. Gate everything else behind capability flags.
- **Fields/conditions are per-template**, not a global enum — always reference by ID.
- **Booking/core events can't fire locally** — seed them for any live demo.
- **Never hand-roll auth/fetch** — reuse the interceptor + data services.

---

## 14. Change log & related docs
- **2026-07-14 (v2)** — Full build manual. Added real dynamic-form JSON schema (from Monaco),
  request-template stage model, complete verified endpoint map (added `/credit/` booking and
  org-scoped `iam` users/retailers), the real-vs-mocked surface audit (System Events & Offers
  are client-mocked), pagination-convention gotchas, the `dependsOn` conditional primitive,
  ID-bound rule schema, and a file-by-file Angular plan. Supersedes v1.

**Related:**
- `2026-07-14_workflow-creator-admin-integration-scan_v1.md` — the shorter summary version.
- `2026-07-13_workflow-creator-foundation-brief.md` — decision (P1+P3), verified vocabulary.
- `2026-07-13_workflow-creator-live-integration-refinements_v1.md` — v2 rule-JSON schema.
- `2026-07-14_production-merge-readiness-plan_v1.md` — merge readiness.
