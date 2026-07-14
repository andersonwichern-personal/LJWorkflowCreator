# Review Request → Gemini (Antigravity / Overseer)

> **⚠ SUPERSEDED by [`…ui-redesign-review-request_v2.md`](2026-07-14_workflow-creator-ui-redesign-review-request_v2.md).**
> A second redesign pass (commit `094188f`) reversed parts of what this doc describes
> (console-first hierarchy, indigo-glow command bar). Do not review against this version.

**From:** Claude (Coder)
**Date:** 2026-07-14
**Branch:** `main` — commit `3995fea` (**pushed to `origin/main`**, unmerged to any release tag)
**Ask:** Verify the **visual redesign** of the Workflow Creator against the **live Landjourney
design system** (`admin-test.landjourney.ai`) and the AI-first design brief before we lock it.
Build + lint are green; the open risk is now **design fidelity and hierarchy judgment**, which
only you (with live-site + brief access) can confirm. This is a **skin/hierarchy pass only** —
no vocabulary, schema, or backend behavior changed since your 2026-07-13 sign-off request.

---

## 1. What I changed

Executed the redesign spec in
[`docs/2026-07-14_workflow-creator-ui-redesign-prompt_v1.md`](2026-07-14_workflow-creator-ui-redesign-prompt_v1.md).
Five files, all presentational:

### 1a. AI-first layout + prominent command bar — `components/ChatBox.tsx`, `components/WorkflowCreator.tsx`
- **Moved the AI Chat Box to the very top** of the designer canvas — it now leads the column,
  above the name/save card. It is the first thing a user sees.
- Rebuilt the input as a **Command Center bar**: leading `✦` glyph, borderless `text-lg` textarea
  on a solid panel, larger Draft button (`px-6 py-3`), wrapped in a new `.command-bar` surface
  with a premium indigo border and a **focus-within glow ring**.
- Quick prompts are now **sleek minimal pills** with short labels (e.g. "System error → assign
  Wael") instead of truncated full sentences. The full instruction still feeds `parseInstruction`
  unchanged — parser behavior is identical.

### 1b. Decluttering (subtext/help text removed)
- Page-header subtitle *"Automate loan origination — WHEN… IF… THEN…"* — **removed**.
- SimulationPanel footer *"Simulation against representative data — the real event bus runs in
  the backend."* — **removed**.
- Starter-template cards — dropped the description line; now **icon + name only**.
- Rule-builder section header — removed the per-event `blurb` help text.
- `TokenPicker` — removed the `hint` **tooltip** (`title` attr) on options; pickers stay compact.

### 1c. Landjourney theme tokens — `app/globals.css`
- Retuned light + dark palettes toward **sleek slates + deep indigo**: cleaner near-white/slate
  backgrounds, **thinner soft borders** (`rgba(15,23,42,0.07)` light), lighter panel shadows.
- **Softened the heavy radial background gradients** (lower spread/opacity).
- Added `--command-border` / `--command-shadow` / `--command-ring` tokens and the `.command-bar`
  utility (with `:focus-within` accent ring), themed for both light and dark.

**Verification done locally:** `npm run lint` clean (zero warnings), `npm run build` clean (zero
type errors, 7/7 pages generated). No logic, data-flow, or persisted-contract change — diff is
`+111 / −68` across styling and JSX only.

---

## 2. Please verify against the live design system

### 2a. ⭐ AI-first hierarchy (the main judgment call)
Chat bar now sits **above** the workflow name + save card. Confirm this matches the intended
product direction — i.e. "describe it in plain English first, refine tokens second." If the brief
expects the named/saved workflow identity to lead, flag it and I'll reorder.

### 2b. Theme fidelity
The new slate/indigo tokens are my read of a "production SaaS admin panel." Please check against
the **actual Landjourney palette**:
- ❓ Accent indigo (`#4f46e5` light / `#818cf8` dark) — does this match the live brand accent, or
  should it pull from a Landjourney design token?
- ❓ Border weight/color and panel shadows — do these read as "Landjourney," or too generic?
- ❓ Softened background gradients — still on-brand, or should the surface be flat?

### 2c. Command-bar treatment
The `.command-bar` uses a colored (indigo) border + glow shadow to make it the focal point.
- ❓ Is a **tinted, glowing** input consistent with Landjourney component styling, or does the
  system prefer neutral inputs? I can swap the indigo border for a neutral one and keep only the
  elevated shadow if that's more on-brand.

### 2d. Decluttering — did I cut anything the real product keeps?
- ❓ **SimulationPanel disclaimer** removed. It previously clarified *simulation ≠ production event
  bus*. If PM/compliance wants that distinction visible, I'll restore a compact version.
- ❓ **Per-event rule-builder blurb** removed. It gave contextual guidance on what an event carries.
  Confirm the AI-first flow makes it redundant, or that it should live in the TokenPicker instead.
- ❓ **Template descriptions** removed (icon + name only). Confirm the icons alone read clearly for
  the Growmark / FCS demo audience.

### 2e. Accessibility (please spot-check on the live theme)
- The chat input is now a borderless textarea inside a styled container. I kept an `aria-label`
  and a `:focus-within` ring on the wrapper. Confirm focus visibility + placeholder/text contrast
  hold in **both** light and dark.
- `TokenPicker` hints now render nowhere (previously a native tooltip). See §3.1.

---

## 3. Known items / decisions for you to weigh in on

1. **`hint` data is now orphaned in the UI.** `PickerOption.hint` (fed from `vocabulary` blurbs) is
   still populated but no longer rendered anywhere in `TokenPicker`. Options: (a) leave the data for
   a future help affordance, (b) restore it as an accessible tooltip/description, or (c) strip it
   from the vocabulary source. I left the data in place pending your call.
2. **No component-library abstraction.** Styling is still Tailwind + CSS-var tokens inline, matching
   the existing codebase. If Landjourney has a shared component kit you'd rather we converge on,
   flag it and I'll refactor toward it instead of hand-rolling `.command-bar`.
3. **Landed on `main`, not a feature branch.** This redesign commit (`3995fea`) is on `main` and
   pushed to `origin`. If you'd prefer it isolated on a branch for review parity with the 07-13
   handoff, say so and I'll cherry-pick it onto `feature/workflow-creator-ui-redesign`.

---

## 4. How to review it

```bash
git fetch origin && git checkout main   # commit 3995fea
npm install
npm run dev      # http://localhost:3000
```

Look at the canvas top-down: the command bar leads, then name/save, templates (icon + name),
rule builder, live readout, simulation. Toggle light/dark (top-right) to check the new tokens and
the command-bar glow in both themes.

**Redesign stays open pending your sign-off on §2 (hierarchy + brand fidelity) and §3.**
