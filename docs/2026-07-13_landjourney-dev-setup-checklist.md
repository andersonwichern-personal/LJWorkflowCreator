# Landjourney Dev — Setup Checklist

_Extracted 2026-07-13 from `General.md` §6 ("Andrew's Setup Checklist," adapted). Standalone,
actionable checklist for getting a working dev environment. See the onboarding doc
(`2026-07-09_landjourney-coding-onboarding.md`) for the full reasoning behind each step._

**The blocker to unblock first:** ask Wael/admin for **BitBucket access** on Day 1 — you
can't stand up the existing platform without it.

---

## Day 1 — Accounts (~45 min, mostly signups)

- [ ] Create a **personal GitHub** account for experiments; confirm your **@landjourney.ai** GitHub login for company work.
- [ ] Create a **personal Cloudflare** account; confirm access to the company Cloudflare account.
- [ ] Create a **Vercel** account — sign up _with your GitHub login_ (pre-wires the integration).
- [ ] Create a **Supabase** account (personal).
- [ ] Sign into **Google AI Studio** (aistudio.google.com) and poke around.
- [ ] Confirm your **Claude subscription** covers Claude Code daily use (Max plan recommended if building every day).
- [ ] **Ask Wael/admin for BitBucket permissions** on the Landjourney repos — request Day 1, it's a blocker. Need at least read on `shared-infrastructure` and the service repos.

### Which email for which account (the split that matters)

Rule (from Wael): heavy experimentation runs on **personal** emails; **@landjourney.ai** is
reserved for real, deployed company work. Experiment credentials must have **zero ability to
touch production**.

| Account | Email to use | Notes |
|---|---|---|
| GitHub — personal | personal Gmail | All experiments/prototypes. |
| GitHub — company | anderson@landjourney.ai | Deployed company work; may already exist. |
| Cloudflare — personal | personal email | Your own experiment domains/DNS. |
| Cloudflare — company | @landjourney.ai / shared account | Confirm access rather than creating new. |
| Vercel | sign up with personal GitHub | Pre-wires GitHub↔Vercel. |
| Supabase | personal email | Default prototype backend. |
| Google Cloud + AI Studio | personal Google | Rapid prototyping, free tier. |
| Anthropic / Claude Code | account holding your Claude sub | Max plan for daily building. |
| BitBucket | anderson@landjourney.ai | Legacy platform access — request Day 1. |
| Platform test personas ×2–3 | separate Gmails (operator / originator / counterparty) | For logging in as different roles during demos. |

Bottom line: one personal email covers all experiment service accounts; @landjourney.ai
covers company/BitBucket; 2–3 throwaway Gmails cover in-platform test roles.

---

## Day 1 — Installs (~30 min; Claude Code handles the rest)

> **You're on Mac (16 GB RAM).** Only the terminal app and the Claude Code install command
> differ by OS. **RAM note:** the full existing-platform stack wants ~18 GB, so start it with
> a **profile** (only the services a task needs) or **UI-with-dummy-data** mode — RAM is
> consumed by running containers, not stored files.

- [ ] **Claude Code** via the curl installer (NOT Node/npm), in Terminal:
      `curl -fsSL https://claude.ai/install.sh | bash`
- [ ] **Docker Desktop** (Mac build) — required for ministack + service containers.
- [ ] **Git** — preinstalled; verify `git --version` (may prompt for Command Line Tools).
- [ ] Create dev folder structure: `~/dev/` with `landjourney/`, `prototypes/`, `demos/`, `team/`. Drop the team `CLAUDE.md` into `team/`.
- [ ] _Optional:_ Antigravity (code review) and the Claude Chrome extension.
- [ ] **Do NOT install manually:** Wrangler, Vercel CLI, Supabase CLI, gh CLI, ministack, Node toolchains — Claude Code installs/configures these on request.

---

## Day 2 — Connect everything (~1 hr; just tell Claude Code)

Say these to Claude Code. If it asks you to copy dashboard values, insist it use the CLI.

- [ ] "Connect to my **GitHub** account using the gh CLI."
- [ ] "Connect to my **Cloudflare** account using the Wrangler CLI."
- [ ] "Set up the **Vercel** CLI and connect my GitHub to Vercel so pushes auto-deploy and branches get preview URLs."
- [ ] "Set up the **Supabase** CLI and log into my account."
- [ ] In Google AI Studio: Settings → connect **Save to GitHub**.
- [ ] "Read [path]/team/CLAUDE.md and follow it in every session in this folder."

---

## Day 2–3 — Stand up the existing platform (needs BitBucket access)

- [ ] Download the `local-environment` folder from the `shared-infrastructure` BitBucket repo into `~/dev/landjourney/`.
- [ ] Tell Claude: "Follow the instructions in this local-environment CLAUDE.md — **I have 16 GB RAM, so run a profile with only the services I need, not the full stack.**"
- [ ] Open the local port, log in with a test account, click around.

**16 GB modes:** UI-with-dummy-data (~2–4 GB, no ministack) for front-end/visual work; or a
partial **profile** (e.g. UI + `workflow-api` + `data-api`, ~8 GB) for building on the existing
requests and scorecards (the Growmark/FCS work). Raise Docker Desktop's RAM allocation but
leave macOS headroom.

---

## Week 1 — Domains, smoke tests, first client demo

- [ ] Start the **GoDaddy → Cloudflare** transfers for the 3 domains (Cloudflare → Registrar → Transfer; request auth/EPP code from GoDaddy; 1–3 days). Buy future domains **only** on Cloudflare.
- [ ] **New-stack smoke test:** "Create a test branch, add a hello-world page, push it, give me the Vercel preview URL." Then "roll back / delete that."
- [ ] **Existing-platform smoke test:** "Create a branch and change [some button] color." Confirm the PR flow shows repo owners as reviewers.
- [ ] **First client demo branch (Growmark or FCS):** "Create a branch `feature/growmark-demo`. Add [X] on top of the existing requests and scorecards." Demo locally; when approved, "push my branch and create a PR." For a hosted demo, ask for a `growmark.landjourney.io` subdomain.
- [ ] Put a **weekly rebase reminder** in place: "Check all my open branches against dust and rebase anything stale."

---

## Golden rules (don't skip)

- Use **CLIs, never dashboards** — push back if Claude asks you to copy dashboard values.
- **Branch for everything**; never merge to `main` directly; rebase against `dust` proactively.
- **Everything merged to `dust` ships to production** — never merge work that shouldn't ship.
- **Zero production access from experiment environments. Ever.**
