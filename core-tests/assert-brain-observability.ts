/**
 * assert-brain-observability — reliability plumbing contract + honest perf gate.
 *
 * Covers packages/workflow-brain/src/observability.ts: correlation ids (unique,
 * format-stable, zero randomness), stage-timer math against a stepped fake
 * clock, the telemetry dimension allowlist (hostile values never reach the
 * sink), latency buckets at their exact boundaries, tenant-scoped cache keys
 * (missing tenant throws; raw input never embedded), the no-client-retry
 * policy, the full circuit-breaker lifecycle against a fake clock, and
 * diagnostics redaction.
 *
 * Perf section: parseInstruction over representative sentences, measured with
 * hrtime AFTER warmup; p50/p95 printed so the lead can publish real numbers.
 * The gate asserts p95 < 250 ms (product target < 100 ms) — loose enough to
 * survive CI noise, tight enough to catch a real regression. No network.
 *
 * This file lives OUTSIDE the brain purity scan and may use real time freely.
 *
 * Run: npx tsx core-tests/assert-brain-observability.ts
 */
import { parseInstruction } from "../packages/rule-core/src/nlParser";
import { BrainTelemetrySink } from "../packages/workflow-brain/src/ports";
import {
  buildCacheKey,
  classifyForRetry,
  guardedTelemetry,
  hashText,
  latencyBucket,
  makeCircuitBreaker,
  makeCorrelationId,
  makeStageTimer,
  redactForDiagnostics,
  TELEMETRY_DIMENSIONS,
} from "../packages/workflow-brain/src/observability";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

/** Settable fake clock — the only time source the units under test see. */
function fakeClock(startMs = 0) {
  let ms = startMs;
  return {
    now: () => ms,
    set: (v: number) => {
      ms = v;
    },
    advance: (d: number) => {
      ms += d;
    },
  };
}

function makeCounter(start = 0) {
  let n = start;
  return () => n++;
}

/* ========================================================================== */
/* Correlation ids                                                            */
/* ========================================================================== */

{
  const clock = fakeClock(1_753_000_000_000);
  const counter = makeCounter();
  const first = makeCorrelationId(clock, counter);
  t(
    "correlation id format is req-<base36>-<base36>",
    /^req-[a-z0-9]+-[a-z0-9]+$/.test(first),
    first
  );
  t(
    "correlation id embeds base36 clock time",
    first.startsWith(`req-${(1_753_000_000_000).toString(36)}-`),
    first
  );

  const ids = new Set<string>([first]);
  for (let i = 0; i < 99; i++) ids.add(makeCorrelationId(clock, counter));
  t("100 ids at ONE frozen clock tick are all unique (counter, not time)", ids.size === 100);

  const runA: string[] = [];
  const runB: string[] = [];
  const clockA = fakeClock(42);
  const clockB = fakeClock(42);
  const counterA = makeCounter(7);
  const counterB = makeCounter(7);
  for (let i = 0; i < 5; i++) runA.push(makeCorrelationId(clockA, counterA));
  for (let i = 0; i < 5; i++) runB.push(makeCorrelationId(clockB, counterB));
  t(
    "no randomness: same clock + same counter → byte-identical id sequences",
    JSON.stringify(runA) === JSON.stringify(runB),
    JSON.stringify({ runA, runB })
  );
}

/* ========================================================================== */
/* Stage timer                                                                */
/* ========================================================================== */

{
  const clock = fakeClock(1_000);
  const timer = makeStageTimer(clock);
  timer.start("model");
  clock.set(1_600);
  timer.end("model");
  timer.start("normalize");
  clock.set(1_630);
  timer.end("normalize");
  clock.set(1_700);
  const snap = timer.snapshot();
  t(
    "stage timer: stepped-clock math (model=600, normalize=30, total=700)",
    snap.totalMs === 700 && snap.stages.model === 600 && snap.stages.normalize === 30,
    JSON.stringify(snap)
  );

  timer.end("never-started"); // must be ignored, not throw
  t("end without start is ignored", timer.snapshot().stages["never-started"] === undefined);

  const clock2 = fakeClock(0);
  const overlap = makeStageTimer(clock2);
  overlap.start("outer");
  clock2.set(100);
  overlap.start("inner");
  clock2.set(250);
  overlap.end("inner");
  clock2.set(400);
  overlap.end("outer");
  const snap2 = overlap.snapshot();
  t(
    "overlapping stages track independently (outer=400, inner=150)",
    snap2.stages.outer === 400 && snap2.stages.inner === 150,
    JSON.stringify(snap2)
  );

  const clock3 = fakeClock(0);
  const rerun = makeStageTimer(clock3);
  rerun.start("ground");
  clock3.set(100);
  rerun.end("ground");
  rerun.start("ground");
  clock3.set(150);
  rerun.end("ground");
  t("re-running a stage accumulates (100+50=150)", rerun.snapshot().stages.ground === 150);
  rerun.start("open-stage");
  t(
    "a still-open stage is not reported until it ends",
    rerun.snapshot().stages["open-stage"] === undefined
  );
}

/* ========================================================================== */
/* Guarded telemetry                                                          */
/* ========================================================================== */

{
  type SinkCall = { name: string; dims: Record<string, string | number | boolean> | undefined };
  const received: SinkCall[] = [];
  const spy: BrainTelemetrySink = {
    event: (name, dims) => {
      received.push({ name, dims });
    },
  };
  const guarded = guardedTelemetry(spy);

  guarded.event("parse.completed", { engine: "ai", latencyBucket: "lt500", outcome: "ok" });
  t(
    "allowlisted keys with valid values pass through",
    received.length === 1 &&
      received[0].name === "parse.completed" &&
      received[0].dims?.engine === "ai" &&
      received[0].dims?.latencyBucket === "lt500" &&
      received[0].dims?.outcome === "ok",
    JSON.stringify(received)
  );

  guarded.event("parse.completed", { engine: "ai", userText: "when a loan is approved" });
  t(
    "unknown dimension KEY is dropped entirely (known key survives)",
    received[1].dims?.engine === "ai" && !("userText" in (received[1].dims ?? {})),
    JSON.stringify(received[1])
  );

  guarded.event("parse.completed", { engine: "Totally Not An Engine!" });
  t(
    "known key with regex-failing value is dropped",
    received[2] !== undefined && !("engine" in (received[2].dims ?? {})),
    JSON.stringify(received[2])
  );

  guarded.event("parse.completed", { fallbackReason: "Wael said hi\n<script>" });
  const wire = JSON.stringify(received);
  t(
    "hostile dimension value never reaches the sink",
    !wire.includes("Wael") && !wire.includes("<script>"),
    wire
  );

  guarded.event("Invalid Event Name!", { engine: "ai" });
  t("invalid event NAME drops the whole call", received.length === 4, `${received.length} events`);

  const silent = guardedTelemetry(undefined);
  let threw = false;
  try {
    silent.event("parse.completed", { engine: "ai" });
  } catch {
    threw = true;
  }
  t("undefined sink → no-op, no throw", !threw);

  const bomb: BrainTelemetrySink = {
    event: () => {
      throw new Error("host sink exploded");
    },
  };
  let bombThrew = false;
  try {
    guardedTelemetry(bomb).event("parse.completed", { engine: "ai" });
  } catch {
    bombThrew = true;
  }
  t("a throwing host sink never propagates", !bombThrew);

  t(
    "allowlist exposes exactly the six contracted dimensions",
    JSON.stringify(Object.keys(TELEMETRY_DIMENSIONS).sort()) ===
      JSON.stringify(["engine", "event", "fallbackReason", "latencyBucket", "outcome", "source"]),
    JSON.stringify(Object.keys(TELEMETRY_DIMENSIONS))
  );
}

/* ========================================================================== */
/* Latency buckets                                                            */
/* ========================================================================== */

{
  const cases: Array<[number, string]> = [
    [0, "lt100"],
    [99, "lt100"],
    [100, "lt500"],
    [499, "lt500"],
    [500, "lt2000"],
    [1999, "lt2000"],
    [2000, "lt8000"],
    [7999, "lt8000"],
    [8000, "gte8000"],
    [123456, "gte8000"],
  ];
  const bad = cases.filter(([ms, expected]) => latencyBucket(ms) !== expected);
  t(
    "latencyBucket boundaries exact at 99/100/499/500/1999/2000/7999/8000",
    bad.length === 0,
    JSON.stringify(bad.map(([ms, exp]) => `${ms}→${latencyBucket(ms)} (want ${exp})`))
  );
  t("latencyBucket fails toward slow on NaN", latencyBucket(Number.NaN) === "gte8000");
}

/* ========================================================================== */
/* Cache keys + hashing                                                       */
/* ========================================================================== */

{
  const parts = {
    tenantKey: "organic-bank-of-america",
    parserVersion: "2026.07.24-1",
    promptVersion: "p1",
    inputHash: hashText("SECRET-CANARY"),
    optionsHash: hashText("{}"),
    vocabularyHash: "h-cafe0042",
  };
  const key = buildCacheKey(parts);
  t(
    "happy path: six parts joined with | in fixed order",
    key ===
      `organic-bank-of-america|2026.07.24-1|p1|${parts.inputHash}|${parts.optionsHash}|h-cafe0042`,
    key
  );

  let emptyThrew = false;
  try {
    buildCacheKey({ ...parts, tenantKey: "" });
  } catch {
    emptyThrew = true;
  }
  t("empty tenantKey throws (cross-tenant leak impossible by construction)", emptyThrew);

  let missingThrew = false;
  try {
    buildCacheKey({ ...parts, tenantKey: undefined } as unknown as typeof parts);
  } catch {
    missingThrew = true;
  }
  t("missing tenantKey throws", missingThrew);

  let missingVocabThrew = false;
  try {
    buildCacheKey({ ...parts, vocabularyHash: "" });
  } catch {
    missingVocabThrew = true;
  }
  t("every part is required (empty vocabularyHash throws too)", missingVocabThrew);

  const keyB = buildCacheKey({ ...parts, tenantKey: "second-tenant" });
  t("same content under two tenants → different keys", key !== keyB);

  t("raw input never embedded in the key (only its hash)", !key.includes("SECRET-CANARY"), key);

  let pipeThrew = false;
  try {
    buildCacheKey({ ...parts, tenantKey: "evil|tenant" });
  } catch {
    pipeThrew = true;
  }
  t("a part containing the separator is rejected (keys stay injective)", pipeThrew);

  t(
    "hashText format h-<8hex>",
    /^h-[0-9a-f]{8}$/.test(hashText("SECRET-CANARY")),
    hashText("SECRET-CANARY")
  );
  t("hashText deterministic", hashText("SECRET-CANARY") === hashText("SECRET-CANARY"));
  t("hashText discriminates inputs", hashText("SECRET-CANARY") !== hashText("SECRET-CANARX"));
}

/* ========================================================================== */
/* Retry policy — nothing is client-retried                                   */
/* ========================================================================== */

{
  const classes = ["timeout", "aborted", "transport", "shape", "rate-limit"] as const;
  const decisions = classes.map((c) => classifyForRetry(c));
  t(
    "no error class is ever client-retried (server owns retries)",
    decisions.every((d) => d.retry === false),
    JSON.stringify(decisions)
  );
  t(
    "every decision carries a distinct explanatory reason",
    decisions.every((d) => d.reason.length > 0) &&
      new Set(decisions.map((d) => d.reason)).size === classes.length,
    JSON.stringify(decisions.map((d) => d.reason))
  );
  t(
    "shape defects point at repair (orchestrator-owned), not retry",
    classifyForRetry("shape").reason.includes("repair")
  );
}

/* ========================================================================== */
/* Circuit breaker — full deterministic lifecycle                             */
/* ========================================================================== */

{
  const clock = fakeClock(0);
  const breaker = makeCircuitBreaker(clock); // defaults: 3 in 30s → open; 60s cooldown

  t(
    "breaker starts closed and allows requests",
    breaker.state() === "closed" && breaker.allowRequest()
  );

  breaker.onFailure(); // t=0
  clock.set(1_000);
  breaker.onFailure(); // t=1000
  t(
    "closed through 2 failures inside the failure window",
    breaker.state() === "closed" && breaker.allowRequest()
  );

  clock.set(2_000);
  breaker.onFailure(); // 3rd within 30s
  t("opens on the 3rd failure inside the failure window", breaker.state() === "open");
  t("allowRequest false while open", !breaker.allowRequest());

  clock.set(2_000 + 59_999);
  t(
    "still open one ms before the cooldown elapses",
    breaker.state() === "open" && !breaker.allowRequest()
  );

  clock.set(2_000 + 60_000);
  t("half-open once the cooldown elapses", breaker.state() === "half-open");
  const probe1 = breaker.allowRequest();
  const probe2 = breaker.allowRequest();
  t("half-open admits exactly one probe", probe1 === true && probe2 === false);

  breaker.onFailure(); // probe failed at t=62_000
  t("probe failure re-opens", breaker.state() === "open" && !breaker.allowRequest());

  clock.set(62_000 + 59_999);
  t("re-open carries a FRESH cooldown (still open at +59_999)", breaker.state() === "open");
  clock.set(62_000 + 60_000);
  t("half-open again after the fresh cooldown", breaker.state() === "half-open");
  t("one probe again", breaker.allowRequest() === true && breaker.allowRequest() === false);

  breaker.onSuccess(); // probe succeeded
  t("probe success closes the breaker", breaker.state() === "closed" && breaker.allowRequest());

  breaker.onFailure();
  breaker.onFailure();
  t("failure count was reset on close (2 new failures stay closed)", breaker.state() === "closed");
  breaker.onFailure();
  t("but a full fresh burst opens it again", breaker.state() === "open");

  // Failures spaced wider than the failure window must never accumulate.
  const clock2 = fakeClock(0);
  const spaced = makeCircuitBreaker(clock2);
  spaced.onFailure(); // t=0
  clock2.set(31_000);
  spaced.onFailure(); // t=0 already outside the 30s sliding window
  clock2.set(62_000);
  spaced.onFailure();
  t("failures OUTSIDE the sliding window don't accumulate", spaced.state() === "closed");
  clock2.set(62_100);
  spaced.onFailure();
  clock2.set(62_200);
  spaced.onFailure(); // 62_000 + 62_100 + 62_200 all inside one window
  t("three failures inside one window still trip it", spaced.state() === "open");

  const clock3 = fakeClock(0);
  const custom = makeCircuitBreaker(clock3, { failureThreshold: 1, windowMs: 10, cooldownMs: 20 });
  custom.onFailure();
  t("custom thresholds honored (1 failure trips)", custom.state() === "open");
  clock3.set(20);
  t("custom cooldown honored", custom.state() === "half-open");
}

/* ========================================================================== */
/* Diagnostics redaction                                                      */
/* ========================================================================== */

{
  const long = "x".repeat(300);
  const truncated = redactForDiagnostics(long);
  t("hard truncation to 120 chars", truncated.length === 120, `${truncated.length}`);
  t("truncation is visible (ellipsis-terminated)", truncated.endsWith("…"));

  const flattened = redactForDiagnostics("line one\nline two\r\nline three\tandbell");
  t(
    "newlines and control chars stripped",
    !/[\n\r\t]/.test(flattened) && flattened.includes("line one"),
    JSON.stringify(flattened)
  );

  const bearer = redactForDiagnostics("authorization failed: Bearer abc123 rejected upstream");
  t("Bearer token masked", !bearer.includes("abc123") && bearer.includes("«redacted»"), bearer);

  const sk = redactForDiagnostics("provider key sk-live-xyz was refused");
  t("sk-… key masked", !sk.includes("sk-live-xyz") && sk.includes("«redacted»"), sk);

  const goog = redactForDiagnostics("sent x-goog-api-key: AIzaVerySecret to the gateway");
  t("x-goog… header masked", !goog.includes("AIzaVerySecret"), goog);

  const masked = redactForDiagnostics(`Bearer ${"s".repeat(200)} trailing`);
  t(
    "masking runs before truncation (secret can't survive the cut)",
    !masked.includes("ssss") && masked.length <= 120,
    masked
  );
}

/* ========================================================================== */
/* Performance — parseInstruction, measured honestly                          */
/* ========================================================================== */

/** Representative sentence styles reused from assert-parser.ts. */
const PERF_SENTENCES: string[] = [
  "If there is a system error and booking status is Error, assign to Wael",
  "When a loan is approved and loan amount is at least 250k, assign to Underwriting Team",
  "When a Fiserv loan booking status is Error, notify Booking Team and add tag booking-failed",
  "When a loan is rejected, change stage to Closed",
  "When a loan is approved, assign to Santa Claus",
  "When a loan is approved, assign to wael and request tax returns",
  "When a document is approved, notify sara",
  "When a loan is approved, don't assign to Wael, notify Sara",
  "When a loan is approved and loan amount over 250k, notify sara",
  "When a loan is approved and risk grade worse than B, assign to wael",
  "When a loan over 500k is approved or rejected, escalate to the credit committee and add tag jumbo",
  "When a loan is approved, arm this rule, once per request, and cap 10 fires per hour",
  "When a loan is approved, remind Sara 5 days before the maturity date",
  "When a loan is approved, notify Sara otherwise add tag clean",
  "When a loan is approved for business customers, notify sara",
];

{
  const WARMUP = 10;
  const ITERATIONS = 40;

  for (let i = 0; i < WARMUP; i++) {
    for (const sentence of PERF_SENTENCES) parseInstruction(sentence);
  }

  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    for (const sentence of PERF_SENTENCES) {
      const begin = process.hrtime.bigint();
      parseInstruction(sentence);
      const finish = process.hrtime.bigint();
      samples.push(Number(finish - begin) / 1e6);
    }
  }

  samples.sort((a, b) => a - b);
  const pick = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
  const p50 = pick(0.5);
  const p95 = pick(0.95);

  console.log(
    `perf: parseInstruction p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms ` +
      `over ${samples.length} runs ` +
      `(${PERF_SENTENCES.length} sentences x ${ITERATIONS} iterations, ${WARMUP} warmups)`
  );

  t(
    "perf gate: p95 < 250ms (product target <100ms — see printed measurement)",
    p95 < 250,
    `p95=${p95.toFixed(3)}ms`
  );
  t("perf sanity: every sample measured a real parse (>0ms)", samples.every((s) => s > 0));
}

/* ========================================================================== */

if (failures > 0) {
  console.error(`\n✗ assert-brain-observability: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\n✓ brain observability contract holds and parse latency is within the gate.");
