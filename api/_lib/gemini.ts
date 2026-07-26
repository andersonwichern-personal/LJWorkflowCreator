/**
 * Shared Gemini plumbing for the same-origin /api functions.
 *
 * SECRETS: the provider key lives ONLY in `process.env.GEMINI_API_KEY` on the
 * server. It is sent to Google (or forwarded by the Cloudflare AI Gateway) and
 * is never logged, echoed into a response, or included in error messages —
 * upstream error bodies are redacted against it before they become Error text.
 */

export type GeminiPart = { text?: string };

export type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};

/** The generateContent request body both endpoints build (provider-native shape). */
export type GeminiRequestBody = {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
  generationConfig?: {
    temperature?: number;
    /** Parse endpoint only — the chat endpoint deliberately stays plain text. */
    responseMimeType?: string;
    responseSchema?: unknown;
  };
};

/** Trimmed provider key, or null when the endpoint is not configured. */
export function geminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

/**
 * Model selection: `GEMINI_MODEL` env override, then pinned Flash candidates
 * newest-first, with the `gemini-flash-latest` alias as the anti-rot backstop —
 * Google retires pinned names for new users (the Phase 8 spec's
 * gemini-2.5-flash now 404s). Model-level 404/429/503 errors fall through
 * before the route degrades to the deterministic parser.
 *
 * Every name here must be one ListModels actually serves: a candidate that
 * doesn't exist costs a 404 round-trip on each fall-through and never serves
 * traffic. `gemini-3.5-flash-lite` (Phase 10 spec) is not a real model — it
 * 404s — so it is deliberately omitted; 3.1-flash-lite is the live lite tier.
 */
export function geminiModelChain(): string[] {
  return [
    ...(process.env.GEMINI_MODEL?.trim() ? [process.env.GEMINI_MODEL.trim()] : []),
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
  ];
}

/**
 * One generateContent call against one model, with an AbortController timeout.
 *
 * Routing: direct Google by default. When `CF_ACCOUNT_ID` + `CF_AIG_TOKEN` are
 * both set, the call goes through the Cloudflare AI Gateway instead
 * (docs/2026-07-22_ai-gateway-real-ai-activation-handoff_v1.md §2b): same
 * provider-native body, gateway URL, `x-goog-api-key` carrying the provider
 * key and `cf-aig-authorization` carrying the gateway token — the key never
 * rides in a query string on that path.
 */
export async function callGeminiModel(
  model: string,
  body: GeminiRequestBody,
  timeoutMs: number
): Promise<GeminiResponse> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const cfAccountId = process.env.CF_ACCOUNT_ID?.trim();
  const cfAigToken = process.env.CF_AIG_TOKEN?.trim();
  let url: string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfAccountId && cfAigToken) {
    const gatewayId = process.env.CF_GATEWAY_ID?.trim() || "default";
    url =
      `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(cfAccountId)}/${encodeURIComponent(gatewayId)}` +
      `/google-ai-studio/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers["x-goog-api-key"] = apiKey;
    headers["cf-aig-authorization"] = `Bearer ${cfAigToken}`;
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // Defense in depth: upstream error text must never carry the key onward.
      const redacted = detail.split(apiKey).join("[redacted]");
      throw new Error(`Gemini HTTP ${res.status}${redacted ? `: ${redacted.slice(0, 240)}` : ""}`);
    }

    return (await res.json()) as GeminiResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Try each candidate model in order. Fall through to the next model on
 * MODEL-LEVEL unavailability — 404 (retired/renamed, e.g. gemini-2.5-flash for
 * new users), 429 (per-model rate cap), 503 ("high demand" — observed live on
 * gemini-flash-latest). Every other failure propagates so the caller's own
 * degrade path handles it.
 */
export async function callGeminiChain(
  body: GeminiRequestBody,
  perModelTimeoutMs: number,
  totalBudgetMs: number
): Promise<{ model: string; data: GeminiResponse }> {
  const models = [...new Set(geminiModelChain())];
  const deadline = Date.now() + totalBudgetMs;
  let lastUnavailable: Error | null = null;
  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break; // budget spent — let the caller degrade rather than run past maxDuration
    const attemptMs = Math.min(perModelTimeoutMs, remaining);
    try {
      return { model, data: await callGeminiModel(model, body, attemptMs) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const name =
        error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
      // A timed-out attempt is THIS model being too slow right now — the same
      // kind of transient unavailability as a 503. Treat it as a fall-through so
      // one slow candidate doesn't burn the whole request; without this the abort
      // throws straight out of the chain and the healthy models are never tried.
      if (name === "AbortError" || /^Gemini HTTP (404|429|503)\b/.test(message)) {
        const cause = name === "AbortError" ? `timeout after ${attemptMs}ms` : message.slice(12, 15);
        console.warn(`Gemini model "${model}" unavailable (${cause}); trying next candidate.`);
        lastUnavailable = error instanceof Error ? error : new Error(String(error));
        continue;
      }
      throw error;
    }
  }
  throw lastUnavailable ?? new Error("No Gemini model candidates configured.");
}

/** First candidate's concatenated text parts; throws when the model returned nothing. */
export function extractGeminiText(data: GeminiResponse): string {
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini returned no content.");
  return text;
}

/** Models sometimes fence JSON-mode output anyway; strip a leading/trailing fence. */
export function stripJsonFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}
