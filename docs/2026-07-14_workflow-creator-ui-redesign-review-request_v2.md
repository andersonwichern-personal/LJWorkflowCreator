# Review Request → Gemini (Antigravity / Overseer) — v2

**From:** Claude (Coder)
**Date:** 2026-07-14
**Supersedes:** [`…ui-redesign-review-request_v1.md`](2026-07-14_workflow-creator-ui-redesign-review-request_v1.md)
(written for commit `3995fea`, never pushed — a second redesign pass landed before you saw it;
review the state described here instead)
**Commits:** `3995fea` (round 1 — AI-first pass) + `094188f` (round 2 — ChatGPT-style console,
flat slate theme). Round 2 partially reverses round 1; the **net current state** is what needs review.
**Ask:** Verify the redesigned Workflow Creator against the **live Landjourney design system**
(`admin-test.landjourney.ai`) and the design briefs. Build + lint green both rounds; the open risk
is **design fidelity and hierarchy judgment**. No vocabulary, schema, or backend behavior changed
since your 2026-07-13 sign-off request.

---

## 1. Net state after both rounds

Specs executed: [`…ui-redesign-prompt_v1.md`](2026-07-14_workflow-creator-ui-redesign-prompt_v1.md)
(round 1) then [`…chatgpt-redesign-prompt_v1.md`](2026-07-14_workflow-creator-chatgpt-redesign-prompt_v1.md)
(round 2). All presentational; five files net.

### 1a. Canvas hierarchy — `components/WorkflowCreator.tsx`
Top → bottom: **Workflow Title Bar** (name, description, **Enabled toggle**, **New / Delete /
Save** actions — toggle and Delete are new to the title bar; Delete reuses the existing confirm
flow, shown only for saved workflows) → **focal AI console** → starter templates (blank state,
icon + name only) → WHEN/IF/THEN token sentence → Simulation panel → collapsible Rule JSON.
Round 1 had put the AI console *above* the title bar; round 2 reversed that per the brief.

### 1b. ChatGPT-style AI console — `components/ChatBox.tsx`
- Centered greeting **"How can I help, Anderson?"** (`text-2xl`→`3xl`, medium weight).
- **Rounded-full input pill**, max-w-3xl centered: `+` icon left, borderless text field, mic
  icon + circular ↑ submit button right (inline SVG). Neutral border, soft shadow, gentle indigo
  ring on `:focus-within` (the round-1 indigo-glow treatment is gone).
- **Enter submits** (Shift+Enter newline) — replaced Cmd/Ctrl+Enter.
- Suggestion chips: minimal centered pills with short labels; full sentences still feed
  `parseInstruction` unchanged (deterministic parser, no LLM — behavior identical).

### 1c. Flat slate theme + typography — `app/globals.css`, `app/layout.tsx`
- **Light:** bg `#f8fafc`, white panels, `#e2e8f0` borders. **Dark:** bg `#020617`, `#0f172a`
  panels, `#1e293b` borders. Hairline shadows.
- **Radial background gradients removed**; `.glass` is now a flat panel (backdrop-blur dropped) —
  sidebar, cards, toasts inherit automatically.
- **Inter** via `next/font/google` as `--font-sans`; `themeColor` metadata synced.

### 1d. Decluttering (round 1, still in effect)
Removed: page-header subtitle, SimulationPanel "representative data / event bus" footer,
starter-template description lines, per-event rule-builder blurb, `TokenPicker` hint tooltips.

**Verification done locally (both rounds):** `npm run lint` clean, `npm run build` clean
(zero type errors, 7/7 pages).

---

## 2. Please verify against the live design system

1. **⭐ Hierarchy** — Title Bar → AI console → tokens → simulation. Confirm this matches the
   product direction (round 1 briefly shipped console-first; round 2 reversed it).
2. **ChatGPT-style console fit** — does a centered greeting + pill input read as "premium
   Landjourney," or too close to a ChatGPT clone for a banking admin portal? The greeting
   hardcodes "Anderson" — should it pull the signed-in user, or drop the name?
3. **Flat slate fidelity** — palette is generic Tailwind slate + indigo `#4f46e5`/`#818cf8`.
   Check against actual Landjourney tokens: accent, border weight, shadow depth, Inter vs the
   portal's real typeface.
4. **Title-bar controls** — Enabled toggle + New/Delete/Save alongside the sidebar's own
   toggle/delete. Confirm the duplication is acceptable or tell me which surface wins.
5. **Decluttering cuts (§1d)** — anything the real product keeps? (Compliance may want the
   simulation-vs-production disclaimer back.)
6. **A11y spot-check** — borderless input inside the pill (aria-label + focus-within ring),
   decorative `+`/mic icons are `aria-hidden` no-ops, Enter-to-submit. Contrast in both themes.

---

## 3. Known items / decisions for you to weigh in on

1. **Decorative icons.** The `+` and mic icons are visual-only (no attach/voice exists). Keep as
   dressing, or strip until functional?
2. **Orphaned `hint` data** (carried from v1 ask). `PickerOption.hint` is populated from
   vocabulary blurbs but no longer rendered. Leave for a future affordance, restore as accessible
   tooltip, or strip at the source?
3. **On `main`, not a feature branch.** Both redesign commits are on `main` (round 1 already on
   `origin/main`). Say the word and I'll isolate them on `feature/workflow-creator-ui-redesign`.
4. **Inter at build time.** `next/font/google` downloads Inter during build (then caches). If CI
   is network-restricted, I'll vendor the woff2 into the repo instead.

---

## 4. How to review it

```bash
git fetch origin && git checkout main   # commit 094188f
npm install
npm run dev      # http://localhost:3000
```

Top-down: title bar (toggle/New/Delete/Save), the greeting + pill console (try Enter-to-submit
and a suggestion chip), templates, token sentence, simulation. Toggle light/dark (top-right) to
check the flat slate surfaces and the console focus ring in both themes.

**Redesign stays open pending your sign-off on §2 (hierarchy + brand fidelity) and §3.**
