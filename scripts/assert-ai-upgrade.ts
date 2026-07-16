/**
 * Phase 10 AI upgrade assertions — no network calls.
 * Run: npx tsx scripts/assert-ai-upgrade.ts
 */
import type { UnresolvedSlot } from "../lib/nlParser";
import type { RuleCondition, WorkflowRule } from "../lib/vocabulary";

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
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${!condition && detail ? ` - ${detail}` : ""}`);
}

function leaves(rule: WorkflowRule | null | undefined): RuleCondition[] {
  const walk = (node: WorkflowRule["conditions"]): RuleCondition[] =>
    node.children.flatMap((child) => ("children" in child ? walk(child) : [child]));
  return rule ? walk(rule.conditions) : [];
}

/** The model named in a generateContent URL. */
function modelOf(url: string): string {
  return url.match(/\/models\/([^:]+):generateContent/)?.[1] ?? url;
}

const COVENANT_INSTRUCTION =
  "When a scheduled covenant review fires and days since financials pulled is worse than 90 days, notify Omar after 2 days";

const geminiPayload = {
  rule: {
    schemaVersion: 3,
    triggers: [{ event: "SCHEDULED COVENANT REVIEW" }],
    conditions: {
      logic: "AND",
      children: [{ field: "days_since_financials_pulled", operator: "gt", value: "90" }],
    },
    actions: [
      {
        action: "notify",
        params: { value: { level: "instance", id: "u-omar", label: "Omar" } },
        delayMinutes: 2880,
      },
    ],
    controls: {
      mode: "shadow",
      oncePerRequest: true,
      maxFiresPerHour: 25,
      missingData: "no_match",
      priority: 100,
    },
  },
  notes: [
    "Configured covenant review trigger.",
    "Translated 'after 2 days' to delayMinutes 2880.",
  ],
  suggestions: [],
  unresolved: [],
  uncovered: [],
};

// The route reads GEMINI_MODEL into a module-level const, so the override must
// be unset before the dynamic import in main().
process.env.GEMINI_API_KEY = "test-key";
delete process.env.GEMINI_MODEL;
process.env.LANDJOURNEY_API_BASE = "";
process.env.LANDJOURNEY_API_TOKEN = "";
process.env.LANDJOURNEY_ORG_ID = "";

function ok(): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiPayload) }] } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

const calls: string[] = [];
let systemInstruction = "";
let respond: (model: string) => Response = () => ok();

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : input.toString();
  calls.push(url);
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    systemInstruction?: { parts?: Array<{ text?: string }> };
  };
  systemInstruction = body.systemInstruction?.parts?.map((part) => part.text ?? "").join("") ?? "";
  return respond(modelOf(url));
}) as typeof fetch;

type Route = { POST: (req: Request) => Promise<Response> };

function post(route: Route, instruction: string): Promise<Response> {
  return route.POST(
    new Request("http://local/api/workflows/parse-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    })
  );
}

async function main() {
  const imported = (await import("../app/api/workflows/parse-ai/route")) as unknown as {
    POST?: (req: Request) => Promise<Response>;
    default?: { POST?: (req: Request) => Promise<Response> };
  };
  const POST = imported.POST ?? imported.default?.POST;
  if (typeof POST !== "function") throw new Error("parse-ai route did not export POST");
  const route: Route = { POST };

  /* ---- Gemini 3.5 Flash parses SLA delays and covenant vocabulary ---- */
  const parsed = (await (await post(route, COVENANT_INSTRUCTION)).json()) as ParseAiResponse;
  const covenantLeaf = leaves(parsed.rule).find((leaf) => leaf.field === "days_since_financials_pulled");

  t("Gemini 3.5 Flash is the first default candidate", modelOf(calls[0] ?? "") === "gemini-3.5-flash", calls[0]);
  t("system prompt teaches action delayMinutes", systemInstruction.includes("delayMinutes"));
  t("system prompt includes the 2-day conversion", systemInstruction.includes("2880"));
  t("system prompt includes the 24-hour conversion", systemInstruction.includes("1440"));
  t("system prompt includes the 3-day conversion", systemInstruction.includes("4320"));
  t("system prompt teaches scheduled covenant reviews", systemInstruction.includes("SCHEDULED COVENANT REVIEW"));
  t("system prompt names the covenant fields", systemInstruction.includes("days_since_financials_pulled"));
  t("Gemini response remains on Gemini engine", parsed.engine === "gemini");
  t("delayed action preserves delayMinutes through normalize", parsed.rule?.actions[0]?.delayMinutes === 2880, JSON.stringify(parsed.rule?.actions));
  t("covenant trigger compiles", parsed.rule?.triggers[0]?.event === "SCHEDULED COVENANT REVIEW", JSON.stringify(parsed.rule?.triggers));
  t("covenant field maps to gt 90", covenantLeaf?.operator === "gt" && covenantLeaf.value === "90", JSON.stringify(covenantLeaf));
  t("known assignee Omar survives the boundary check", parsed.unresolved.length === 0, JSON.stringify(parsed.unresolved));

  /* ---- Fall-through on model-level unavailability, in candidate order ----
   * Also pins the candidate list to models ListModels actually serves: a name
   * that 404s permanently (gemini-3.5-flash-lite, named in the Phase 10 spec,
   * is one) burns a round-trip per fall-through and never serves traffic. */
  calls.length = 0;
  const unavailable: Record<string, number> = { "gemini-3.5-flash": 503, "gemini-3.1-flash-lite": 429 };
  respond = (model) =>
    unavailable[model]
      ? new Response(`{"error":{"code":${unavailable[model]}}}`, { status: unavailable[model] })
      : ok();

  const fellThrough = (await (await post(route, COVENANT_INSTRUCTION)).json()) as ParseAiResponse;
  t("503 then 429 falls through to a live candidate", fellThrough.engine === "gemini", JSON.stringify(calls.map(modelOf)));
  t(
    "candidates are tried once each, newest-first, alias last",
    calls.map(modelOf).join(",") === "gemini-3.5-flash,gemini-3.1-flash-lite,gemini-flash-latest",
    JSON.stringify(calls.map(modelOf))
  );

  /* ---- All candidates unavailable degrades to the deterministic parser ---- */
  calls.length = 0;
  respond = () => new Response('{"error":{"code":404}}', { status: 404 });

  const degraded = (await (await post(route, COVENANT_INSTRUCTION)).json()) as ParseAiResponse;
  t("all candidates unavailable degrades to the heuristic parser", degraded.engine === "heuristic", degraded.engine);
  t("degrade exhausts every candidate before giving up", calls.length === 3, JSON.stringify(calls.map(modelOf)));
  t(
    "degrade tells the user the AI parser was unreachable",
    degraded.notes[0]?.includes("could not reach the AI parser") === true,
    JSON.stringify(degraded.notes[0])
  );

  if (failures) {
    console.error(`\n${failures} AI upgrade assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll AI upgrade assertions passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
