# Landjourney Workflow Creator

A loan-origination **admin console** with a plain-English **Workflow Creator** at its
heart. Build automations as an editable sentence — **WHEN** an event happens, **IF**
conditions hold, **THEN** take an action — with pickers constrained to the platform's
real vocabulary, a deterministic chat-to-rule parser, and a live simulation against
representative data.

> Built as a standalone Next.js + Supabase demo of the Workflow Creator, wrapped in a
> console that mirrors the live Landjourney admin site (`admin-test.landjourney.ai`).

## Highlights

- **Workflow Creator** (`/workflows`) — editable `WHEN / IF / THEN` token sentence
  (Proposal 3 skin) driven by an event → condition binding (Proposal 1 spine), so the
  builder only offers valid combinations. Verified vs. unconfirmed vocabulary is badged.
- **Live simulation** — as the rule changes, see which real requests it would match and
  what actions would run. A client-side rule engine (`lib/ruleEngine.ts`) powers this and
  the per-request "Automation" tab and per-event workflow matches.
- **Full admin console** — Home dashboard, Insights (charts + run-history), Requests +
  detail workspace, Customers, Offers, Underwriting (with bulk actions), Loans, Booking
  Events, System Events, Intake Links, Templates, Settings.
- **Nice touches** — ⌘K command palette, create-request wizard, guided demo tour,
  light/dark themes, keyboard-accessible, reduced-motion aware.

## Vocabulary is grounded, not invented

Every event, condition field, and action is tagged `verified` (observed on the live admin
site) or `unconfirmed` (plausible but unproven → gated + badged). See
[`docs/2026-07-13_workflow-creator-foundation-brief.md`](docs/2026-07-13_workflow-creator-foundation-brief.md)
for the grounding, and `lib/vocabulary.ts` for the source of truth.

## Stack

- **Next.js 15** (App Router) · **React 18** · **TypeScript** · **Tailwind CSS**
- **Prisma** → **Supabase** (Postgres) for workflow persistence, tenant-scoped by `org_id`
- Platform sections use deterministic seed data (`lib/platformData.ts`); the real
  request/loan data lives in the Landjourney backend.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # set DATABASE_URL / Supabase keys
npm run db:generate                # prisma generate
npm run dev                        # http://localhost:3000
```

### Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:studio` | Open Prisma Studio |

## Architecture

```
app/                    Routes (App Router) — one folder per console section
  api/workflows/        CRUD route handlers (tenant-scoped)
  requests/[id]/        Per-request workspace (SSG)
components/
  shell/                AppShell nav, command palette, demo tour
  ui/                   PageHeader, StatCard, StatusBadge, DataTable, QueueTabs, charts
  RuleSentence, TokenPicker, ChatBox, WorkflowCreator, SimulationPanel, RequestDetail
lib/
  vocabulary.ts         Verified/unconfirmed events, fields, actions + event binding
  ruleEngine.ts         Evaluate a rule against requests / events
  nlParser.ts           Deterministic chat → rule
  platformData.ts       Representative seed data
  analytics.ts          Insights selectors
  services/workflow.ts  Prisma-backed WorkflowService
```

## Status

Demo build. Execution is **stubbed** — rules persist, list, and toggle; the real event
bus + action executor run across the Landjourney backend and are out of scope here.
Vocabulary fidelity is pending final review against the live platform.
