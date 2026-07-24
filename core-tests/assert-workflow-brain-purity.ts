/**
 * assert-workflow-brain-purity — the wall that keeps @sweet/workflow-brain
 * headless, plus the deterministic reducer contract of brainState.
 *
 * Static half: brain sources are scanned as TEXT — no framework/provider/DOM/
 * storage/clock imports or tokens; the ONLY allowed non-sibling import is the
 * rule-core reach; rule-core never imports the Brain (dependency direction);
 * the vendored copy under src/app/brain must carry rewritten imports.
 * Banned-token patterns are assembled from fragments so this suite can never
 * trip a sibling text scan, and tokens are checked on comment-stripped source:
 * the frozen ports.ts documents the wall-clock ban in prose, and doc prose must
 * not fail the gate that enforces it in code.
 *
 * Functional half: replays events through reduceBrain and pins the staleness,
 * invalidation, tenant-memory, append-only-history, and purity semantics.
 *
 * Run: npx tsx core-tests/assert-workflow-brain-purity.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BrainEvent,
  BrainSessionState,
  RecommendationRef,
  initialBrainState,
  reduceBrain,
} from "../packages/workflow-brain/src/brainState";
import { BrainContextSnapshot, ContextProfileId } from "../packages/workflow-brain/src/context";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const ROOT = join(__dirname, "..");
const BRAIN_SRC = join(ROOT, "packages", "workflow-brain", "src");
const RULE_CORE_SRC = join(ROOT, "packages", "rule-core", "src");
const VENDORED_BRAIN = join(ROOT, "src", "app", "brain");

/* ========================================================================== */
/* Static purity — brain sources as text                                      */
/* ========================================================================== */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Remove block and line comments so doc prose cannot trip the token scan. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every import/export-from/dynamic-import specifier in the (stripped) source. */
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

const BANNED_SPECIFIERS: Array<{ why: string; hit: (s: string) => boolean }> = [
  { why: "@angular/*", hit: (s) => s.startsWith("@angular/") },
  { why: "rxjs", hit: (s) => s === "rxjs" || s.startsWith("rxjs/") },
  { why: "zone.js", hit: (s) => s === "zone.js" || s.startsWith("zone.js/") },
  {
    why: "react",
    hit: (s) => s === "react" || s === "react-dom" || s.startsWith("react/") || s.startsWith("react-dom/"),
  },
  { why: "next", hit: (s) => s === "next" || s.startsWith("next/") },
  { why: "prisma", hit: (s) => s === "prisma" || s.startsWith("@prisma") },
  { why: "supabase", hit: (s) => s.startsWith("@supabase") },
  { why: "pg (raw db driver)", hit: (s) => s === "pg" || s.startsWith("pg/") },
  { why: "@google/*", hit: (s) => s.startsWith("@google/") },
  { why: "googleapis", hit: (s) => s === "googleapis" || s.startsWith("googleapis/") },
  { why: "openai", hit: (s) => s === "openai" || s.startsWith("openai/") },
  { why: "@anthropic-ai/*", hit: (s) => s.startsWith("@anthropic-ai/") },
  { why: "@cloudflare/*", hit: (s) => s.startsWith("@cloudflare/") },
  {
    why: "host tree (src/, @/, or /src/app/)",
    hit: (s) => s.startsWith("src/") || s.startsWith("@/") || s.includes("/src/app/"),
  },
];

/** The ONLY legal shapes: a sibling module or the rule-core reach. */
const SIBLING_RE = /^\.\/[A-Za-z0-9_.-]+$/;
const RULE_CORE_RE = /^\.\.\/\.\.\/rule-core\/src\/[A-Za-z0-9_.-]+$/;

/** Assembled from fragments so these literals never appear whole in this file. */
const BANNED_TOKENS: Array<{ token: string; why: string }> = [
  { token: "docu" + "ment.", why: "DOM" },
  { token: "win" + "dow.", why: "DOM" },
  { token: "local" + "Storage", why: "storage" },
  { token: "session" + "Storage", why: "storage" },
  { token: "XMLHttp" + "Request", why: "network" },
  { token: "Web" + "Socket", why: "network" },
  { token: "fet" + "ch(", why: "network" },
  { token: "Http" + "Client", why: "Angular network" },
  { token: "Date" + ".now(", why: "wall clock" },
  { token: "new " + "Date(", why: "wall clock" },
  { token: "Math" + ".random(", why: "nondeterminism" },
];

const brainFiles = walk(BRAIN_SRC);
t("brain sources present (ports, context, brainState, index)", brainFiles.length >= 4);
t(
  "no .tsx files in the Brain",
  brainFiles.every((f) => !f.endsWith(".tsx")),
  brainFiles.filter((f) => f.endsWith(".tsx")).join(", ")
);

const specifierViolations: string[] = [];
const allowlistViolations: string[] = [];
const tokenViolations: string[] = [];

for (const file of brainFiles) {
  const rel = file.slice(file.indexOf("packages"));
  const stripped = stripComments(readFileSync(file, "utf8"));
  for (const spec of importSpecifiers(stripped)) {
    for (const { why, hit } of BANNED_SPECIFIERS) {
      if (hit(spec)) specifierViolations.push(`${rel}: "${spec}" (${why})`);
    }
    if (!SIBLING_RE.test(spec) && !RULE_CORE_RE.test(spec)) {
      allowlistViolations.push(`${rel}: "${spec}" is neither ./<sibling> nor ../../rule-core/src/<module>`);
    }
  }
  for (const { token, why } of BANNED_TOKENS) {
    if (stripped.includes(token)) tokenViolations.push(`${rel}: ${why}`);
  }
}

t("no banned import specifiers in the Brain", specifierViolations.length === 0, specifierViolations.join("; "));
t("every Brain import is a sibling or the rule-core reach", allowlistViolations.length === 0, allowlistViolations.join("; "));
t("no banned host/clock/random tokens in Brain code", tokenViolations.length === 0, tokenViolations.join("; "));

/* Dependency direction: rule-core must never know the Brain exists. */
const reverseDeps = walk(RULE_CORE_SRC).filter((f) => readFileSync(f, "utf8").includes("workflow-brain"));
t(
  "rule-core never references workflow-brain",
  reverseDeps.length === 0,
  reverseDeps.map((f) => f.slice(f.indexOf("packages"))).join(", ")
);

/* Vendored copy: the sync rewrite must have replaced the rule-core reach. */
if (existsSync(VENDORED_BRAIN)) {
  const unrewritten = walk(VENDORED_BRAIN).filter((f) =>
    readFileSync(f, "utf8").includes("../../rule-core/src/")
  );
  t(
    "vendored src/app/brain carries rewritten ../core/ imports",
    unrewritten.length === 0,
    unrewritten.map((f) => f.slice(f.indexOf("src"))).join(", ")
  );
} else {
  t("vendored src/app/brain not generated yet — rewrite check skipped", true);
}

/* ========================================================================== */
/* Functional — reduceBrain semantics                                         */
/* ========================================================================== */

function snap(snapshotId: string, tenantKey: string, profile: ContextProfileId = "standalone-demo"): BrainContextSnapshot {
  return {
    snapshotId,
    profile,
    identity: { tenantKey },
    vocabularyHash: `hash-${snapshotId}`,
    instanceOptions: {},
    instanceRegistry: {},
    assignees: [],
    entities: [],
    relatedWorkflows: [],
    allowedActionKeys: [],
    sources: [],
    budget: { maxBytes: 1024, usedBytes: 0, truncated: [] },
    privacyCeiling: "public-vocabulary",
  };
}

// ParseEnvelope is a type-only contract here; runtime shapes suffice.
const cleanEnvelope: any = { rule: null, notes: [], unresolved: [], uncovered: [], ambiguities: [] };
const gappyEnvelope: any = {
  rule: null,
  notes: [],
  unresolved: [{ where: "action-param", heard: "santa claus", suggestions: [] }],
  uncovered: [],
  ambiguities: [],
};

const s0 = initialBrainState("standalone-demo", "tenant-a");
t(
  "initial state: discover / gen 0 / version 0 / empty",
  s0.phase === "discover" &&
    s0.generation === 0 &&
    s0.ruleVersion === 0 &&
    s0.snapshotId === null &&
    s0.vocabularyHash === null &&
    s0.envelope === null &&
    s0.openQuestionIds.length === 0 &&
    s0.recommendations.length === 0 &&
    s0.acceptedFacts.length === 0 &&
    s0.history.length === 0
);

const s1 = reduceBrain(s0, { type: "context-attached", snapshot: snap("snap-1", "tenant-a"), at: 1 });
t(
  "context-attached adopts snapshot identity",
  s1.snapshotId === "snap-1" && s1.vocabularyHash === "hash-snap-1" && s1.tenantKey === "tenant-a" && s1.history.length === 1
);
t("input state untouched by attach", s0.snapshotId === null && s0.history.length === 0);

const s2 = reduceBrain(s1, { type: "fact-recorded", fact: "goal: reduce booking errors", at: 2 });
t("fact-recorded appends", s2.acceptedFacts.length === 1 && s2.acceptedFacts[0] === "goal: reduce booking errors");
const s2dup = reduceBrain(s2, { type: "fact-recorded", fact: "goal: reduce booking errors", at: 2 });
t("fact-recorded is set-like (dup kept once, history still appended)", s2dup.acceptedFacts.length === 1 && s2dup.history.length === s2.history.length + 1);

const s3 = reduceBrain(s2, { type: "description-changed", description: "when a loan is approved, assign to Wael", at: 3 });
t("description-changed bumps generation, phase draft", s3.generation === 1 && s3.phase === "draft" && s3.envelope === null);
const sEmpty = reduceBrain(s3, { type: "description-changed", description: "   ", at: 4 });
t("empty description falls back to discover", sEmpty.phase === "discover" && sEmpty.generation === 2);

const s4 = reduceBrain(s3, { type: "parse-completed", envelope: cleanEnvelope, generation: 1, at: 5 });
t(
  "fresh clean parse: envelope set, ruleVersion+1, phase recommend",
  s4.envelope === cleanEnvelope && s4.ruleVersion === 1 && s4.phase === "recommend"
);
const s4g = reduceBrain(s3, { type: "parse-completed", envelope: gappyEnvelope, generation: 1, at: 5 });
t("fresh gappy parse: phase gaps", s4g.phase === "gaps" && s4g.ruleVersion === 1);

const s5 = reduceBrain(s4, { type: "parse-completed", envelope: gappyEnvelope, generation: 0, at: 6 });
t(
  "stale parse ignored (envelope/version/phase untouched, history noted)",
  s5.envelope === cleanEnvelope &&
    s5.ruleVersion === 1 &&
    s5.phase === "recommend" &&
    s5.history.length === s4.history.length + 1 &&
    s5.history[s5.history.length - 1].detail.includes("stale-parse-ignored")
);

const refs: RecommendationRef[] = [
  { id: "r1", status: "open", snapshotId: "snap-1", ruleVersion: 1 },
  { id: "r2", status: "open", snapshotId: "snap-1", ruleVersion: 0 }, // stale rule version
  { id: "r3", status: "open", snapshotId: "snap-0", ruleVersion: 1 }, // stale snapshot
  { id: "r4", status: "open", snapshotId: "snap-1", ruleVersion: 1 },
];
const s6 = reduceBrain(s5, { type: "recommendations-issued", refs, at: 7 });
t("recommendations-issued appends refs", s6.recommendations.length === 4);

const s7 = reduceBrain(s6, { type: "recommendation-accepted", id: "r1", at: 8 });
t("fresh accept flips to accepted", s7.recommendations.find((r) => r.id === "r1")?.status === "accepted");
const s8 = reduceBrain(s7, { type: "recommendation-accepted", id: "r2", at: 9 });
t(
  "stale-version accept ignored with history entry",
  s8.recommendations.find((r) => r.id === "r2")?.status === "open" &&
    s8.history[s8.history.length - 1].detail === "stale-accept-ignored"
);
const s8b = reduceBrain(s8, { type: "recommendation-accepted", id: "r3", at: 10 });
t(
  "stale-snapshot accept ignored with history entry",
  s8b.recommendations.find((r) => r.id === "r3")?.status === "open" &&
    s8b.history[s8b.history.length - 1].detail === "stale-accept-ignored"
);
const s9 = reduceBrain(s8b, { type: "recommendation-rejected", id: "r4", at: 11 });
t("fresh reject flips to rejected", s9.recommendations.find((r) => r.id === "r4")?.status === "rejected");
const s9b = reduceBrain(s9, { type: "recommendation-rejected", id: "r3", at: 11 });
t(
  "stale reject ignored",
  s9b.recommendations.find((r) => r.id === "r3")?.status === "open" &&
    s9b.history[s9b.history.length - 1].detail === "stale-reject-ignored"
);

/* patch-applied: an accepted patch bumps the version and stales sibling previews. */
const sAcc = reduceBrain(s6, { type: "recommendation-accepted", id: "r1", at: 11 });
const sPat = reduceBrain(sAcc, { type: "patch-applied", recommendationId: "r1", at: 12 });
t(
  "patch-applied bumps ruleVersion and appends history",
  sPat.ruleVersion === sAcc.ruleVersion + 1 && sPat.history.length === sAcc.history.length + 1
);
t(
  "patch-applied expires remaining open recommendations, keeps the accepted one",
  sPat.recommendations.find((r) => r.id === "r1")?.status === "accepted" &&
    sPat.recommendations.find((r) => r.id === "r4")?.status === "expired"
);
const sStale = reduceBrain(sPat, { type: "recommendation-accepted", id: "r4", at: 13 });
t(
  "post-patch accept of a pre-patch preview is ignored (consent binds to the previewed rule)",
  sStale.recommendations.find((r) => r.id === "r4")?.status === "expired" &&
    sStale.history[sStale.history.length - 1].detail === "stale-accept-ignored"
);

/* Context switch, same tenant, new profile: derived state dies, memory lives. */
const s10 = reduceBrain(s9b, { type: "context-switched", snapshot: snap("snap-2", "tenant-a", "workflow-revision"), at: 12 });
t(
  "same-tenant switch adopts snapshot + profile",
  s10.snapshotId === "snap-2" && s10.vocabularyHash === "hash-snap-2" && s10.profile === "workflow-revision" && s10.tenantKey === "tenant-a"
);
t("same-tenant switch discards envelope + questions", s10.envelope === null && s10.openQuestionIds.length === 0);
t("same-tenant (profile) switch keeps acceptedFacts", s10.acceptedFacts.length === 1);
t(
  "same-tenant switch expires open recs, preserves decided ones",
  s10.recommendations.find((r) => r.id === "r1")?.status === "accepted" &&
    s10.recommendations.find((r) => r.id === "r4")?.status === "rejected" &&
    s10.recommendations.find((r) => r.id === "r2")?.status === "expired" &&
    s10.recommendations.find((r) => r.id === "r3")?.status === "expired"
);
t("switch keeps history (appends, never clears)", s10.history.length === s9b.history.length + 1);

/* Tenant switch: tenant-scoped memory must die. */
const s11 = reduceBrain(s10, { type: "context-switched", snapshot: snap("snap-3", "tenant-b"), at: 13 });
t(
  "tenant switch wipes acceptedFacts and ALL recommendations",
  s11.tenantKey === "tenant-b" && s11.acceptedFacts.length === 0 && s11.recommendations.length === 0 && s11.snapshotId === "snap-3"
);
t("tenant switch keeps history", s11.history.length === s10.history.length + 1);

/* context-attached with a different snapshot behaves like a switch. */
const s12 = reduceBrain(s11, { type: "context-attached", snapshot: snap("snap-4", "tenant-b"), at: 14 });
t("attach with new snapshot = switch semantics", s12.snapshotId === "snap-4");
const s13 = reduceBrain(s12, { type: "context-attached", snapshot: snap("snap-4", "tenant-b"), at: 15 });
t(
  "re-attach of the same snapshot is history-only",
  s13.history.length === s12.history.length + 1 &&
    JSON.stringify({ ...s13, history: [] }) === JSON.stringify({ ...s12, history: [] })
);

/* Clarifications: answering removes exactly that question. */
const withQ: BrainSessionState = { ...s4, openQuestionIds: ["q1", "q2"] };
const sQ = reduceBrain(withQ, { type: "clarification-answered", questionId: "q1", at: 16 });
t("clarification-answered removes the question", JSON.stringify(sQ.openQuestionIds) === '["q2"]');

const sP = reduceBrain(s4, { type: "phase-advanced", phase: "simulate", at: 17 });
t("phase-advanced sets phase", sP.phase === "simulate");

/* Every event type appends exactly one history entry; history is append-only. */
const everyEvent: BrainEvent[] = [
  { type: "context-attached", snapshot: snap("h-1", "tenant-a"), at: 1 },
  { type: "fact-recorded", fact: "f", at: 2 },
  { type: "description-changed", description: "d", at: 3 },
  { type: "parse-completed", envelope: cleanEnvelope, generation: 1, at: 4 },
  { type: "recommendations-issued", refs: [{ id: "x", status: "open", snapshotId: "h-1", ruleVersion: 1 }], at: 5 },
  { type: "recommendation-accepted", id: "x", at: 6 },
  { type: "patch-applied", recommendationId: "x", at: 6 },
  { type: "recommendation-rejected", id: "x", at: 7 },
  { type: "clarification-answered", questionId: "none", at: 8 },
  { type: "phase-advanced", phase: "verify", at: 9 },
  { type: "context-switched", snapshot: snap("h-2", "tenant-c"), at: 10 },
];
let cursor = initialBrainState("standalone-demo", "tenant-a");
let historyOk = true;
let appendOnlyOk = true;
for (const ev of everyEvent) {
  const nextState = reduceBrain(cursor, ev);
  if (nextState.history.length !== cursor.history.length + 1) historyOk = false;
  for (let i = 0; i < cursor.history.length; i++) {
    if (nextState.history[i] !== cursor.history[i]) appendOnlyOk = false; // prefix must be untouched
  }
  cursor = nextState;
}
t("every event appends exactly one history entry", historyOk);
t("history is append-only (existing entries never rewritten)", appendOnlyOk);

/* Purity: a deep-frozen input must neither throw nor change. */
function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === "object") {
    for (const key of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[key]);
    Object.freeze(v);
  }
  return v;
}
const frozen = deepFreeze(JSON.parse(JSON.stringify(s6))) as BrainSessionState;
const before = JSON.stringify(frozen);
let threw: string | null = null;
try {
  reduceBrain(frozen, { type: "description-changed", description: "changed again", at: 20 });
  reduceBrain(frozen, { type: "context-switched", snapshot: snap("snap-9", "tenant-z"), at: 21 });
  reduceBrain(frozen, { type: "recommendation-accepted", id: "r1", at: 22 });
} catch (e) {
  threw = String(e);
}
t("reducer never mutates a frozen input (no throw)", threw === null, threw ?? undefined);
t("frozen input byte-identical after reduction", JSON.stringify(frozen) === before);

/* ========================================================================== */

if (failures > 0) {
  console.error(`\n✗ assert-workflow-brain-purity: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\n✓ workflow-brain is pure and the brainState reducer contract holds.");
