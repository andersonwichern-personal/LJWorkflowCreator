/**
 * Parse-AI route contract suite — model fallback, LLM shape normalization,
 * assignee honesty, and deterministic degradation. No network calls are made.
 * Run: npx tsx scripts/assert-parse-ai.ts
 */
import type { UnresolvedSlot } from "../lib/nlParser";
import type { WorkflowRule } from "../lib/vocabulary";

interface ParseAiResponse {
  rule: WorkflowRule | null;
  notes: string[];
  suggestions: string[];
  unresolved: UnresolvedSlot[];
  uncovered: string[];
  engine: "gemini" | "heuristic";
}

let failures = 0;
function t(name: string, condition: boolean, detail?: string) {
  if (!condition) failures++;
  console.log(
    `${condition ? "PASS" : "FAIL"} ${name}${!condition && detail ? ` — ${detail}` : ""}`
  );
}

function geminiJson(payload: unknown, status = 200): Response {
  if (status !== 200) return new Response(JSON.stringify(payload), { status });
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

const rawGeminiPayload = {
  rule: {
    schemaVersion: 3,
    // Deliberately use the common LLM drift shapes the route massages.
    triggers: [{ key: "LOAN APPROVED" }],
    conditions: { logic: "and", children: [] },
    actions: [{ key: "assign_user", value: "Wael" }],
    else: [{ key: "notify", value: "Santa Claus" }],
    controls: {
      mode: "shadow",
      oncePerRequest: true,
      maxFiresPerHour: 25,
      missingData: "no_match",
      priority: 100,
    },
  },
  notes: ["I drafted the approval workflow."],
  suggestions: ["Add a tag?", "Notify Sara?", "Arm this rule?", "Ignored fourth chip"],
  unresolved: [],
  uncovered: [],
};

process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "retired-test-model";
process.env.LANDJOURNEY_API_BASE = "";
process.env.LANDJOURNEY_API_TOKEN = "";
process.env.LANDJOURNEY_ORG_ID = "";

let mode: "fallback-success" | "abort-then-success" | "server-error" = "fallback-success";
let calls: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : input.toString();
  calls.push(url);
  if (mode === "fallback-success") {
    if (calls.length === 1) return new Response("retired", { status: 404 });
    return geminiJson(rawGeminiPayload);
  }
  if (mode === "abort-then-success") {
    // Simulate the first candidate exceeding its per-model timeout: fetch rejects
    // with the same AbortError the route's own AbortController produces.
    if (calls.length === 1) {
      const abort = new Error("This operation was aborted");
      abort.name = "AbortError";
      throw abort;
    }
    return geminiJson(rawGeminiPayload);
  }
  return geminiJson({ error: "temporary failure" }, 500);
}) as typeof fetch;

async function main() {
  const imported = (await import("../app/api/workflows/parse-ai/route")) as unknown as {
    POST?: (req: Request) => Promise<Response>;
    default?: { POST?: (req: Request) => Promise<Response> };
  };
  const postCandidate = imported.POST ?? imported.default?.POST;
  if (typeof postCandidate !== "function") throw new Error("parse-ai route did not export POST");
  const post: (req: Request) => Promise<Response> = postCandidate;

  async function parse(instruction: string): Promise<ParseAiResponse> {
    const response = await post(
      new Request("http://local/api/workflows/parse-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      })
    );
    return (await response.json()) as ParseAiResponse;
  }

  /* ---- retired model fallback + boundary normalization --------------------- */
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  const gemini = await parse("When approved assign Wael, otherwise notify Santa Claus");
  console.warn = originalWarn;
  const elseSlot = gemini.unresolved.find(
    (slot) => slot.where === "action-param" && slot.lane === "else" && slot.actionIndex === 0
  );

  t("404 model fallback returns Gemini response", gemini.engine === "gemini");
  t("env model is attempted first", calls[0]?.includes("/retired-test-model:generateContent"));
  t("default fast model is attempted second", calls[1]?.includes("/gemini-3.5-flash:generateContent"));
  t("404 fallback makes exactly two calls", calls.length === 2, JSON.stringify(calls));
  t("404 fallback is logged", warnings.some((warning) => warning.includes("retired-test-model")));
  t("shape drift: trigger key becomes event", gemini.rule?.triggers[0]?.event === "LOAN APPROVED");
  t("shape drift: lowercase group logic becomes AND", gemini.rule?.conditions.logic === "AND");
  t("shape drift: action key/value becomes action/params", gemini.rule?.actions[0]?.params.assignee === "Wael");
  t("known then-lane assignee is preserved", gemini.rule?.actions[0]?.params.assignee === "Wael");
  t("fabricated else-lane assignee is blanked", gemini.rule?.else?.[0]?.params.value === "");
  t("fabricated else-lane assignee becomes addressable slot", elseSlot?.heard === "Santa Claus");
  t("fabricated name does not survive in rule JSON", !JSON.stringify(gemini.rule).includes("Santa Claus"));
  t("suggestions are capped at three", gemini.suggestions.length === 3);
  t("assignee enforcement adds a personable note", gemini.notes.some((note) => note.includes("Santa Claus")));

  /* ---- a timed-out model falls through to the next candidate --------------- */
  // Regression guard: the chain used to catch only HTTP 404/429/503, so an
  // AbortError (per-model timeout) threw straight out and the healthy candidates
  // were never tried — one slow model burned the whole request.
  mode = "abort-then-success";
  calls = [];
  const timeoutWarnings: string[] = [];
  console.warn = (...args) => timeoutWarnings.push(args.join(" "));
  const recovered = await parse("When loan approved assign Wael");
  console.warn = originalWarn;
  t("timeout on the first model falls through to Gemini, not heuristic", recovered.engine === "gemini");
  t("timeout fallthrough tries exactly two candidates", calls.length === 2, JSON.stringify(calls));
  t("timeout fallthrough is logged as a timeout", timeoutWarnings.some((w) => w.includes("timeout")));

  /* ---- non-model HTTP errors degrade without rotating ---------------------- */
  mode = "server-error";
  calls = [];
  const originalError = console.error;
  const errors: string[] = [];
  console.error = (...args) => errors.push(args.join(" "));
  const degraded = await parse("When loan approved assign Wael");
  console.error = originalError;
  t("HTTP 500 degrades to heuristic", degraded.engine === "heuristic");
  t("HTTP 500 does not rotate models", calls.length === 1, JSON.stringify(calls));
  t("HTTP 500 fallback is logged", errors.some((error) => error.includes("Gemini HTTP 500")));
  t("degraded response still contains a valid draft", degraded.rule !== null);
  t("degraded response explains the fallback", degraded.notes.some((note) => note.includes("deterministic parser")));

  /* ---- missing key delegates directly, with no fetch ----------------------- */
  delete process.env.GEMINI_API_KEY;
  calls = [];
  const noKey = await parse("When loan approved assign Wael");
  t("missing key selects heuristic", noKey.engine === "heuristic");
  t("missing key performs no Gemini fetch", calls.length === 0);

  if (failures) {
    console.error(`\n${failures} parse-ai assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll parse-ai assertions passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
