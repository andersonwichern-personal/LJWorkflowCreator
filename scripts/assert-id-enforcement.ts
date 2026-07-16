/**
 * Phase 11 instance-reference hardening — linter ID enforcement and the
 * parse-ai assignee boundary. No network calls are made (platform + Gemini
 * fetches are stubbed).
 * Run: npx tsx scripts/assert-id-enforcement.ts
 */
import { lintRuleIssues, type LintContext, type RuleIssue } from "../lib/ruleLinter";
import { normalizeRule, type ScopeValue, type WorkflowRule } from "../lib/vocabulary";
import type { UnresolvedSlot } from "../lib/nlParser";

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
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${!condition && detail ? ` — ${detail}` : ""}`);
}

/* ========================================================================== */
/* Part 1 — linter reference enforcement                                       */
/* ========================================================================== */

/** The live registries, id-bearing. "Escalation Team" is a static id-less peer. */
const liveCtx: LintContext = {
  users: [{ id: "u-wael", label: "Wael Hamdan" }, "Escalation Team"],
  stages: [{ id: "t1:s1", label: "Ag Term Loan › Intake" }],
  retailers: [{ id: "r1", label: "Growmark" }],
  templates: ["t1"],
  authorityIds: ["auth-1"],
};

/**
 * Deliberately free of reference issues under `liveCtx` — the assignee is
 * id-bound — so each case below counts only the refs it introduces.
 */
const base = {
  schemaVersion: 3,
  triggers: [{ event: "SYSTEM ERROR" }],
  conditions: { logic: "AND", children: [{ field: "bookstatus", operator: "is", value: "Error" }] },
  actions: [{ action: "assign_user", params: { assignee: { level: "instance", id: "u-wael", label: "Wael Hamdan" } } }],
  controls: { mode: "shadow", oncePerRequest: true, maxFiresPerHour: 25, missingData: "no_match", priority: 100 },
};

/** Lint an already-normalized tree so field/event allowlists can't gate the run. */
function issuesFor(raw: unknown, ctx: LintContext = liveCtx): RuleIssue[] {
  return lintRuleIssues(normalizeRule(raw), ctx);
}

function brokenRefs(raw: unknown, severity: RuleIssue["severity"], ctx: LintContext = liveCtx): RuleIssue[] {
  return issuesFor(raw, ctx).filter((i) => i.code === "BROKEN_REF" && i.severity === severity);
}

function condRule(field: string, value: ScopeValue) {
  return { ...base, conditions: { logic: "AND", children: [{ field, operator: "is", value }] } };
}

function instance(id: string, label: string): ScopeValue {
  return { level: "instance", id, label };
}

/* ---- invalid instance ids are blocking errors ----------------------------- */
t(
  "BROKEN_REF: a stage instance id outside the registry errors",
  brokenRefs(condRule("stage", instance("t1:ghost", "Ghost Stage")), "error").length === 1
);
t(
  "BROKEN_REF: a live stage instance id is clean",
  brokenRefs(condRule("stage", instance("t1:s1", "Ag Term Loan › Intake")), "error").length === 0
);
t(
  "BROKEN_REF: a retailer instance id outside the registry errors",
  brokenRefs(condRule("retailer", instance("r-ghost", "Growmark")), "error").length === 1
);
t(
  "BROKEN_REF: a team_member instance id outside the registry errors",
  brokenRefs(condRule("team_member", instance("u-ghost", "Wael Hamdan")), "error").length === 1
);

// The point of the phase: a real-looking label does not rescue a fabricated id.
const fabricatedAssignee = {
  ...base,
  actions: [{ action: "assign_user", params: { assignee: instance("u-fabricated", "Wael Hamdan") } }],
};
t(
  "BROKEN_REF: a fabricated assignee id errors even when its label is real",
  brokenRefs(fabricatedAssignee, "error").length === 1
);
t(
  "BROKEN_REF: the error names the offending id",
  brokenRefs(fabricatedAssignee, "error")[0]?.message.includes("u-fabricated") === true,
  JSON.stringify(brokenRefs(fabricatedAssignee, "error")[0]?.message)
);
t(
  "BROKEN_REF: the live assignee id is clean",
  brokenRefs(
    { ...base, actions: [{ action: "assign_user", params: { assignee: instance("u-wael", "Wael Hamdan") } }] },
    "error"
  ).length === 0
);
t(
  "BROKEN_REF: a dangling authority instance id errors",
  brokenRefs(
    { ...base, actions: [{ action: "assign_authority", params: { value: instance("auth-gone", "Old Level") } }] },
    "error"
  ).length === 1
);
t(
  "BROKEN_REF: a dangling template trigger scope errors",
  brokenRefs({ ...base, triggers: [{ event: "SYSTEM ERROR", scope: instance("t-ghost", "Missing") }] }, "error")
    .length === 1
);
t(
  "BROKEN_REF: a live template trigger scope is clean",
  brokenRefs({ ...base, triggers: [{ event: "SYSTEM ERROR", scope: instance("t1", "Ag Term Loan") }] }, "error")
    .length === 0
);

/* ---- legacy strings warning-degrade rather than fail ---------------------- */
const legacyUser = { ...base, actions: [{ action: "notify", params: { value: "Wael Hamdan" } }] };
t(
  "BROKEN_REF: a legacy user string that resolves warns rather than errors",
  brokenRefs(legacyUser, "warning").length === 1 && brokenRefs(legacyUser, "error").length === 0
);
t(
  "BROKEN_REF: the legacy warning invites an ID-bound upgrade",
  brokenRefs(legacyUser, "warning")[0]?.message.includes("legacy text reference") === true
);

const legacyStage = condRule("stage", "Ag Term Loan › Intake");
t(
  "BROKEN_REF: a legacy stage string that resolves warns rather than errors",
  brokenRefs(legacyStage, "warning").length === 1 && brokenRefs(legacyStage, "error").length === 0
);
t(
  "BROKEN_REF: an unresolvable legacy stage string still errors",
  brokenRefs(condRule("stage", "Ghost Stage"), "error").length === 1
);
t(
  "BROKEN_REF: an unresolvable legacy user string still errors",
  brokenRefs({ ...base, actions: [{ action: "notify", params: { value: "Ghost McGhost" } }] }, "error").length === 1
);

/* ---- category refs check the token's chips, not the instance registry -----
 * A category names a static type ("Processing"), never a live record, so it
 * must not be measured against the id-bearing stage/template registries. */
t(
  "BROKEN_REF: a valid stage category is clean against a live stage registry",
  brokenRefs(condRule("stage", { level: "category", category: "Processing" }), "error").length === 0
);
t(
  "BROKEN_REF: an unknown stage category errors",
  brokenRefs(condRule("stage", { level: "category", category: "Ghost Phase" }), "error").length === 1
);
t(
  "BROKEN_REF: a valid template category is clean against an id-only registry",
  brokenRefs(condRule("template", { level: "category", category: "Origination" }), "error").length === 0
);
t(
  "BROKEN_REF: a team category assignee is clean",
  brokenRefs(
    { ...base, actions: [{ action: "assign_user", params: { assignee: { level: "category", category: "Escalation Team" } } }] },
    "error"
  ).length === 0
);
t(
  "BROKEN_REF: an 'any' scope is vacuous and clean",
  brokenRefs({ ...base, triggers: [{ event: "SYSTEM ERROR", scope: { level: "any" } }] }, "error").length === 0
);

/* ---- backward compatibility + absent registries --------------------------- */
t(
  "BROKEN_REF: legacy string[] registries still resolve users",
  brokenRefs({ ...base, actions: [{ action: "notify", params: { value: "Ghost McGhost" } }] }, "error", {
    users: ["Wael", "Sara"],
  }).length === 1
);
t(
  "BROKEN_REF: a string[] user registry warns on a resolving legacy value",
  brokenRefs({ ...base, actions: [{ action: "notify", params: { value: "Wael" } }] }, "warning", {
    users: ["Wael", "Sara"],
  }).length === 1
);
t(
  "BROKEN_REF: an empty context asserts nothing",
  brokenRefs(condRule("stage", instance("t1:ghost", "Ghost Stage")), "error", {}).length === 0
);

/* ========================================================================== */
/* Part 2 — parse-ai assignee ID boundary                                      */
/* ========================================================================== */

process.env.GEMINI_API_KEY = "test-key";
delete process.env.GEMINI_MODEL;

const ORG = "org-test";
function configurePlatform(live: boolean) {
  process.env.LANDJOURNEY_API_BASE = live ? "https://platform.test" : "";
  process.env.LANDJOURNEY_API_TOKEN = live ? "test-token" : "";
  process.env.LANDJOURNEY_ORG_ID = live ? ORG : "";
}

/** The assignee the stubbed model emits; each case rewrites it. */
let modelAssignee: ScopeValue = instance("u-fabricated", "Wael Hamdan");

function geminiPayload() {
  return {
    rule: {
      schemaVersion: 3,
      triggers: [{ event: "LOAN APPROVED" }],
      conditions: { logic: "AND", children: [] },
      actions: [{ action: "assign_user", params: { assignee: modelAssignee } }],
      controls: {
        mode: "shadow",
        oncePerRequest: true,
        maxFiresPerHour: 25,
        missingData: "no_match",
        priority: 100,
      },
    },
    notes: [],
    suggestions: [],
    unresolved: [],
    uncovered: [],
  };
}

// One live employee: id-bearing, so ids are the only thing that resolves.
const LIVE_USERS = [{ id: "u-wael", name: "Wael Hamdan" }];

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : input.toString();
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  if (url.includes("generateContent")) {
    return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiPayload()) }] } }] });
  }
  if (url.includes(`/iam/organizations/${ORG}/users`)) return json(LIVE_USERS);
  // Retailers / templates / forms are irrelevant here — an empty list keeps the
  // vocabulary "live" (users alone are enough) without inventing more registries.
  return json([]);
}) as typeof fetch;

async function main() {
  const imported = (await import("../app/api/workflows/parse-ai/route")) as unknown as {
    POST?: (req: Request) => Promise<Response>;
    default?: { POST?: (req: Request) => Promise<Response> };
  };
  const POST = imported.POST ?? imported.default?.POST;
  if (typeof POST !== "function") throw new Error("parse-ai route did not export POST");

  async function parse(instruction: string): Promise<ParseAiResponse> {
    const res = await POST!(
      new Request("http://local/api/workflows/parse-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      })
    );
    return (await res.json()) as ParseAiResponse;
  }

  const assigneeOf = (r: ParseAiResponse) => r.rule?.actions[0]?.params.assignee;

  /* ---- live users loaded → a fabricated id is rejected, not coerced ------- */
  configurePlatform(true);
  modelAssignee = instance("u-fabricated", "Wael Hamdan");
  const live = await parse("When approved assign Wael Hamdan");

  t("live users: response is still the Gemini engine", live.engine === "gemini", JSON.stringify(live.notes));
  t(
    "live users: a fabricated assignee id becomes an unresolved slot",
    live.unresolved.some((s) => s.where === "action-param" && s.heard === "Wael Hamdan"),
    JSON.stringify(live.unresolved)
  );
  t("live users: the fabricated assignee is blanked", assigneeOf(live) === "", JSON.stringify(assigneeOf(live)));
  t(
    "live users: the fabricated id never survives in the rule JSON",
    !JSON.stringify(live.rule).includes("u-fabricated"),
    JSON.stringify(live.rule?.actions)
  );
  t("live users: the rejection is explained", live.notes.some((n) => n.includes("Wael Hamdan")));

  /* ---- live users loaded → the real id passes through untouched ----------- */
  modelAssignee = instance("u-wael", "Wael Hamdan");
  const liveKnown = await parse("When approved assign Wael Hamdan");
  const known = assigneeOf(liveKnown);
  t("live users: a real assignee id resolves", liveKnown.unresolved.length === 0, JSON.stringify(liveKnown.unresolved));
  t(
    "live users: the real id is preserved",
    typeof known === "object" && known?.level === "instance" && known.id === "u-wael",
    JSON.stringify(known)
  );

  /* ---- no live users → known label survives, but its id is coerced off ---- */
  configurePlatform(false);
  modelAssignee = instance("u-fabricated", "Wael");
  const staticMode = await parse("When approved assign Wael");
  const coerced = assigneeOf(staticMode);

  t(
    "static users: a known label is not rejected",
    staticMode.unresolved.length === 0,
    JSON.stringify(staticMode.unresolved)
  );
  t(
    "static users: the fabricated id is coerced to empty",
    typeof coerced === "object" && coerced?.level === "instance" && coerced.id === "" && coerced.label === "Wael",
    JSON.stringify(coerced)
  );
  t(
    "static users: the fabricated id never survives in the rule JSON",
    !JSON.stringify(staticMode.rule).includes("u-fabricated"),
    JSON.stringify(staticMode.rule?.actions)
  );

  /* ---- no live users → an unknown label is still rejected ----------------- */
  modelAssignee = instance("", "Ghost McGhost");
  const staticGhost = await parse("When approved assign Ghost McGhost");
  t(
    "static users: an unknown assignee label is still an unresolved slot",
    staticGhost.unresolved.some((s) => s.heard === "Ghost McGhost"),
    JSON.stringify(staticGhost.unresolved)
  );
  t("static users: the unknown assignee is blanked", assigneeOf(staticGhost) === "");

  if (failures) {
    console.error(`\n${failures} ID enforcement assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll ID enforcement assertions passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
