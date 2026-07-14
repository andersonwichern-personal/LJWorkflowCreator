# Workflow Creator → Admin Integration Scan (for Antigravity)

**Created:** 2026-07-14
**Author:** Anderson Wichern (scan performed by Claude via live browser inspection)
**Target agent:** Antigravity (will have the real Angular admin repo)
**Status:** Live-scan findings + integration plan. Resolves most of the "pending BitBucket
access" open questions from `2026-07-13_workflow-creator-foundation-brief.md`.

> **How this was produced:** I logged into the live admin console
> (`admin-test.landjourney.ai`, tenant "Organic Bank of America") as Anderson and
> reverse-engineered the running app — DOM, component tags, network calls, routing, and
> localStorage. **Nothing here was read from source.** Every "observed" fact is real
> runtime behavior; every "inferred" fact is a hypothesis Antigravity must confirm against
> the actual codebase before building on it.

---

## 0. TL;DR — the recommendation

The admin console is a **single Angular + Angular Material app**, not React/Next. The
Workflow Creator should ship as a **new lazy-loaded Angular feature module** at route
`/workflows`, with a nav entry in the existing sidebar, gated by the per-org
`ui-configuration` feature flags. It should **mirror the existing Dynamic Form builder**
(the closest existing analog: a CDK drag-drop builder with a JSON editor, preview, version
history, and localStorage drafts).

The **existing Next.js standalone app** (`Sweet Coding Work`, branch
`feature/workflow-creator-ui`) is the right place to keep prototyping UX and to prove the
rule-JSON schema, but it is **not** the same stack as the product. Plan for a **port**, not
a drop-in. See §8 for the reconciliation.

"Sync with existing inputs and outputs" = read the workflow building blocks from the
`documents` + `workflows` services (forms, fields, checklists, stages, retailers, products)
and observe the downstream lifecycle from the `workflows`/offers/underwriting/booking/system-events
surfaces + Novu. See §6 and §7 for exact endpoints.

---

## 1. Confirmed tech stack (observed)

| Layer | Finding | Evidence |
|---|---|---|
| **Framework** | **Angular** (Zone.js change detection) | `__zone_symbol__*` globals; `<app-root ng-version=…>` |
| **UI kit** | **Angular Material + CDK** | `cdk-live-announcer`, `cdk-describedby-message-container`, `mat-icon` tags |
| **Component prefix** | **`lj-`** (Landjourney) | `lj-shell`, `lj-main-layout`, `lj-main-sidebar-v2`, `lj-page`, `lj-nav-link`, `lj-avatar`, `lj-side-panel` |
| **Bundling** | ESBuild-style hashed bundles + **lazy route chunks** | `main-S4ZQOSX3.js`, `polyfills-*.js`, `styles-*.css`, on-nav `chunk-*.js` |
| **Icons** | Material Symbols (outlined) | `material-symbols-outlined` woff2; nav labels prefixed with icon ligatures (`home`, `source`, `edit_note`, `link`, `people`, `assessment`, `fact_check`, `folder`, `event_note`, `build`, `history_2`, `settings`) |
| **Font** | Inter | `inter-latin-*.woff2` |
| **Brand accent** | Teal **`#4FC6A5`** (`rgb(79,198,165)`) — primary buttons (Save/Next) | computed style on primary buttons |
| **Notifications** | **Novu** (`api.novu.co/v1/inbox/*`) | in-app inbox/session/notifications calls |
| **Doc rendering** | **Nutrient / PSPDFKit** | `nutrient-analytics-user-id` in localStorage |
| **Session replay** | **OpenReplay** | `__openreplay_uuid` in localStorage |
| **Support chat** | web2chat widget | `widget.web2chat.ai` script |

**Implication:** the standalone Next.js prototype and the product share **no runtime stack**.
Any code that ships inside the admin is Angular/TS + Material + RxJS. The Next.js React
components (`app/page.tsx`, `components/RuleSentence.tsx`, etc.) are **spec, not source**
for the embedded build.

---

## 2. App shell & layout structure (observed)

Component tree at the root:

```
app-root
└── lj-shell
    └── lj-main-layout
        ├── lj-main-sidebar-v2          ← thin icon rail (left)
        │   └── lj-nav-link-list
        │       └── lj-nav-link (mat-icon + label, routerLink)
        └── router-outlet               ← page content
            └── lj-page                 ← per-feature page wrapper (title + actions + body)
```

Cross-cutting components also present: `lj-guide-toggle-button` / `lj-guide-panel` (contextual
help), `lj-side-panel`, `lj-accept-conditions`, `lj-maintenance-notices`, `lj-cookie-banner`,
`lj-avatar`.

**To add the Workflow Creator you touch three shell-level things:**
1. A new **route** feeding `router-outlet` (lazy module).
2. A new **`lj-nav-link`** entry in `lj-main-sidebar-v2` / its nav-link-list config.
3. A **`lj-page`**-wrapped feature page so it matches the title/action-bar chrome of every
   other section.

---

## 3. Routing & nav (observed)

Top-level routes (from the live sidebar `routerLink`s), in nav order:

| Order | Label | Route | Icon ligature |
|---|---|---|---|
| 1 | Home | `/home` | `home` |
| 2 | Requests | `/requests` | `source` |
| 3 | Templates | `/templates` | `edit_note` |
| 4 | Intake Links | `/intake-links` | `link` |
| 5 | Customers | `/customers` | `people` |
| 6 | Offers | `/offers` | `assessment` |
| 7 | Underwriting | `/underwriting` | `fact_check` |
| 8 | Loans | `/loans` | `folder` |
| 9 | Booking Events | `/booking-events` | `event_note` |
| 10 | Root Tools | `/root-tools` | `build` |
| 11 | System Events | `/system-events` | `history_2` |
| — | Settings | `/settings` | `settings` (footer) |

**Routing conventions observed:**
- Detail/editor routes nest under the section: `/templates/forms/:uuid/edit`,
  `/templates/requests/:uuid/edit`. IDs are UUIDs.
- List state lives in **query params**, not sub-routes: `?tab=N` (tab index) and
  `?currentPage=N` (pagination). Example: `/templates?tab=2&currentPage=0`.

**Recommended placement for the Workflow Creator:**
- Route: **`/workflows`** (list) + **`/workflows/:uuid/edit`** (builder), matching the
  `templates/*/edit` pattern.
- Nav: insert an `lj-nav-link` — suggest between **Templates** and **Intake Links** (it is a
  configuration surface), icon ligature suggestion `account_tree` or `rule`.
- **Feature-gate it** via the per-org `ui-configuration` (see §5) so it only appears for the
  demo tenants (Growmark / FCS), consistent with how the product gates sections today.

---

## 4. API topology & auth (observed)

**Base:** `https://api-test.landjourney.ai`. The API is **domain-partitioned** (path-prefixed
microservices), not a single monolith route tree:

| Service prefix | Purpose | Endpoints seen live |
|---|---|---|
| **`/iam/`** | identity / current user / org | `GET /iam/users/me` |
| **`/workflows/`** | **request lifecycle + request templates (the "workflow" today)** | `GET /workflows/requests/overview`, `GET /workflows/templates` |
| **`/documents/`** | building blocks: forms, files, checklists, extraction | `GET /documents/templates/forms`, `GET /documents/templates/forms/:uuid`, `GET /documents/templates/files?templateType=FILE` |

Third-party planes: **Novu** (`api.novu.co`) for notifications, **docs.landjourney.ai** for
in-app guide content.

**Auth (observed):** bearer token in `localStorage` (`token`, plus a `compressedToken`).
A direct `fetch` with just `Authorization: Bearer <token>` returned **500**, so the app's
**HTTP interceptor adds more than the bearer** — almost certainly an **org/tenant header**
(and possibly a decompressed token). Antigravity: reuse the existing `HttpClient` interceptor
/ auth service rather than hand-rolling fetches. Do **not** replicate auth manually.

> **Key architectural takeaway:** a "workflow" as it exists today is owned by the
> **`workflows`** service and *composes* building blocks owned by the **`documents`**
> service. A new Workflow Creator belongs in the `workflows` domain and should reference
> `documents` artifacts by ID — exactly the existing composition pattern (§6).

---

## 5. Feature-gating (inferred, high-confidence)

`localStorage` holds `uiConfiguration_backoffice`, and the foundation brief already noted
per-org `ui-configuration` feature-gating. The nav and section visibility are almost
certainly driven by this config. **Antigravity must add a Workflow Creator flag to that
config schema** and gate both the route guard and the nav-link on it, or the page won't
appear for the intended tenants. Confirm the exact flag mechanism in source.

---

## 6. The builder to mirror + how "inputs" work (observed)

### 6a. The Dynamic Form builder = the pattern to copy
Route `/templates/forms/:uuid/edit`, loaded via `GET /documents/templates/forms/:uuid`.
Observed capabilities (this is the UX bar the Workflow Creator should meet):

- **Left config rail:** Name, **Section Type** toggle (`INLINE` / `STEPS` / `TABS`),
  "Display Review" checkbox, **Add Section**, **Import from Form** (search existing forms and
  pull their sections — reuse pattern), **Add Fields** (filterable palette).
- **Center canvas:** **CDK drag-and-drop** sections & fields, per-field enable toggles + drag
  handles, collapsible "Hide Fields".
- **Top bar:** **Preview Form**, **Edit JSON** (raw JSON editor over the same model),
  **version history** icon, **Save**, **Delete**, **Back to list**.
- **Drafts persist in `localStorage`** (`dynamicFormsDrafts`; siblings: `requestDrafts`,
  `entitiesDraftState`) before Save commits to the API.

**Field palette observed (the real, domain-specific input vocabulary):** Input, Checkbox,
Number, Money, Select, Date, Radio, Text, Note, File Upload, Repeatable card, **Borrowers**,
**Loan Information**, **Loan Sources**, **Loan Purpose**, Disclaimer, **Yes/No Questionnaire**,
**Crop Details**, **Use Of Funds**, **Livestock**, Submit Button, **On Screen Approval**,
**Computed**. → Field/condition options are **per-template, not a global enum** (confirms
foundation brief §4). A workflow rule that references form fields must reference them by
**template + field ID**, not by a hardcoded list.

### 6b. The current "workflow" = the Request Template editor
Route `/templates/requests/:uuid/edit`, backed by `GET /workflows/templates`. It is a
**4-step wizard**:

1. **Parameters** — Request name, **Request Type** (`Loan Application` / `Origination` /
   `Covenant`), and an ordered, **drag-reorderable + deletable list of STAGES**
   (observed: `Application → Under Review → Approved`). *These stages are the closest thing
   to a workflow spine that exists today.*
2. **Documents** — attaches the dynamic forms/checklists; on load it fan-fetches each
   referenced form: `GET /documents/templates/forms/:uuid` (many, in parallel). This is the
   **composition-by-ID** pattern.
3. **Coverage** — product / retailer / eligibility coverage.
4. **Message** — the intake message shown to the customer.

**So the "inputs" the Workflow Creator must sync with are:**
- **Stages** per request template (`workflows/templates`) — the trigger points a rule hangs off.
- **Dynamic forms & their fields** (`documents/templates/forms`) — condition operands.
- **Document checklists**, **files**, **signatures**, **data-extraction** templates
  (other `/templates` tabs; same `documents` service).
- **Retailers** and **Products/Coverage** (Settings + Coverage step) — routing/eligibility.
- **Request Type** enum (`Loan Application` / `Origination` / `Covenant`).

Pull these live to populate the builder's pickers instead of hardcoding — that is precisely
what "sync with existing inputs" means here.

---

## 7. How "outputs" work — the downstream lifecycle to observe

The rule engine's **actions/effects** land in these existing surfaces (from platform
knowledge + live nav). The Workflow Creator should target these as action sinks and, where
it shows execution, read status back from them:

| Output surface | Route / service | Real status vocabulary (verified in foundation brief) |
|---|---|---|
| **Offers** | `/offers` (workflows) | queues: Unassigned / Assigned / All / Rejected |
| **Underwriting** | `/underwriting` (workflows) | My / Unassigned / Assigned / **Auto Approved / Approved / Rejected** / All |
| **Booking Events** | `/booking-events` (workflows → core) | Not Sent → In Flight → Sent → Confirmed / Partially Confirmed / Unconfirmed / **Error**; two dims: Data Status + Processing Status |
| **Loans** | `/loans` | Term Loans / Lines of Credit |
| **System Events** | `/system-events` | **6 real event types**: `FISERV LOAN`, `FMAC LOAN`, `LOAN APPROVED`, `LOAN REJECTED`, `OFFER ACCEPTED`, `SYSTEM ERROR` |
| **Notifications** | Novu | in-app inbox is already wired — a natural "notify" action sink |

**Reality check carried over from the foundation brief (do not regress):** the visible event
bus emits **6 lifecycle types**, not the 25 in the mockup. `assign_authority` (role ladder)
is **fabricated** — Settings→Users is a flat 43-user list with no roles UI; use "assign to
named user/team." Gate any aspirational trigger/action behind a "backend-confirmed-emittable"
flag so the demo never offers an effect the engine can't run.

---

## 8. Reconciling the standalone Next.js app with the Angular embed

There are now **two builds**, and this doc's job is to make them coherent:

| | Standalone prototype | Embedded product |
|---|---|---|
| Stack | Next.js + React + Supabase + Vercel | Angular + Material + `api-test.landjourney.ai` |
| Location | `Sweet Coding Work` repo, branch `feature/workflow-creator-ui` | admin monorepo (BitBucket) |
| Persistence | Supabase `WorkflowCreator` (`workflows` table, rule_json) | `workflows` service (needs endpoint — confirm) |
| Value | proves **UX** (WHEN/IF/THEN sentence, chat, pickers) + the **rule-JSON schema** | ships to real tenants, real inputs/outputs |

**Keep the schema, port the UI.** The versioned rule-JSON already agreed in
`2026-07-13_workflow-creator-live-integration-refinements_v1.md` is stack-agnostic and should
be the shared contract:

```jsonc
{
  "schemaVersion": 2,
  "trigger":   { "event": "<eventKey>" },
  "conditions":{ "logic": "AND|OR", "rules": [ /* {field, op, value} */ ] },
  "actions":   [ /* {type, params} */ ]
}
```

Recommended path:
1. **Freeze the schema** (above) as the interface both builds honor.
2. In the prototype, keep field/event/action vocab **fetched, not hardcoded**, so it maps
   cleanly onto the live `documents`/`workflows` inputs from §6.
3. For the embed, **re-implement the UI in Angular** (RxJS + Material + CDK), reusing the
   dynamic-form builder scaffolding (§6a). The React components are the spec.
4. Decide persistence: either a **new `/workflows/` API endpoint** in the product, or keep
   Supabase as a side-store for the demo. **This is the top open question — see §10.**

---

## 9. Concrete task list for Antigravity (Angular embed)

Assumes repo access. Verify every path against source first.

1. **Locate** the nav config that renders `lj-main-sidebar-v2` / `lj-nav-link-list` and the
   Angular `Routes` array feeding `router-outlet`. Note how `/templates` and its
   `forms/:id/edit` child are declared and lazy-loaded.
2. **Scaffold** a lazy feature module `workflows` with routes `/workflows` (list) and
   `/workflows/:id/edit` (builder), wrapped in `lj-page`.
3. **Add the nav-link** (icon `account_tree`/`rule`, label "Workflows"), gated by a new
   `ui-configuration` flag (§5). Wire the same flag into a route guard.
4. **Build the list page** in the Templates-list idiom (Name / Type / Updated At, search,
   row hover actions: duplicate / edit / delete, "Create New").
5. **Build the builder** by cloning the dynamic-form-builder shell: left config rail, center
   canvas, top bar with Preview + **Edit JSON** + version history + Save/Delete. Reuse CDK
   drag-drop and the `*Drafts` localStorage draft pattern.
6. **Wire inputs (sync):** populate pickers from live data —
   - stages/request-types ← `GET /workflows/templates` (per selected template)
   - form fields ← `GET /documents/templates/forms` + `/:id` (reference by template+field ID)
   - checklists / files / signatures / extraction ← corresponding `/documents/templates/*`
   - retailers / products ← Settings + Coverage sources
   Use the **existing auth interceptor / data services**, never manual `fetch` (§4).
7. **Wire outputs (action sinks):** map `actions[]` to Offers / Underwriting / Booking /
   Notifications(Novu); for any status display, read from the surfaces in §7. Keep
   unconfirmed events/actions behind a capability flag.
8. **Persistence:** call the product's workflow-persistence endpoint (confirm it exists in
   the `workflows` service; if not, this is a backend task — a workflow creator is ~80%
   backend per the foundation brief).
9. **Feature-flag the demo tenants** (Growmark / FCS) and confirm the section appears only
   for them.
10. Build + lint; hand to Gemini (Overseer) for verification against the live platform.

---

## 10. Open questions to resolve against source (unchanged priorities)

1. **Does the `workflows` service already expose a persistence endpoint** for a
   rules/workflow object, or only for request templates? (Determines backend scope.)
2. **What exactly does the HTTP interceptor add** beyond the bearer (tenant/org header?
   token decompression)? Needed to call any endpoint. (500 seen with bare bearer.)
3. **What is the `ui-configuration` flag mechanism** and how are new sections registered?
4. **Which events can the backend genuinely emit?** System Events shows only the 6 lifecycle
   types; are `doc_uploaded`, `sig_signed`, `checklist_done`, etc. real internal events?
5. **Where does persistence live for the embed** — new `workflows`-service table, or
   Supabase `WorkflowCreator` as a demo side-store? (§8 step 4.)
6. **Do scorecards / credit metrics (FICO, DSCR)** exist as structured data, or only inside
   documents + AI extraction? (Condition operands depend on this.)
7. **Exact Growmark / FCS demo scenario** — which effects must fire live vs be seeded
   (booking/core events can't fire on a local 16 GB profile).

---

## 11. Change log
- **2026-07-14 (v1)** — Live scan of `admin-test.landjourney.ai`. Confirmed Angular/Material
  stack, `lj-` component architecture, full route/nav map, `api-test.landjourney.ai`
  domain-service topology (`iam` / `workflows` / `documents`), the dynamic-form-builder
  pattern to mirror, the request-template stage model, and the inputs/outputs sync surfaces.
  Resolves foundation-brief open questions on stack (Angular embed, not Next), and the
  builder/composition pattern. Backend persistence + interceptor + emittable-events remain
  open (§10).

### Related docs
- `2026-07-13_workflow-creator-foundation-brief.md` — decision (P1+P3), verified vocabulary.
- `2026-07-13_workflow-creator-live-integration-refinements_v1.md` — the v2 rule-JSON schema.
- `2026-07-14_production-merge-readiness-plan_v1.md` — merge readiness.
