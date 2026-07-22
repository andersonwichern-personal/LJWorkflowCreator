# Real-AI activation via Cloudflare AI Gateway — handoff

**Date:** 2026-07-22
**Owner of remaining steps:** backend + platform (Anderson to provision Cloudflare)
**Provider/model chosen:** Google **Gemini 3.5** (`gemini-3.5-flash`) behind the gateway
**Branch (frontend, done):** `feat/real-ai-draft-engine`

This is the launch-day runbook to turn natural-language workflow drafting from the
deterministic parser into real AI, routed through Cloudflare AI Gateway. The
Angular side is committed and verified; the three steps below are what remains.

---

## 0. What is already done (Angular repo — committed)

`DraftEngineService` ([src/app/features/workflows/data/draft-engine.service.ts](../src/app/features/workflows/data/draft-engine.service.ts))
routes NL instructions to the admin console's `parse-ai` endpoint through the
existing `ApiService` (bearer + `x-organization` tenancy), and **falls back to the
deterministic `parseInstruction`** in mock mode or on any transport/shape failure.

- Wired into: the `chat-draft` seam and the composer **commit** paths (build /
  Enter / demo, and the ambiguity re-parse). The per-keystroke live preview stays
  deterministic on purpose — no per-character round-trips or token cost.
- `rule-core` untouched — the network call lives in the app layer. `npm test`
  (core-tests + purity + sync gates) and `npm run build` are green.
- **No secrets in this repo.** The Cloudflare token and the Gemini key live only
  server-side (Step 2). The browser never holds either.

Because the fallback is deterministic, shipping the frontend early is safe: until
Steps 1–3 land, the UI simply behaves exactly as it does today.

---

## 1. Provision the AI Gateway (Cloudflare account — dashboard)

Only Anderson can do this (account access + token creation).

1. **Account ID** — Cloudflare dashboard → copy the Account ID.
2. **API token** — create one with `AI Gateway - Read`, `AI Gateway - Edit`,
   `Workers AI - Read`. (Optionally create a *named* gateway under
   **AI → AI Gateway → Create Gateway**; otherwise the id `default` auto-creates
   on first request.)
3. **Add the Gemini provider key** — get a Google AI Studio API key; it will be
   sent to the gateway server-side (Step 2). The gateway proxies it to Google.
4. **Bring the gateway into existence + confirm auth** (this one call creates the
   `default` gateway and validates the token):

   ```bash
   curl -X POST \
     "https://gateway.ai.cloudflare.com/v1/$ACCOUNT_ID/default/google-ai-studio/v1beta/models/gemini-3.5-flash:generateContent" \
     --header "cf-aig-authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     --header "x-goog-api-key: $GEMINI_API_KEY" \
     --header "Content-Type: application/json" \
     --data '{"contents":[{"role":"user","parts":[{"text":"ping"}]}]}'
   ```
5. **Verify** — dashboard → AI Gateway → your gateway → **Logs**: the request
   appears with model, tokens, latency. Logging/caching/rate-limiting/guardrails
   now apply to everything routed through it.

---

## 2. Backend `parse-ai` endpoint (critical path)

The endpoint is **not** in this repo (doctrine forbids reintroducing a same-origin
`/api` contract here). It belongs in the real admin console, reached by the
frontend via `ApiService`. The good news: the retired Vercel track already had a
production-grade Gemini implementation — recover it and change only the call site.

### 2a. Recover the head-start

The full 912-line route (few-shot prompt, `responseSchema` JSON mode, live-vocab
overlay, coerce/validate/normalize/lint, degrade-to-heuristic) is preserved at:

```bash
git show vercel-track-final:app/api/workflows/parse-ai/route.ts   # implementation
git show vercel-track-final:scripts/assert-parse-ai.ts            # its assertions
```

Port that logic into the admin console's HTTP layer. **Everything reuses verbatim
except the model call and the request/response envelope** (2b, 2c).

### 2b. The one code change — route the Gemini call through the gateway

The retired `callGeminiModel` calls Google directly. Swap the URL + auth; the
request **body is unchanged** (Google AI Studio provider-native passthrough):

```ts
// BEFORE (direct Google):
// const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
// const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, ... });

// AFTER (through Cloudflare AI Gateway):
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_GATEWAY_ID = process.env.CF_GATEWAY_ID ?? "default";
const url =
  `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}` +
  `/google-ai-studio/v1beta/models/${encodeURIComponent(model)}:generateContent`;
const res = await fetch(url, {
  method: "POST",
  signal: controller.signal,
  headers: {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,                                  // GEMINI_API_KEY, forwarded by the gateway
    "cf-aig-authorization": `Bearer ${process.env.CF_AIG_TOKEN}`, // if gateway auth is enabled
  },
  body /* the exact same JSON.stringify({ systemInstruction, contents, generationConfig }) */,
});
```

The existing model-candidate chain already lists `gemini-3.5-flash` first, so the
launch model needs no change. `GEMINI_API_KEY` stays the provider key; add
`CF_ACCOUNT_ID`, `CF_GATEWAY_ID`, `CF_AIG_TOKEN` as server secrets.

### 2c. Match the frontend contract

The new client differs from the retired route's envelope — align these two things:

- **Request** — `POST {apiBase}/workflows/parse-ai`, body:
  ```jsonc
  { "text": string, "options": ParseOptions }
  ```
  `options` carries `forceEvent`, `assignees`, `instanceOptions`,
  `instanceRegistry`, `allowUnbackedValues`. (Retired route read
  `{ instruction, forceEvent }` at top level — read `text` and `options.forceEvent`
  instead.) The bearer + `x-organization` + `x-landjourney-*` headers are added by
  `ApiService`; authorize against those, not a demo `orgId`.

- **Response** — a `ParseResult`:
  ```ts
  { rule: WorkflowRule | null, notes: string[], unresolved: UnresolvedSlot[],
    uncovered: string[], ambiguities: ParseAmbiguity[], unbacked?: string[] }
  ```
  The client shape-guards these five arrays/fields; extra fields from the retired
  envelope (`engine`, `suggestions`) are ignored and harmless, but returning the
  clean `ParseResult` is preferred. If the model/gateway fails, the client already
  falls back to the deterministic parser — the backend may also keep its own
  degrade path, but it is no longer required for the UI to stay up.

---

## 3. Flip the frontend to live

`isMockMode` is true whenever `apiBase` or `token` is empty
([app-config.ts](../src/app/shared/app-config.ts)). Provide real values at
bootstrap so the engine leaves mock mode:

```ts
// In the admin shell (or the standalone bootstrap), override APP_CONFIG:
{ provide: APP_CONFIG, useValue: {
    apiBase: 'https://api.landjourney.ai',   // live service origin
    token: '<bearer from the authenticated admin session>',
    organization: '<UI-configuration dnsPrefix>',
} }
```

The moment those are set and Step 2 is deployed, the same UI is real AI, with the
deterministic parser as the silent safety net.

---

## Ownership & checklist

| Step | Who | Blocking for live? |
|---|---|---|
| 0. Frontend seam | ✅ done (`feat/real-ai-draft-engine`) | — |
| 1. Provision gateway + keys | Anderson (Cloudflare dashboard) | yes |
| 2. Backend `parse-ai` → gateway | backend team (port from tag) | **yes — critical path** |
| 3. Live `APP_CONFIG` | deploy/shell | yes |

**Go-live smoke test:** with live config, submit a rule in the composer →
confirm the draft returns → check the AI Gateway **Logs** for the request →
disable the key briefly and confirm the UI degrades to the deterministic parser
without erroring.
