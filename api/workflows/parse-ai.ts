/**
 * POST /api/workflows/parse-ai — natural-language instruction → ParseResult.
 *
 * Port of the production Gemini route preserved at git tag
 * `vercel-track-final` (app/api/workflows/parse-ai/route.ts), adapted to the
 * NORMATIVE contract in docs/parser-ai-backend-contract.md:
 *
 *   Request  { text: string, options?: ParseOptions }
 *            (the donor read { instruction, forceEvent }; forceEvent now rides
 *            in options, alongside assignees/instanceOptions/instanceRegistry)
 *   200      ParseResult / ParseEnvelope — `rule` + the honesty sidecars
 *            (notes, unresolved, uncovered, ambiguities) the client
 *            shape-guards, plus optional `suggestions` (max 3) + `provenance`.
 *   400      { error: string } — hostile/malformed input (never silently truncated)
 *   405      { error: "method-not-allowed" }
 *
 * Vocabulary/grounding comes from the request `options` — the donor's live
 * platform-vocabulary fetch is deliberately gone. The client treats the
 * candidate as HOSTILE and re-reviews it (shape, allowlists, re-grounding)
 * before anything reaches the composer, so this endpoint's own
 * `enforceKnownAssignees` pass is a first line, not the last.
 *
 * Degrade path: missing GEMINI_API_KEY, model-chain exhaustion, or any decode
 * defect returns the deterministic parser's result for the same text/options
 * with provenance.engine = "deterministic-fallback" — the endpoint answers
 * before the client's own timeout would fire.
 */
import type { ApiRequest, ApiResponse } from "../_lib/http";
import {
  callGeminiChain,
  extractGeminiText,
  geminiApiKey,
  stripJsonFence,
  type GeminiRequestBody,
} from "../_lib/gemini";
import { cleanPromptText, limitItems, stripHostileCharacters } from "../_lib/sanitize";
// Imports target the concrete rule-core modules rather than the src/index.ts
// barrel: the barrel currently re-exports a colliding `actionPhrase` from two
// modules (TS2308), and this endpoint must typecheck without editing packages/.
import {
  ACTIONS,
  ASSIGNEES,
  EVENTS,
  FIELDS,
  OPERATORS,
  SCOPED_FIELDS,
  SCOPED_PARAMS,
  defaultControls,
  getAction,
  normalizeRule,
  paramKeyFor,
  type WorkflowRule,
} from "../../packages/rule-core/src/vocabulary";
import {
  parseInstruction,
  type ParseAmbiguity,
  type ParseOptions,
  type ParseResult,
  type UnresolvedSlot,
} from "../../packages/rule-core/src/nlParser";
import { hasBlockingIssues, lintRuleIssues } from "../../packages/rule-core/src/ruleLinter";
import { validateRule } from "../../packages/rule-core/src/ruleValidation";
import { fuzzyMatches } from "../../packages/rule-core/src/fuzzy";
import {
  PARSER_ENGINE_VERSION,
  makeEnvelope,
  type ParseEnvelope,
} from "../../packages/rule-core/src/parserProvenance";

/** Stamped into provenance by server code — never taken from model output. */
const PROMPT_VERSION = "p1";

// Per-attempt cap on a single model, and a wall-clock ceiling across the whole
// candidate chain. The chain total must fit inside `maxDuration` (60s via
// vercel.json), so it can't be (per-model × candidates): two 25s attempts
// already reach the 50s budget, and a third is skipped rather than run past the
// serverless deadline. JSON-mode drafts measured 1.6-2.3s median on a healthy
// model; 25s is generous headroom, not the expected latency. See
// api/_lib/gemini.ts `geminiModelChain` for why a slow model matters.
const GEMINI_PER_MODEL_TIMEOUT_MS = 25_000;
const GEMINI_TOTAL_BUDGET_MS = 50_000;

/** Contract limits — reject with 400, never truncate silently. */
const MAX_TEXT_CHARS = 4_000;
const MAX_LIST_ENTRIES = 200;
const MAX_LABEL_CHARS = 120;

/**
 * Gemini REST API responseSchema — OpenAPI Schema Object subset.
 *
 * Constrains the model's JSON output to the parse envelope so structural
 * drift (wrong keys, missing fields, extra nesting) is caught by the API
 * itself before our coerce layer runs. massageGeminiRule and
 * coerceGeminiPayload remain as safety nets for value-level corrections
 * (e.g. lowercase logic, {key} vs {event}).
 *
 * Gemini structured output only supports a subset of JSON Schema:
 * - No `oneOf`/`anyOf` — use nullable OBJECT instead
 * - `enum` allowed on STRING
 * - ARRAY requires `items`
 * - Top-level must be OBJECT
 */
const PARSE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    rule: {
      type: "OBJECT",
      nullable: true,
      description: "The parsed WorkflowRule, or null if the instruction could not be parsed.",
      properties: {
        schemaVersion: { type: "INTEGER", description: "Always 3." },
        triggers: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              event: { type: "STRING", description: "Event key from the vocabulary." },
              scope: {
                type: "OBJECT",
                nullable: true,
                description: "Optional scope narrowing the trigger.",
                properties: {
                  level: { type: "STRING", enum: ["any", "category", "instance"] },
                  category: { type: "STRING", description: "Category name when level=category." },
                  id: { type: "STRING", description: "Instance ID when level=instance." },
                  label: { type: "STRING", description: "Display label when level=instance." },
                },
                required: ["level"],
              },
            },
            required: ["event"],
          },
        },
        conditions: {
          type: "OBJECT",
          description: "Root condition group (recursive AND/OR tree).",
          properties: {
            logic: { type: "STRING", enum: ["AND", "OR"] },
            children: {
              type: "ARRAY",
              description:
                "Condition leaves or nested groups. Leaves have field+operator+value; groups have logic+children.",
              items: {
                type: "OBJECT",
                properties: {
                  field: { type: "STRING", description: "Condition field key." },
                  operator: { type: "STRING", description: "Comparison operator." },
                  value: { type: "STRING", description: "Comparison value (string form)." },
                  logic: { type: "STRING", enum: ["AND", "OR"], description: "Present only for nested groups." },
                  children: { type: "ARRAY", description: "Present only for nested groups.", items: { type: "OBJECT" } },
                },
              },
            },
          },
          required: ["logic", "children"],
        },
        actions: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              action: { type: "STRING", description: "Action key from the vocabulary." },
              params: { type: "OBJECT", description: "Action parameters. Keys and values depend on the action." },
              delayMinutes: { type: "INTEGER", nullable: true, description: "SLA delay in minutes before action executes." },
              onFailure: { type: "STRING", nullable: true, enum: ["retry", "skip", "halt"] },
            },
            required: ["action", "params"],
          },
        },
        else: {
          type: "ARRAY",
          nullable: true,
          description: "Actions to run when triggers match but conditions do not.",
          items: {
            type: "OBJECT",
            properties: {
              action: { type: "STRING" },
              params: { type: "OBJECT" },
              delayMinutes: { type: "INTEGER", nullable: true },
              onFailure: { type: "STRING", nullable: true, enum: ["retry", "skip", "halt"] },
            },
            required: ["action", "params"],
          },
        },
        controls: {
          type: "OBJECT",
          properties: {
            mode: { type: "STRING", enum: ["shadow", "armed"] },
            oncePerRequest: { type: "BOOLEAN" },
            maxFiresPerHour: { type: "INTEGER" },
            missingData: { type: "STRING", enum: ["no_match", "alert"] },
            priority: { type: "INTEGER" },
            abSplit: {
              type: "OBJECT",
              nullable: true,
              properties: {
                targetWorkflowId: { type: "STRING" },
                weightPercent: { type: "NUMBER" },
              },
              required: ["targetWorkflowId", "weightPercent"],
            },
          },
          required: ["mode", "oncePerRequest", "maxFiresPerHour", "missingData", "priority"],
        },
      },
      required: ["schemaVersion", "triggers", "conditions", "actions", "controls"],
    },
    notes: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Human-readable notes explaining the parse choices.",
    },
    suggestions: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "At most 3 short clickable refinement chips.",
    },
    unresolved: {
      type: "ARRAY",
      description: "Slots the parser could not resolve to a known vocabulary item.",
      items: {
        type: "OBJECT",
        properties: {
          where: { type: "STRING", enum: ["action-param", "condition-value", "event"] },
          lane: { type: "STRING", nullable: true, enum: ["then", "else"] },
          actionIndex: { type: "INTEGER", nullable: true },
          conditionIndex: { type: "INTEGER", nullable: true },
          param: { type: "STRING", nullable: true },
          heard: { type: "STRING", description: "The raw text the user wrote." },
          suggestions: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["where", "heard", "suggestions"],
      },
    },
    uncovered: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Input fragments the parser did not consume or represent in the rule.",
    },
    ambiguities: {
      type: "ARRAY",
      description: "Questions for the user when the parse is ambiguous.",
      items: {
        type: "OBJECT",
        properties: {
          question: { type: "STRING" },
          options: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["question", "options"],
      },
    },
  },
  required: ["rule", "notes", "suggestions", "unresolved", "uncovered"],
} as const;

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method-not-allowed" });
    return;
  }

  const parsed = sanitizeParseBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const started = Date.now();
  if (!geminiApiKey()) {
    res
      .status(200)
      .json(heuristicResponse(parsed.text, parsed.options, started, "GEMINI_API_KEY is not configured"));
    return;
  }

  try {
    res.status(200).json(await geminiParse(parsed.text, parsed.options, started));
  } catch (error) {
    const reason = fallbackReasonFrom(error);
    // Outcome class only — production logs must not carry author text, prompts,
    // or raw provider responses (contract "Logging" section).
    console.error(`Gemini parse failed (${reason}); falling back to deterministic parser.`);
    const fallback = heuristicResponse(parsed.text, parsed.options, started, reason);
    fallback.notes = [
      "I could not reach the AI parser just now, so I used the deterministic parser instead.",
      ...fallback.notes,
    ];
    res.status(200).json(fallback);
  }
}

/** Collapse any failure into a class label safe for logs and provenance. */
function fallbackReasonFrom(error: unknown): string {
  if (error && typeof error === "object" && "name" in error && (error as { name: unknown }).name === "AbortError") {
    return "timeout";
  }
  if (error instanceof SyntaxError) return "invalid-model-json";
  const message = error instanceof Error ? error.message : String(error);
  const http = /^Gemini HTTP (\d+)/.exec(message);
  if (http) return `gemini-http-${http[1]}`;
  if (message.includes("no content")) return "empty-model-response";
  if (message.includes("not configured")) return "not-configured";
  return error instanceof Error ? `error:${error.name}` : "unknown";
}

/* -------------------------------------------------------------------------- */
/* Request sanitization (contract: reject with 400, never truncate silently)  */
/* -------------------------------------------------------------------------- */

function sanitizeParseBody(body: unknown): { text: string; options: ParseOptions } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid JSON body" };
  const obj = body as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "text" && key !== "options") {
      return { error: `Unknown property: ${cleanPromptText(key).slice(0, 32)}` };
    }
  }
  if (typeof obj.text !== "string") return { error: "text is required" };
  const text = stripHostileCharacters(obj.text);
  if (!text.trim()) return { error: "text is required" };
  if (text.length > MAX_TEXT_CHARS) return { error: `text exceeds ${MAX_TEXT_CHARS} characters` };

  const options = sanitizeOptions(obj.options);
  if (typeof options === "string") return { error: options };
  return { text, options };
}

/** Rebuild ParseOptions field by field; unknown option keys are dropped. */
function sanitizeOptions(raw: unknown): ParseOptions | string {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return "options must be an object";
  const o = raw as Record<string, unknown>;
  const out: ParseOptions = {};

  if (o.forceEvent !== undefined) {
    const forceEvent = cleanLabel(o.forceEvent);
    if (forceEvent === null) return `options.forceEvent must be a string of at most ${MAX_LABEL_CHARS} characters`;
    out.forceEvent = forceEvent;
  }

  if (o.assignees !== undefined) {
    const assignees = cleanLabelList(o.assignees);
    if (typeof assignees === "string") return `options.assignees ${assignees}`;
    out.assignees = assignees;
  }

  if (o.instanceOptions !== undefined) {
    if (!isPlainObject(o.instanceOptions)) return "options.instanceOptions must be an object";
    const map: Record<string, string[]> = {};
    for (const [key, list] of Object.entries(o.instanceOptions)) {
      const cleanKey = cleanLabel(key);
      if (cleanKey === null || !cleanKey) return "options.instanceOptions has an invalid key";
      const labels = cleanLabelList(list);
      if (typeof labels === "string") return `options.instanceOptions["${cleanKey}"] ${labels}`;
      map[cleanKey] = labels;
    }
    out.instanceOptions = map;
  }

  if (o.instanceRegistry !== undefined) {
    if (!isPlainObject(o.instanceRegistry)) return "options.instanceRegistry must be an object";
    const map: Record<string, { id: string; label: string }[]> = {};
    for (const [key, list] of Object.entries(o.instanceRegistry)) {
      const cleanKey = cleanLabel(key);
      if (cleanKey === null || !cleanKey) return "options.instanceRegistry has an invalid key";
      const entries = cleanRegistryList(list);
      if (typeof entries === "string") return `options.instanceRegistry["${cleanKey}"] ${entries}`;
      map[cleanKey] = entries;
    }
    out.instanceRegistry = map;
  }

  if (o.allowUnbackedValues !== undefined) {
    if (typeof o.allowUnbackedValues !== "boolean") return "options.allowUnbackedValues must be a boolean";
    out.allowUnbackedValues = o.allowUnbackedValues;
  }

  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = stripHostileCharacters(value);
  return clean.length > MAX_LABEL_CHARS ? null : clean;
}

function cleanLabelList(value: unknown): string[] | string {
  if (!Array.isArray(value)) return "must be an array";
  if (value.length > MAX_LIST_ENTRIES) return `exceeds ${MAX_LIST_ENTRIES} entries`;
  const out: string[] = [];
  for (const item of value) {
    const label = cleanLabel(item);
    if (label === null) return `has an entry that is not a string of at most ${MAX_LABEL_CHARS} characters`;
    out.push(label);
  }
  return out;
}

function cleanRegistryList(value: unknown): Array<{ id: string; label: string }> | string {
  if (!Array.isArray(value)) return "must be an array";
  if (value.length > MAX_LIST_ENTRIES) return `exceeds ${MAX_LIST_ENTRIES} entries`;
  const out: Array<{ id: string; label: string }> = [];
  for (const item of value) {
    if (!isPlainObject(item)) return "has a non-object entry";
    const id = cleanLabel(item.id ?? "");
    const label = cleanLabel(item.label);
    if (id === null || label === null) {
      return `has an entry without a valid id/label (strings of at most ${MAX_LABEL_CHARS} characters)`;
    }
    out.push({ id, label });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Deterministic degrade (donor `heuristicResponse`)                          */
/* -------------------------------------------------------------------------- */

/**
 * The deterministic parser, fed the same request-supplied vocabulary the AI
 * path grounds against (assignees, option lists, id-bearing registries) so
 * the fallback keeps full reject-don't-coerce and ScopeRef-emit quality.
 */
function heuristicResponse(
  text: string,
  options: ParseOptions,
  started: number,
  fallbackReason: string
): ParseEnvelope {
  const result = parseInstruction(text, options);
  const lintIssues = result.rule ? lintRuleIssues(result.rule, {}) : [];
  const notes = [
    ...result.notes,
    ...lintIssues.map((issue) =>
      issue.severity === "warning"
        ? `I also noticed a lint note: ${issue.message}`
        : `I also noticed a lint error: ${issue.message}`
    ),
  ];

  const base: ParseResult = {
    ...result,
    rule: hasBlockingIssues(lintIssues) ? null : result.rule,
    notes,
  };
  return makeEnvelope(base, {
    suggestions: [],
    provenance: {
      engine: "deterministic-fallback",
      parserVersion: PARSER_ENGINE_VERSION,
      generation: 0,
      createdAt: Date.now(),
      latency: { totalMs: Date.now() - started, stages: {} },
      fallbackReason,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Gemini path                                                                */
/* -------------------------------------------------------------------------- */

async function geminiParse(text: string, options: ParseOptions, started: number): Promise<ParseEnvelope> {
  const context = buildPromptContext(options);
  const body: GeminiRequestBody = {
    systemInstruction: {
      parts: [{ text: buildSystemInstruction(context) }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: JSON.stringify({
              instruction: text,
              forceEvent: options.forceEvent ?? null,
            }),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: PARSE_RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  };

  const modelStarted = Date.now();
  const { model, data } = await callGeminiChain(body, GEMINI_PER_MODEL_TIMEOUT_MS, GEMINI_TOTAL_BUDGET_MS);
  const modelMs = Date.now() - modelStarted;

  const rawText = extractGeminiText(data);
  if (process.env.PARSE_AI_DEBUG === "1") console.log("[parse-ai raw]", rawText.slice(0, 2000));
  const parsed = JSON.parse(stripJsonFence(rawText)) as unknown;

  const normalizeStarted = Date.now();
  const coerced = coerceGeminiPayload(parsed, context);
  return makeEnvelope(
    {
      rule: coerced.rule,
      notes: coerced.notes,
      unresolved: coerced.unresolved,
      uncovered: coerced.uncovered,
      ambiguities: coerced.ambiguities,
    },
    {
      suggestions: coerced.suggestions,
      provenance: {
        engine: "ai",
        parserVersion: PARSER_ENGINE_VERSION,
        promptVersion: PROMPT_VERSION,
        provider: "google",
        model,
        generation: 0,
        createdAt: Date.now(),
        latency: {
          totalMs: Date.now() - started,
          stages: { model: modelMs, normalize: Date.now() - normalizeStarted },
        },
      },
    }
  );
}

type CoercedParse = {
  rule: WorkflowRule | null;
  notes: string[];
  suggestions: string[];
  unresolved: UnresolvedSlot[];
  uncovered: string[];
  ambiguities: ParseAmbiguity[];
};

function coerceGeminiPayload(raw: unknown, context: PromptContext): CoercedParse {
  if (!raw || typeof raw !== "object") throw new Error("Gemini JSON was not an object.");
  const obj = raw as Record<string, unknown>;
  const notes = stringArray(obj.notes);
  const suggestions = stringArray(obj.suggestions).slice(0, 3);
  const unresolved = unresolvedArray(obj.unresolved);
  const uncovered = stringArray(obj.uncovered);
  const ambiguities = ambiguityArray(obj.ambiguities);

  let rule: WorkflowRule | null = null;
  if (obj.rule !== null && obj.rule !== undefined) {
    const normalized = normalizeRule(massageGeminiRule(obj.rule));
    enforceKnownAssignees(normalized, context, unresolved, notes);
    const validation = validateRule(normalized);
    const lintIssues = lintRuleIssues(normalized, {});
    rule = validation.rule && !hasBlockingIssues(lintIssues) ? validation.rule : null;
    for (const issue of validation.issues.filter((i) => i.severity === "error")) {
      notes.push(`I drafted a rule shape, but it needs one fix before saving: ${issue.message}`);
    }
    for (const issue of lintIssues) {
      notes.push(
        issue.severity === "warning"
          ? `I also noticed a lint note: ${issue.message}`
          : `I also noticed a lint error: ${issue.message}`
      );
    }
  }

  return { rule, notes, suggestions, unresolved, uncovered, ambiguities };
}

/**
 * Tolerate common LLM shape drift before normalizeRule (observed live):
 * the vocabulary snapshot names events/actions by `key`, and models mirror it —
 * `triggers:[{key}]` for `[{event}]`, `actions:[{key,value}]` for
 * `[{action, params}]`, lowercase logic (which normalize would flip OR→AND).
 * Purely additive: well-formed rules pass through untouched.
 */
function massageGeminiRule(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const rule = { ...(raw as Record<string, unknown>) };

  // triggers: accept "EVENT", {key}, {name} → {event}; keep scope when present.
  if (Array.isArray(rule.triggers)) {
    rule.triggers = rule.triggers.map((t) => {
      if (typeof t === "string") return { event: t };
      if (t && typeof t === "object") {
        const o = t as Record<string, unknown>;
        const event = o.event ?? o.key ?? o.name;
        if (typeof event === "string") return { ...o, event };
      }
      return t;
    });
  }

  // conditions: uppercase logic recursively ("or" must not silently become AND).
  rule.conditions = fixGroupLogic(rule.conditions);

  // actions/else: accept {key} → action; {value}/{param}/string params → params map.
  for (const lane of ["actions", "else"] as const) {
    const list = rule[lane];
    if (!Array.isArray(list)) continue;
    rule[lane] = list.map((a) => {
      if (!a || typeof a !== "object") return a;
      const o = { ...(a as Record<string, unknown>) };
      const action = o.action ?? o.key ?? o.name;
      if (typeof action !== "string") return a;
      o.action = action;
      delete o.key;
      const pk = getAction(action) ? paramKeyFor(action) : "value";
      if (o.params == null || typeof o.params !== "object") {
        const inline = o.params ?? o.value ?? o.param ?? o.target ?? o.assignee;
        o.params = inline != null && inline !== "" ? { [pk]: inline } : {};
        delete o.value;
        delete o.param;
        delete o.target;
        delete o.assignee;
      }
      return o;
    });
  }

  return rule;
}

function fixGroupLogic(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  const g = { ...(node as Record<string, unknown>) };
  if (typeof g.logic === "string") g.logic = g.logic.toUpperCase();
  if (Array.isArray(g.children)) {
    g.children = g.children.map((c) =>
      c && typeof c === "object" && Array.isArray((c as Record<string, unknown>).children)
        ? fixGroupLogic(c)
        : c
    );
  }
  return g;
}

/**
 * Enforce reject-don't-coerce at the LLM boundary. Unknown people or teams
 * become unresolved slots instead of surviving as fabricated action params.
 */
function enforceKnownAssignees(
  rule: WorkflowRule,
  context: PromptContext,
  unresolved: UnresolvedSlot[],
  notes: string[]
): void {
  const known = [...context.users.map((u) => u.label), ...ASSIGNEES];
  const knownIds = new Set(context.users.map((u) => u.id).filter(Boolean));
  const knownLower = new Set(known.map((label) => label.trim().toLowerCase()));

  const check = (lane: "actions" | "else", list: WorkflowRule["actions"]) => {
    list.forEach((action, index) => {
      if (action.action !== "assign_user" && action.action !== "notify") return;
      const key = paramKeyFor(action.action);
      const value = action.params[key];
      if (value == null || value === "") return;

      let heard: string | null = null;
      if (typeof value === "string") {
        if (!knownLower.has(value.trim().toLowerCase())) heard = value;
      } else if (value.level === "instance") {
        // With an id-bearing registry supplied, the id is the only thing that
        // resolves — a model that invents one has invented the person, even if
        // the label happens to read like a real name. Without one, every known
        // assignee is a static label with no id, so any id the model emits is
        // fabricated: blank it rather than let a made-up id reach the schema.
        const liveUsersConfigured = context.users.some((u) => u.id !== "");
        if (liveUsersConfigured) {
          if (!knownIds.has(value.id)) heard = value.label;
        } else if (!knownLower.has(value.label.trim().toLowerCase())) {
          heard = value.label;
        } else if (value.id !== "") {
          value.id = "";
        }
      } else if (
        value.level === "category" &&
        !knownLower.has(value.category.trim().toLowerCase())
      ) {
        heard = value.category;
      }
      if (heard === null) return;

      action.params[key] = "";
      unresolved.push({
        where: "action-param",
        lane: lane === "else" ? "else" : "then",
        actionIndex: index,
        param: key,
        heard,
        suggestions: fuzzyMatches(heard, known),
      });
      notes.push(
        `I don't know "${heard}" — pick a real person or team for that ${
          action.action === "notify" ? "notification" : "assignment"
        }.`
      );
    });
  };

  check("actions", rule.actions);
  check("else", rule.else ?? []);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

function unresolvedArray(value: unknown): UnresolvedSlot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((slot) => {
    if (!slot || typeof slot !== "object") return [];
    const s = slot as Record<string, unknown>;
    if (s.where !== "action-param" && s.where !== "condition-value" && s.where !== "event") return [];
    if (typeof s.heard !== "string") return [];
    return [
      {
        where: s.where,
        lane: s.lane === "then" || s.lane === "else" ? s.lane : undefined,
        actionIndex: typeof s.actionIndex === "number" ? s.actionIndex : undefined,
        conditionIndex: typeof s.conditionIndex === "number" ? s.conditionIndex : undefined,
        param: typeof s.param === "string" ? s.param : undefined,
        heard: s.heard,
        suggestions: stringArray(s.suggestions),
      },
    ];
  });
}

function ambiguityArray(value: unknown): ParseAmbiguity[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((amb) => {
    if (!amb || typeof amb !== "object") return [];
    const a = amb as Record<string, unknown>;
    if (typeof a.question !== "string") return [];
    return [{ question: a.question, options: stringArray(a.options) }];
  });
}

/* -------------------------------------------------------------------------- */
/* Prompt context (vocabulary from the REQUEST — no live platform fetch)      */
/* -------------------------------------------------------------------------- */

type PromptContext = ReturnType<typeof buildPromptContext>;

/**
 * The donor built this from a live platform-vocabulary fetch; here the
 * id-bearing registries and option lists arrive IN the request (`options`),
 * already sanitized. The client re-validates the candidate against its own
 * snapshot, so request-supplied grounding cannot widen what the client accepts.
 */
function buildPromptContext(options: ParseOptions) {
  const registry = options.instanceRegistry ?? {};
  const registryUsers = registry["assign_user"] ?? registry["team_member"] ?? registry["notify"] ?? [];
  const users = registryUsers.length
    ? registryUsers
    : (options.assignees?.length ? options.assignees : ASSIGNEES).map((label) => ({ id: "", label }));
  const templates = registry["template"] ?? [];
  const retailers = registry["retailer"] ?? [];
  const stages =
    registry["stage"] ??
    (options.instanceOptions?.["stage"] ?? FIELDS.stage.options ?? []).map((label) => ({ id: "", label }));

  return {
    schema: {
      version: 3,
      controlsDefault: defaultControls(),
      outputContract: {
        rule: "WorkflowRule | null",
        notes: "string[]",
        suggestions: "string[]",
        unresolved: "UnresolvedSlot[]",
        uncovered: "string[]",
      },
    },
    source: { kind: "request-options" },
    events: EVENTS.map((e) => ({
      key: e.key,
      label: e.label,
      confidence: e.confidence,
      conditionFields: e.condFields,
      allowsFormFields: e.allowsFormFields === true,
    })),
    fields: Object.values(FIELDS).map((f) => ({
      key: f.key,
      label: f.label,
      kind: f.kind,
      confidence: f.confidence,
      options: limitItems(options.instanceOptions?.[f.key] ?? f.options ?? []),
      operators: OPERATORS[f.kind],
    })),
    actions: ACTIONS.map((a) => ({
      key: a.key,
      label: a.label,
      confidence: a.confidence,
      paramKind: a.paramKind,
      paramLabel: a.paramLabel,
      paramOptions: a.paramOptions ?? [],
      execution: a.execution,
    })),
    scopedFields: SCOPED_FIELDS,
    scopedParams: SCOPED_PARAMS,
    teams: limitItems(ASSIGNEES.filter((a) => /team$/i.test(a)).map((t) => cleanPromptText(t))),
    users: limitItems(users).map((u) => ({
      id: cleanPromptText(u.id),
      label: cleanPromptText(u.label),
    })),
    templates: limitItems(templates).map((t) => ({ id: cleanPromptText(t.id), label: cleanPromptText(t.label) })),
    retailers: limitItems(retailers).map((r) => ({ id: cleanPromptText(r.id), label: cleanPromptText(r.label) })),
    templateStages: limitItems(stages).map((s) => ({ id: cleanPromptText(s.id), label: cleanPromptText(s.label) })),
    // The donor surfaced live platform form fields here; grounding now comes
    // from the request and the client re-validates form-field refs itself.
    liveFormFields: [] as Array<{
      formTemplateId: string;
      formName: string;
      fieldId: string;
      name: string;
      label: string;
      kind: string;
      required: boolean;
    }>,
  };
}

/* -------------------------------------------------------------------------- */
/* System instruction (donor verbatim — 6 few-shot examples + rules)          */
/* -------------------------------------------------------------------------- */

function buildSystemInstruction(context: PromptContext): string {
  return [
    "You are the Sweet Workflow Creator AI parser and a friendly expert credit policy coach.",
    "Convert the user's plain-English instruction into structured JSON only. Do not include markdown or commentary outside JSON.",
    "Return exactly this top-level shape: {\"rule\": WorkflowRule | null, \"notes\": string[], \"suggestions\": string[], \"unresolved\": UnresolvedSlot[], \"uncovered\": string[]}.",
    "WorkflowRule must use schemaVersion 3: triggers[], conditions {logic, children}, actions[], optional else[], and controls.",
    "Use EXACTLY these field names (do NOT copy the vocabulary snapshot's 'key' naming into the rule).",
    "Actions may include delayMinutes as a sibling of action and params. Parse SLA phrases like 'after 2 days', 'in 24 hours', and 'with a 3-day delay' into minutes: 2 days = 2880, 24 hours = 1440, 3 days = 4320.",
    "For covenant reviews, use trigger event SCHEDULED COVENANT REVIEW and the covenant fields days_since_financials_pulled, compliance_status, and covenant_type. For numeric age wording like 'worse than 90 days' or 'older than 90 days', use operator gt with value '90'.",
    "",
    "--- FEW-SHOT EXAMPLES ---",
    "Example 1: 'when a document is approved and checklists status is complete, assign to Wael'",
    JSON.stringify({
      rule: {
        schemaVersion: 3,
        triggers: [{ event: "DOCUMENT APPROVED" }],
        conditions: { logic: "AND", children: [
          { field: "checklist_status", operator: "is", value: "Complete" }
        ] },
        actions: [{ action: "assign_user", params: { assignee: { level: "instance", id: "u-wael", label: "Wael" } } }],
        controls: { mode: "shadow", oncePerRequest: true, maxFiresPerHour: 25, missingData: "no_match", priority: 100 }
      },
      notes: ["Matched trigger event DOCUMENT APPROVED.", "Added condition for checklist status is Complete.", "Routed assignment to Wael."],
      suggestions: ["Add a tag?", "Change stage instead?"],
      unresolved: [],
      uncovered: []
    }),
    "",
    "Example 2: 'when a loan is approved, if risk grade is A and amount is at least 150k route to Underwriting Team, otherwise change stage to Rejected'",
    JSON.stringify({
      rule: {
        schemaVersion: 3,
        triggers: [{ event: "LOAN APPROVED" }],
        conditions: { logic: "AND", children: [
          { field: "risk_grade", operator: "is", value: "A" },
          { field: "loan_amount", operator: "gte", value: "150000" }
        ] },
        actions: [{ action: "assign_user", params: { assignee: { level: "category", category: "Underwriting Team" } } }],
        else: [{ action: "change_stage", params: { value: "Rejected" } }],
        controls: { mode: "shadow", oncePerRequest: true, maxFiresPerHour: 25, missingData: "no_match", priority: 100 }
      },
      notes: ["Configured matching rule with trigger LOAN APPROVED.", "Structured dual routing lanes: else-branch reverts stage to Rejected when conditions fail."],
      suggestions: [],
      unresolved: [],
      uncovered: []
    }),
    "",
    "Example 3: 'when an offer is accepted, assign to omar and split 30% to target-uuid-444'",
    JSON.stringify({
      rule: {
        schemaVersion: 3,
        triggers: [{ event: "OFFER ACCEPTED" }],
        conditions: { logic: "AND", children: [] },
        actions: [{ action: "assign_user", params: { assignee: { level: "instance", id: "u-omar", label: "Omar" } } }],
        controls: {
          mode: "shadow",
          oncePerRequest: true,
          maxFiresPerHour: 25,
          missingData: "no_match",
          priority: 100,
          abSplit: {
            targetWorkflowId: "target-uuid-444",
            weightPercent: 30
          }
        }
      },
      notes: ["Staged A/B split-routing: 30% of traffic directed to alternative workflow."],
      suggestions: [],
      unresolved: [],
      uncovered: []
    }),
    "",
    "Example 4: 'when a loan is approved, notify Wael after 2 days'",
    JSON.stringify({
      rule: {
        schemaVersion: 3,
        triggers: [{ event: "LOAN APPROVED" }],
        conditions: { logic: "AND", children: [] },
        actions: [
          {
            action: "notify",
            params: { value: { level: "instance", id: "u-wael", label: "Wael" } },
            delayMinutes: 2880,
          }
        ],
        controls: { mode: "shadow", oncePerRequest: true, maxFiresPerHour: 25, missingData: "no_match", priority: 100 }
      },
      notes: ["Configured approval notification for Wael.", "Translated 'after 2 days' to delayMinutes 2880."],
      suggestions: [],
      unresolved: [],
      uncovered: []
    }),
    "",
    "Example 5: 'when a scheduled covenant review fires, if days since financials pulled is worse than 90 days, notify Omar'",
    JSON.stringify({
      rule: {
        schemaVersion: 3,
        triggers: [{ event: "SCHEDULED COVENANT REVIEW" }],
        conditions: {
          logic: "AND",
          children: [
            { field: "days_since_financials_pulled", operator: "gt", value: "90" }
          ]
        },
        actions: [
          { action: "notify", params: { value: { level: "instance", id: "u-omar", label: "Omar" } } }
        ],
        controls: { mode: "shadow", oncePerRequest: true, maxFiresPerHour: 25, missingData: "no_match", priority: 100 }
      },
      notes: ["Configured covenant review trigger.", "Added condition for financials pulled offset exceeding 90 days."],
      suggestions: [],
      unresolved: [],
      uncovered: []
    }),
    "",
    "Example 6: 'when a loan is approved or rejected and loan amount over 500k, escalate to the credit committee and add tag jumbo'",
    JSON.stringify({
      rule: {
        schemaVersion: 3,
        triggers: [{ event: "LOAN APPROVED" }, { event: "LOAN REJECTED" }],
        conditions: {
          logic: "AND",
          children: [
            { field: "loan_amount", operator: "gt", value: "500000" }
          ]
        },
        actions: [
          { action: "assign_authority", params: { value: "Credit Committee" } },
          { action: "add_tag", params: { value: "jumbo" } }
        ],
        controls: {
          mode: "shadow",
          oncePerRequest: true,
          maxFiresPerHour: 25,
          missingData: "no_match",
          priority: 100
        }
      },
      notes: [
        "Captured the compound trigger as two OR'd events.",
        "Translated 'over 500k' into a gt 500000 condition.",
        "Added authority escalation plus jumbo tagging."
      ],
      suggestions: [],
      unresolved: [],
      uncovered: []
    }),
    "-------------------------",
    "",
    "Triggers use {event}. Actions use {action, params}. The assign_user param key is 'assignee'; every other action's param key is 'value'. Logic is uppercase AND/OR.",
    "Default controls to shadow mode, oncePerRequest true, maxFiresPerHour 25, missingData no_match, priority 100 unless the user clearly asks otherwise.",
    "When the user explicitly says to arm, activate, or enable live actions (for example, 'arm this rule'), set controls.mode to 'armed' and explain that choice in notes.",
    "Use only event keys, field keys, operators, action keys, and enum values from activeVocabulary. Never invent platform IDs.",
    "When a user or stage/template/retailer exactly matches an id-bearing activeVocabulary record, emit a ScopeRef instance {level:'instance', id, label}.",
    "When the wording names a category like a request type, customer type, global stage, or team, emit {level:'category', category}. Use {level:'any'} only for explicit any/all scope language.",
    "If a value is plausible but not an exact available option, leave the slot unresolved and include fuzzy-looking suggestions from activeVocabulary rather than fabricating.",
    "For text tags and truly free-text document/checklist names, legacy string values are allowed.",
    "Respect forceEvent when it is provided. Otherwise ask through unresolved/event or return rule null if the trigger is ambiguous.",
    "Put any meaningful unparsed instruction fragments in uncovered.",
    "notes must be warm, personable, and explain the choices made. suggestions must be at most 3 short clickable refinement chips, such as 'Assign to Wael?' or 'Add a high-risk tag?'.",
    `Active vocabulary snapshot: ${JSON.stringify(context)}`,
  ].join("\n");
}
