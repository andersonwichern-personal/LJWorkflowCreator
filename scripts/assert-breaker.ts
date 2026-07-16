export {};

// Phase 8 §11 — exercises the REAL circuit-breaker state machine
// (lib/circuitBreaker.ts): threshold opening, fail-fast, cooldown trials,
// half-open transitions, garbage normalization, and determinism (fixed clock).

import {
  BreakerState,
  DEFAULT_BREAKER_CONFIG,
  breakerAllows,
  breakerNext,
  closedBreaker,
  normalizeBreakerState,
} from "../lib/circuitBreaker";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

function deepEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Fixed clock: base instant + millisecond offsets — no Date.now() anywhere.
const BASE = Date.parse("2026-07-16T10:00:00.000Z");
const at = (offsetMs: number) => new Date(BASE + offsetMs).toISOString();
const COOLDOWN = DEFAULT_BREAKER_CONFIG.cooldownMs;

t("default config: threshold 3, cooldown 60s", DEFAULT_BREAKER_CONFIG.threshold === 3 && COOLDOWN === 60_000);

// 1. closed → open at threshold 3 (default config).
let s: BreakerState = closedBreaker();
t("fresh breaker is closed with zero failures", deepEq(s, { status: "closed", consecutiveFailures: 0, openedAt: null }));
s = breakerNext(s, "failure", at(0));
t("1st failure stays closed", s.status === "closed" && s.consecutiveFailures === 1, JSON.stringify(s));
t("closed breaker still allows calls", breakerAllows(s, at(500)));
s = breakerNext(s, "failure", at(1_000));
t("2nd failure stays closed", s.status === "closed" && s.consecutiveFailures === 2, JSON.stringify(s));
s = breakerNext(s, "failure", at(2_000));
t("3rd failure opens the circuit", s.status === "open" && s.consecutiveFailures === 3, JSON.stringify(s));
t("openedAt is the opening failure's instant", s.openedAt === at(2_000), String(s.openedAt));

// 2. Open circuit fails fast until the cooldown elapses.
t("open blocks immediately", breakerAllows(s, at(2_000)) === false);
t("open blocks 1ms before cooldown", breakerAllows(s, at(2_000 + COOLDOWN - 1)) === false);
t("open allows exactly at cooldown", breakerAllows(s, at(2_000 + COOLDOWN)) === true);
t("open allows well after cooldown", breakerAllows(s, at(2_000 + 10 * COOLDOWN)) === true);

// 3. Half-open trial failure re-opens with a FRESH openedAt (cooldown restarts).
const trialAt = at(2_000 + COOLDOWN);
const reopened = breakerNext(s, "failure", trialAt);
t("trial failure re-opens", reopened.status === "open", JSON.stringify(reopened));
t("re-open carries a fresh openedAt", reopened.openedAt === trialAt, String(reopened.openedAt));
t("failure count keeps accumulating", reopened.consecutiveFailures === 4, String(reopened.consecutiveFailures));
t(
  "re-opened circuit blocks until its NEW cooldown",
  breakerAllows(reopened, at(2_000 + 2 * COOLDOWN - 1)) === false &&
    breakerAllows(reopened, at(2_000 + 2 * COOLDOWN)) === true
);

// Explicit half-open state (persisted mid-trial) behaves the same on failure.
const halfOpen: BreakerState = { status: "half-open", consecutiveFailures: 3, openedAt: at(2_000) };
t("half-open state allows the trial call", breakerAllows(halfOpen, at(2_500)));
const halfOpenFailed = breakerNext(halfOpen, "failure", at(3_000));
t("half-open failure re-opens with fresh openedAt", halfOpenFailed.status === "open" && halfOpenFailed.openedAt === at(3_000), JSON.stringify(halfOpenFailed));

// 4. Success from ANY state resets to a fresh closed breaker.
for (const [label, state] of [
  ["closed-with-failures", { status: "closed", consecutiveFailures: 2, openedAt: null }],
  ["open", reopened],
  ["half-open", halfOpen],
] as [string, BreakerState][]) {
  t(`success from ${label} → closedBreaker()`, deepEq(breakerNext(state, "success", at(5_000)), closedBreaker()));
}

// 5. normalizeBreakerState: garbage → fresh closed; valid state round-trips.
for (const garbage of [null, undefined, "garbage", 42, [], { status: "weird", consecutiveFailures: -5, openedAt: 42 }]) {
  t(`normalize(${JSON.stringify(garbage) ?? "undefined"}) → closed`, deepEq(normalizeBreakerState(garbage), closedBreaker()));
}
const persisted: BreakerState = { status: "open", consecutiveFailures: 3, openedAt: at(2_000) };
t("normalize round-trips a valid state", deepEq(normalizeBreakerState(JSON.parse(JSON.stringify(persisted))), persisted));
t("normalize floors fractional failure counts", normalizeBreakerState({ status: "closed", consecutiveFailures: 2.9, openedAt: null }).consecutiveFailures === 2);

// 6. Determinism: identical inputs → deep-equal outputs, every time.
const detIn: BreakerState = { status: "closed", consecutiveFailures: 2, openedAt: null };
t("breakerNext is deterministic", deepEq(breakerNext(detIn, "failure", at(7_000)), breakerNext(detIn, "failure", at(7_000))));
t("breakerAllows is deterministic", breakerAllows(persisted, at(50_000)) === breakerAllows(persisted, at(50_000)));
t("breakerNext does not mutate its input", deepEq(detIn, { status: "closed", consecutiveFailures: 2, openedAt: null }));

if (failures) {
  console.error(`\n${failures} breaker assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll breaker assertions passed.");
