# General — Landjourney Coding Onboarding

_Created 2026-07-09. Source of direction: the uploaded `CLAUDE.md`, `SETUP-CHECKLIST.md`, `local-storage` notes, and the two HTML guides. The July 9 call with Wael (CTO) is background context._

This is your home-base doc for getting up to speed as a developer at Landjourney. Read the "What I need to do" section first — the rest is reference.

---

## 1. The one-sentence version

You tell **Claude Code** (in your terminal) what you want; it drives every tool through CLIs (`git`, `gh`, Wrangler, Vercel, Supabase). You almost never click around in dashboards — web UIs are for review and emergencies only. That principle is the whole philosophy.

---

## 2. The two environments (this is the core mental model)

Everything at Landjourney falls into one of two buckets. Same pipeline, different plumbing.

**A. Existing Landjourney AI platform (legacy stack)**
- Source control lives in **BitBucket**. Key repos: `shared-infrastructure`, `user-interface`, `iam-api`, `commons`, `data-api`, `workflow-api`, and more.
- To run the whole platform on your own machine, you get the `local-environment` folder from the `shared-infrastructure` repo (really just its `CLAUDE.md`), hand it to Claude Code, and say "follow the instructions in this file." Claude then clones every repo you have access to, provisions **Docker + ministack** (a free, localstack-style AWS emulator), starts every service container, wires them together, and seeds test data. Nothing touches the internet — it all runs on a local port.
- Needs **~18 GB RAM** for the full end-to-end stack. If your machine is tight, ask Claude for a **profile** — run only the services your task needs. Pure UI/demo work can run the front end standalone with dummy data, no ministack at all.
- Branch model: `main` = production (what clients see) · `dust` = the shared test branch everyone merges into (deploys to `*-test` subdomains like `api-test.landjourney.ai`) · local feature branches on your machine.
- **Everything merged to `dust` eventually ships to production — never merge work that shouldn't ship.**
- **This is your sandbox for the Growmark / FCS client work:** stand it up locally, then build on top of the existing requests and scorecards without touching anything real.

**B. New prototypes, demos & products (modern stack)**
- The agreed "Lego pieces" — use these unless there's a strong, communicated reason not to:
  - **Cloudflare** — registrar, DNS, SSL/TLS, firewall, tunnels, caching, Zero Trust, AI Gateway. The single front door. Managed via the **Wrangler CLI**.
  - **Vercel** — front-end hosting + CI/CD. Managed via the **Vercel CLI**. Push to main = production deploy; every branch = automatic preview URL; every deploy is version-controlled and rollback-able.
  - **GitHub** — source control for all new work (deep Claude Code integration; no manual branch naming).
  - **Supabase** — Postgres database, auth, storage, edge functions, logging, AI gateways. Preferred over Neon / CockroachDB because it packs the most features behind one CLI login.
  - **Google Cloud Platform** — extra backend services when needed.
  - **Google AI Studio** — fastest idea-to-demo prototyping. Always export via "Save to GitHub" — never leave a real project trapped in AI Studio.
- Default languages/frameworks: **Node.js + TypeScript + Tailwind**. Deviate only when the domain demands it, and tell the team.
- Adding a new tool requires two checks: (1) is it on **Vanta** (compliance)? (2) does it pack enough features to justify another integration? Fewer, feature-dense blocks beat many small ones.

---

## 3. The pipeline every feature travels

Prototype → Local dev → Branch/PR → Test (`dust`) → Production (`main`)

1. **Prototype** — sketch fast in Google AI Studio or Claude design ("style it like Cash App," magic pen to iterate visually).
2. **Local dev** — Claude Code builds the real thing on a feature branch; the full stack runs locally so Claude can see what breaks (the "harness").
3. **Branch → PR** — tell Claude "create a PR." Repo owners review. Rebase against `dust` regularly so branches don't drift.
4. **Test (`dust`)** — merged PRs deploy to `*-test` subdomains for QA and client preview.
5. **Production (`main`)** — Jeremie gates promotion of `dust` → `main`; CI/CD auto-deploys; one-command rollback.

---

## 4. Operating rules (how Claude Code should behave for you)

1. **Use CLIs, never dashboards.** If Claude asks you to copy values from a web dashboard, push back: _"Use the [Vercel/Wrangler/Supabase] CLI. Stop asking me questions."_ You have to insist.
2. **Install what's needed.** Missing CLI → Claude installs and authenticates it (you only do the one-time login).
3. **Claude Code install = the curl installer**, not the old Node/npm way. If the old version is present, have Claude clean it up and migrate you.
4. **Branch for everything** — one branch per feature, per client demo, per experiment. Branches are free and infinite. Claude creates them (and git worktrees, the `_`-prefixed folders) without being asked.
5. **Rebase proactively** — if a branch is more than a few days behind `dust`/`main`, rebase and fix misalignments before proposing a merge. Purely additive work rarely collides; anything touching shared code (programs, underwriting) must be re-checked.
6. **Branch stacking for previews** — you can preview several unmerged branches combined on top of `dust` locally (e.g. feature + new menu + new styling) without merging anything upstream.
7. **PR flow** — when work is ready, push the branch and open a PR. Never merge to `main` directly.
8. **Deploys & rollbacks** — deploy by pushing (CI/CD). To roll back, just say "go back" and Claude restores the previous Vercel deployment.
9. **Domains** — buy directly on Cloudflare's registrar, never GoDaddy/Namecheap. Client demos get subdomains (`clientname.landjourney.io`).
10. **Email/account hygiene** — experiments run on **personal** accounts with zero intersection with production. Company work runs on **@landjourney.ai** accounts. It's useful to have 2–3 personal test emails (operator / originator / counterparty roles).
11. **Client-facing = branded URL** — demo from a local branch, a Vercel preview, or a branded subdomain; never from test or prod until PR'd and approved.
12. **Zero production access from experiment environments. Ever.** By design, not an inconvenience.

---

## 5. Local file organization

One dev root per machine — **git is the filing system**; your disk is just a working surface. Never scatter projects across Desktop/Documents/Downloads.

```
~/dev/  (Mac)  ·  C:\dev\  (Windows)
├── landjourney/          # existing platform (BitBucket bootstrap clones here)
│   ├── local-environment/
│   ├── user-interface/ … workflow-api/   # one folder per repo
│   └── _worktrees/       # Claude-managed parallel branch checkouts
├── prototypes/           # personal-account experiments (own GitHub)
├── demos/                # client work: growmark/, fcs/, …
└── team/                 # shared CLAUDE.md + standards (its own small repo)
```

Don't store locally: secrets/API keys (use each CLI's auth store), databases/test data (Docker volumes, disposable), or anything not committed and pushed.

> Note: this `General.md` and future coding notes live in your `Claude Files/Landjourney/Coding` folder per your filing convention. The `~/dev/` root above is where the actual **code repos** get cloned — keep the two separate.

---

## 6. What I need to do — my action plan

Worked top to bottom. This mirrors "Andrew's Setup Checklist," adapted for you.

### Day 1 — Accounts (~45 min, mostly signups)
- [ ] Create a **personal GitHub** account for experiments; confirm your **@landjourney.ai** GitHub login for company work.
- [ ] Create a **personal Cloudflare** account; confirm access to the company Cloudflare account.
- [ ] Create a **Vercel** account — sign up _with your GitHub login_ (pre-wires the integration).
- [ ] Create a **Supabase** account (personal).
- [ ] Sign into **Google AI Studio** (aistudio.google.com) and poke around.
- [ ] Confirm your **Claude subscription** covers Claude Code daily use (Max plan recommended if building every day).
- [ ] **Ask Wael/admin for BitBucket permissions** on the Landjourney repos — request Day 1, it's a blocker for standing up the platform. You need at least read on `shared-infrastructure` and the service repos.

#### Which email for which account (the split that matters)

**The rule (from Wael):** heavy experimentation runs on **personal** emails; **@landjourney.ai** is reserved for real, deployed company work, because company access gets granted to that address. Experiment credentials must have **zero ability to touch production** — keep the two worlds fully separate.

| Account | Email to use | Why / notes |
|---|---|---|
| **GitHub — personal** | personal email (e.g. a Gmail) | All experiments and prototypes. Claude Code integrates natively via `gh`. |
| **GitHub — company** | anderson@landjourney.ai | Deployed company work. Just confirm you can log in; may already exist. |
| **Cloudflare — personal** | personal email | Your own experiment domains/DNS/Zero Trust. |
| **Cloudflare — company** | @landjourney.ai / shared company account | Company domains. Confirm access to the shared account rather than making a new one. |
| **Vercel** | sign up **with your personal GitHub login** | Pre-wires the GitHub↔Vercel integration. Team plan later for shared work. |
| **Supabase** | personal email | Default backend for prototypes. |
| **Google Cloud + AI Studio** | personal Google account | Rapid prototyping. Free tier. |
| **Anthropic / Claude Code** | whichever account holds your Claude subscription | Max plan recommended for daily building. |
| **BitBucket** | anderson@landjourney.ai | Legacy platform access — request from Wael/admin Day 1. |
| **Platform test personas ×2–3** | separate emails (operator / originator / counterparty) | For logging into the platform *as different user roles* during testing/demos — not service accounts. |

**How to actually get the extra emails:** easiest is 2–3 separate free Gmail accounts for the test personas (operator/originator/counterparty). Gmail `+` aliases (e.g. `you+operator@gmail.com`) also work and arrive in one inbox, but some loan-platform forms reject the `+`, so separate accounts are the safer default for persona testing. Your one **personal** Gmail is enough for all the *service* signups above (GitHub/Vercel/Supabase/Cloudflare/Google) — you don't need a different email per service, only the personal-vs-company split.

**Bottom line:** one personal email covers all your experiment service accounts; @landjourney.ai covers company/BitBucket; 2–3 extra throwaway emails cover in-platform test roles.

### Day 1 — Installs (~30 min; Claude handles the rest)

> **Platform note:** I'm on a **Mac (16 GB RAM)**; Andrew is on a **Windows ThinkPad**. We're running the _exact same setup_ — identical accounts, tools, CLIs, and workflow. Only two things differ by OS: the terminal app and the Claude Code install command. Everything Claude Code does after that is OS-agnostic, so our environments end up matched.
>
> **⚠️ RAM note (16 GB):** the full end-to-end existing-platform stack wants ~18 GB, so I can't comfortably run *everything* at once. This does **not** change my setup — same tools, same accounts. It only changes *how I start the existing platform*: I use a **profile** (run only the services a task needs) or **UI-with-dummy-data mode** (no ministack at all). RAM is consumed by *running containers*, not stored files, so profiles are the correct lever. See the RAM section below.
>
> | Thing | My Mac | Andrew's ThinkPad |
> |---|---|---|
> | Terminal | **Terminal** (built-in) | **PowerShell** |
> | Claude Code install | `curl -fsSL https://claude.ai/install.sh \| bash` | `irm https://claude.ai/install.ps1 \| iex` |
> | Dev root | `~/dev/` | `C:\dev\` |
> | Git | preinstalled | install Git for Windows |

- [ ] **Claude Code** via the new curl installer (NOT Node/npm), in **Terminal**:
  - `curl -fsSL https://claude.ai/install.sh | bash`
  - (If the command changed, copy the current one from the official quick-start page.)
- [ ] **Docker Desktop** (Mac build) — required for ministack + service containers.
- [ ] **Git** — preinstalled on Mac; verify with `git --version` (macOS may prompt to install Command Line Tools the first time).
- [ ] Create your **dev folder structure**: `~/dev/` with `landjourney/`, `prototypes/`, `demos/`, `team/`. Drop the team `CLAUDE.md` into `team/`.
- [ ] _Optional:_ **Antigravity** (review code, Claude + Gemini side by side) and the **Claude Chrome extension**.
- [ ] **Do NOT install manually:** Wrangler, Vercel CLI, Supabase CLI, gh CLI, ministack, Node toolchains — Claude Code installs/configures these when you ask it to connect.

### Day 2 — Connect everything (~1 hr; just tell Claude Code)
Open Claude Code and literally say these. If it asks you to copy dashboard values, insist it use the CLI.
- [ ] "Connect to my **GitHub** account using the gh CLI."
- [ ] "Connect to my **Cloudflare** account using the Wrangler CLI."
- [ ] "Set up the **Vercel** CLI and connect my GitHub to Vercel so pushes auto-deploy and branches get preview URLs."
- [ ] "Set up the **Supabase** CLI and log into my account."
- [ ] In Google AI Studio: Settings → connect **Save to GitHub**.
- [ ] "Read [path]/team/CLAUDE.md and follow it in every session in this folder."

### Day 2–3 — Stand up the existing platform (needs BitBucket access)
- [ ] Download the `local-environment` folder from the `shared-infrastructure` BitBucket repo into `~/dev/landjourney/`.
- [ ] Tell Claude: "Follow the instructions in this local-environment CLAUDE.md — **I have 16 GB RAM, so run a profile with only the services I need, not the full stack.**" It clones repos, provisions Docker + ministack for that profile, seeds data, hands you a working local platform.
- [ ] Open the local port, log in with a test account, click around.

#### Running the platform on 16 GB RAM (my machine)
The full stack (~18 GB) won't fit comfortably, so I use one of two lighter modes:
- **UI-with-dummy-data** — the front end renders standalone with fake data, **no ministack**. Covers most front-end tweaks and visual client demos. Lightest option (~2–4 GB).
- **Profile (partial stack)** — run only the services a task actually needs. For building on top of the existing **requests and scorecards** (the Growmark/FCS work), I'll likely need a "core"-ish profile: UI + `workflow-api` + `data-api` (~8 GB) rather than everything.
- What to say to Claude: _"I only want to work on [X] — run only the services this experiment needs."_
- Named profiles aren't a formal feature yet — worth asking Wael to define `ui-only` / `core` / `full` in the local-environment CLAUDE.md (see suggestions). Until then, Claude picks the minimal service set per task.
- Docker Desktop memory: raise its RAM allocation (Settings → Resources) as high as is safe on a 16 GB Mac, but leave headroom for macOS — don't give Docker everything.

### Week 1 — Domains, smoke test, first client demo
- [ ] Start the **GoDaddy → Cloudflare transfers** for the 3 recently-bought domains (Cloudflare → Registrar → Transfer a domain → request auth/EPP code from GoDaddy; the email takes 1–3 days). From now on, buy domains **only** on Cloudflare.
- [ ] **New-stack smoke test:** "Create a test branch, add a hello-world page, push it, give me the Vercel preview URL." Then "roll back / delete that."
- [ ] **Existing-platform smoke test:** "Create a branch and change [some button] color." Watch it appear locally; confirm the PR flow shows repo owners as reviewers in BitBucket.
- [ ] **First client demo branch (Growmark or FCS):** "Create a branch called `feature/growmark-demo`. Add [X] on top of the existing requests and scorecards." Demo from your machine; when they like it, "push my branch and create a PR." For a hosted demo, ask for a `growmark.landjourney.io` subdomain.
- [ ] Put a **weekly rebase reminder** in place: "Check all my open branches against dust and rebase anything stale."

---

## 7. Your actual assignment (the "why")

Andrew is working with two clients — **Growmark** and **FCS** — who like the current platform but need additional things built. The goal is **not** to rebuild the whole site for a demo. Instead: a sandbox where you have the code base running locally, separate from the live demo/prod sites, so you can use Claude Code to build on top of what exists (plugging into the already-built requests and scorecards) and show clients working workflows — without risking anything real. Standing up the existing platform locally (Day 2–3 above) is exactly that sandbox.

---

## 8. Quick reference — what each tool is for

| Tool | Role |
|---|---|
| **Claude Code** (terminal) | The driver. Builds, branches, deploys — everything, via CLIs. |
| **Terminal / PowerShell** | Where Claude Code runs. Preferred for creating & shipping code. |
| **Antigravity** | IDE for reviewing code + Claude/Gemini side by side. Optional. |
| **Docker + ministack** | Runs the existing platform locally (emulated AWS). |
| **BitBucket** | Source control for the existing legacy platform. |
| **GitHub** | Source control for all new work. |
| **Cloudflare** | Front door: registrar, DNS, SSL, Zero Trust, AI Gateway (Wrangler CLI). |
| **Vercel** | Front-end hosting + CI/CD + preview URLs (Vercel CLI). |
| **Supabase** | DB + auth + storage + edge functions (Supabase CLI). |
| **Google AI Studio** | Rapid prototyping; export to GitHub. |

---

## 9. Suggestions to raise with Wael (from the local-storage notes, not the call)

Consolidate on GitHub with a gradual BitBucket migration; ship named ministack profiles (`ui-only` ~2–4 GB, `core` ~8 GB, `full` ~18 GB); version the team `CLAUDE.md` in a `team-standards` repo; automate the weekly rebase; one company Cloudflare account with member seats; write down the `clientname.landjourney.io` demo-naming convention; add a lightweight secrets policy; leave existing Neon work as-is until it needs porting (new backends default to Supabase).
