# Chat endpoint (`/api/workflows/chat`) + same-origin `/api` note

Status: v1 — 2026-07-26. Sibling of the parse endpoint (`api/workflows/parse-ai.ts`,
normative contract in [parser-ai-backend-contract.md](parser-ai-backend-contract.md)).

## Same-origin `/api` — a deliberate deviation

`parser-ai-backend-contract.md` was authored under the doctrine "no same-origin
`/api` in this repo". That line is now superseded ON PURPOSE: this repo hosts
Vercel serverless functions under `api/` so the static SPA and its AI backend
deploy as **one Vercel project** (one origin, no CORS, one set of server-side
secrets). Vercel matches `api/` functions before the SPA rewrite, so
`vercel.json`'s rewrite is unchanged. The parse contract itself still governs
`POST /api/workflows/parse-ai`.

## Contract — `POST /api/workflows/chat`

Request (JSON):

```jsonc
{
  "messages": [                     // required, non-empty; capped at last 20
    { "role": "user", "text": "hi" },        // role: "user" | "assistant"
    { "role": "assistant", "text": "Hello!" }
  ],                                // last message MUST be role "user";
                                    // each text capped at 4000 chars, control +
                                    // zero-width chars stripped, unknown fields dropped
  "vocabulary": { "assignees": ["Wael"] }    // optional, untrusted — capped to
                                    // 20 items/list before it grounds the prompt
}
```

Responses:

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "reply": string, "meta": { "provider": "google", "model": string, "latencyMs": number } }` | plain-text assistant reply |
| 400 | `{ "error": string }` | malformed/hostile input |
| 405 | `{ "error": "method-not-allowed" }` | non-POST |
| 503 | `{ "error": "not-configured" }` | `GEMINI_API_KEY` missing |
| 503 | `{ "error": "unavailable" }` | every model candidate failed |

Behavior: conversational plain text (temperature 0.7, no JSON schema — unlike
parse-ai's structured output). The assistant coaches phrasings the parser
understands, never claims to have created/activated/modified anything (the
app's deterministic pipeline does that), and never invents tenant data.
Timeouts: 15 s per model, 30 s total across the model chain.

## Environment variables (server-side ONLY — never in a client bundle)

| Var | Required | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | yes | Google AI Studio key; absent → chat 503 `not-configured`, parse-ai degrades to the deterministic parser |
| `GEMINI_MODEL` | no | overrides the head of the model chain (then `gemini-3.5-flash` → `gemini-3.1-flash-lite` → `gemini-flash-latest`) |
| `CF_ACCOUNT_ID` + `CF_AIG_TOKEN` | no | when both set, calls route via Cloudflare AI Gateway (`x-goog-api-key` + `cf-aig-authorization`) instead of direct Google |
| `CF_GATEWAY_ID` | no | gateway id, default `default` |
| `PARSE_AI_DEBUG` | no | `1` logs raw model JSON (parse-ai only; never in production) |

## Local development

- `vercel dev` serves `api/` functions locally; run `ng serve` with a proxy of
  `/api` to the `vercel dev` port (or open the `vercel dev` origin directly).
- Or push a branch and use a Vercel preview deployment — set the env vars in
  the Vercel project (Preview + Production scopes).
- Typecheck gate: `npx tsc -p api/tsconfig.json` must exit 0.
