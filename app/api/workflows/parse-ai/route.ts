import { NextRequest, NextResponse } from "next/server";
import { parseInstruction, type ParseAmbiguity, type ParseOptions, type UnresolvedSlot } from "@/lib/nlParser";
import {
  ACTIONS,
  ASSIGNEES,
  EVENTS,
  FIELDS,
  OPERATORS,
  SCOPED_FIELDS,
  SCOPED_PARAMS,
  WorkflowRule,
  defaultControls,
  getAction,
  normalizeRule,
  paramKeyFor,
} from "@/lib/vocabulary";
import { fetchLiveVocabulary, platformConfigured } from "@/lib/platform";
import { buildOverlay, fieldKindForType, type VocabOverlay, type VocabularySource } from "@/lib/liveVocabulary";
import { hasBlockingIssues, lintRuleIssues } from "@/lib/ruleLinter";
import { validateRule } from "@/lib/ruleValidation";
import { fuzzyMatches } from "@/lib/fuzzy";

export const dynamic = "force-dynamic";

type ParseAiBody = { instruction?: string; forceEvent?: string };

type ParseAiResponse = {
  rule: WorkflowRule | null;
  notes: string[];
  suggestions: string[];
  unresolved: UnresolvedSlot[];
  uncovered: string[];
  ambiguities: ParseAmbiguity[];
  engine: "gemini" | "heuristic";
};

type GeminiPart = { text?: string };
type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};

/**
 * Model selection: `GEMINI_MODEL` env override, else the `gemini-flash-latest`
 * alias — Google retires pinned model names for new users (the spec's
 * gemini-2.5-flash now 404s), and the alias tracks the current flash model,
 * mirroring this repo's anti-rot stance. On a model-level 404 we retry once
 * with a recent pinned fallback before degrading to the heuristic parser.
 */
const GEMINI_MODELS = [
  ...(process.env.GEMINI_MODEL?.trim() ? [process.env.GEMINI_MODEL.trim()] : []),
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-flash-latest",
  "gemini-3-flash-preview",
];
const GEMINI_TIMEOUT_MS = 60_000; // JSON-mode rule drafts measured 12-40s live

export async function POST(req: NextRequest) {
  let body: ParseAiBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.instruction) {
    return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    const vocab = await loadVocab();
    return NextResponse.json(heuristicResponse(body.instruction, body.forceEvent, vocab.overlay));
  }

  let vocab: LoadedVocab | null = null;
  try {
    vocab = await loadVocab();
    const context = buildPromptContext(vocab);
    const gemini = await callGemini(apiKey, body.instruction, body.forceEvent, context);
    return NextResponse.json(gemini);
  } catch (error) {
    console.error("Gemini parse failed; falling back to heuristic parser.", error);
    // Reuse the already-loaded vocabulary when the failure happened after it.
    const overlay = vocab?.overlay ?? (await loadVocab()).overlay;
    const fallback = heuristicResponse(body.instruction, body.forceEvent, overlay);
    fallback.notes = [
      "I could not reach the AI parser just now, so I used the deterministic parser instead.",
      ...fallback.notes,
    ];
    return NextResponse.json(fallback);
  }
}

/**
 * The deterministic parser, fed the same live vocabulary the client pickers
 * use (assignees, option lists, id-bearing registries) so the fallback keeps
 * full Phase 0 (reject-don't-coerce) and Phase 2 (ScopeRef emit) quality.
 */
function heuristicResponse(
  instruction: string,
  forceEvent: string | undefined,
  overlay: VocabOverlay | null
): ParseAiResponse {
  const opts: ParseOptions = {
    forceEvent,
    assignees: overlay?.actionParamOptions.assign_user ?? ASSIGNEES,
    instanceOptions: overlay?.fieldOptions,
    instanceRegistry: overlay
      ? {
          team_member: overlay.instances.users,
          retailer: overlay.instances.retailers,
          template: overlay.instances.templates,
          assign_user: overlay.instances.users,
          notify: overlay.instances.users,
        }
      : undefined,
  };
  const result = parseInstruction(instruction, opts);
  const lintIssues = result.rule ? lintRuleIssues(result.rule, {}) : [];
  const notes = [
    ...result.notes,
    ...lintIssues.map((issue) =>
      issue.severity === "warning"
        ? `I also noticed a lint note: ${issue.message}`
        : `I also noticed a lint error: ${issue.message}`
    ),
  ];

  return {
    rule: hasBlockingIssues(lintIssues) ? null : result.rule,
    notes,
    suggestions: [],
    unresolved: result.unresolved,
    uncovered: result.uncovered,
    ambiguities: result.ambiguities,
    engine: "heuristic",
  };
}

/**
 * Try each candidate model in order. Fall through to the next model on
 * MODEL-LEVEL unavailability — 404 (retired/renamed, e.g. gemini-2.5-flash for
 * new users), 429 (per-model rate cap), 503 ("high demand" — observed live on
 * gemini-flash-latest). Every other failure propagates so the caller's
 * heuristic degrade handles it.
 */
async function callGemini(
  apiKey: string,
  instruction: string,
  forceEvent: string | undefined,
  context: PromptContext
): Promise<ParseAiResponse> {
  const models = [...new Set(GEMINI_MODELS)];
  let lastUnavailable: Error | null = null;
  for (const model of models) {
    try {
      return await callGeminiModel(apiKey, model, instruction, forceEvent, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/^Gemini HTTP (404|429|503)\b/.test(message)) {
        console.warn(`Gemini model "${model}" unavailable (${message.slice(12, 15)}); trying next candidate.`);
        lastUnavailable = error as Error;
        continue;
      }
      throw error;
    }
  }
  throw lastUnavailable ?? new Error("No Gemini model candidates configured.");
}

async function callGeminiModel(
  apiKey: string,
  model: string,
  instruction: string,
  forceEvent: string | undefined,
  context: PromptContext
): Promise<ParseAiResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildSystemInstruction(context) }],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  instruction,
                  forceEvent: forceEvent ?? null,
                }),
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gemini HTTP ${res.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
    }

    const data = (await res.json()) as GeminiResponse;
    const text = extractGeminiText(data);
    if (process.env.PARSE_AI_DEBUG === "1") console.log("[parse-ai raw]", text.slice(0, 2000));
    const parsed = JSON.parse(stripJsonFence(text)) as unknown;
    return coerceGeminiPayload(parsed, context);
  } finally {
    clearTimeout(timeout);
  }
}

function extractGeminiText(data: GeminiResponse): string {
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini returned no JSON content.");
  return text;
}

function stripJsonFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function coerceGeminiPayload(raw: unknown, context: PromptContext): ParseAiResponse {
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

  return {
    rule,
    notes,
    suggestions,
    unresolved,
    uncovered,
    ambiguities,
    engine: "gemini",
  };
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
        if (!knownIds.has(value.id) && !knownLower.has(value.label.trim().toLowerCase())) {
          heard = value.label;
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

interface LoadedVocab {
  live: VocabularySource;
  overlay: VocabOverlay | null;
}

/** Fetch the live platform vocabulary (never throws — degrades to static). */
async function loadVocab(): Promise<LoadedVocab> {
  const live: VocabularySource = platformConfigured()
    ? await fetchLiveVocabulary().catch((e) => ({
        source: "static" as const,
        reason: e instanceof Error ? e.message : "platform vocabulary fetch failed",
      }))
    : { source: "static", reason: "platform is not configured" };
  return { live, overlay: buildOverlay(live) };
}

type PromptContext = ReturnType<typeof buildPromptContext>;

function cleanPromptText(value: string): string {
  return value
    .replace(/[`$<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function limitItems<T>(items: T[], limit = 20): T[] {
  return items.slice(0, limit);
}

function buildPromptContext({ live, overlay }: LoadedVocab) {
  const liveUsers = overlay?.instances.users ?? [];
  const liveTemplates = overlay?.instances.templates ?? [];
  const liveRetailers = overlay?.instances.retailers ?? [];
  const liveStages = overlay?.instances.stages ?? [];
  const liveFields = overlay?.liveFields ?? [];

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
    source:
      live.source === "live"
        ? {
            kind: "live",
            fetchedAt: live.fetchedAt,
            errors: limitItems((live.errors ?? []).map(cleanPromptText)),
          }
        : { ...live, reason: cleanPromptText((live as { reason?: string }).reason ?? "static fallback") },
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
      options: f.options ?? [],
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
    users: limitItems(liveUsers.length ? liveUsers : ASSIGNEES.map((label) => ({ id: "", label }))).map((u) => ({
      id: cleanPromptText(u.id),
      label: cleanPromptText(u.label),
    })),
    templates: limitItems(liveTemplates).map((t) => ({ id: cleanPromptText(t.id), label: cleanPromptText(t.label) })),
    retailers: limitItems(liveRetailers).map((r) => ({ id: cleanPromptText(r.id), label: cleanPromptText(r.label) })),
    templateStages: limitItems(
      liveStages.length ? liveStages : (FIELDS.stage.options ?? []).map((label) => ({ id: "", label }))
    ).map((s) => ({ id: cleanPromptText(s.id), label: cleanPromptText(s.label) })),
    liveFormFields: limitItems(liveFields).map((f) => ({
      formTemplateId: f.formTemplateId,
      formName: f.formName,
      fieldId: f.fieldId,
      name: cleanPromptText(f.name),
      label: cleanPromptText(f.label),
      kind: fieldKindForType(f.fieldType),
      required: f.required,
    })),
  };
}

function buildSystemInstruction(context: PromptContext): string {
  return [
    "You are the Sweet Workflow Creator AI parser and a friendly expert credit policy coach.",
    "Convert the user's plain-English instruction into structured JSON only. Do not include markdown or commentary outside JSON.",
    "Return exactly this top-level shape: {\"rule\": WorkflowRule | null, \"notes\": string[], \"suggestions\": string[], \"unresolved\": UnresolvedSlot[], \"uncovered\": string[]}.",
    "WorkflowRule must use schemaVersion 3: triggers[], conditions {logic, children}, actions[], optional else[], and controls.",
    "Use EXACTLY these field names (do NOT copy the vocabulary snapshot's 'key' naming into the rule).",
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
    "Example 4: 'when a loan is approved or rejected and loan amount over 500k, escalate to the credit committee and add tag jumbo'",
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
