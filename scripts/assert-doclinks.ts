export {};

// Phase 8 §3 — exercises the REAL expiry-window predicate exported from
// lib/services/documentLink.ts (isExpiringWithin — pure, no prisma). The
// DB-bound queries reuse the same window semantics; the boundary math is
// what's assertable without a database.
//
// The service module imports the prisma client at load, so mirror the
// assert-fire idiom: load .env.local first, then dynamic-import (constructing
// the client reads DATABASE_URL but performs NO database access).

process.loadEnvFile?.(".env.local");

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const { isExpiringWithin } = await import("../lib/services/documentLink");

  const NOW = "2026-07-16T12:00:00.000Z";
  const DAY_MS = 86_400_000;
  const at = (offsetMs: number) => new Date(Date.parse(NOW) + offsetMs).toISOString();

  // Null never expires.
  t("null validUntil → false (never expires)", isExpiringWithin(null, 30, NOW) === false);

  // Inside the window.
  t("inside window (4 days out, 30-day window) → true", isExpiringWithin(at(4 * DAY_MS), 30, NOW) === true);
  t("inside window (1ms out) → true", isExpiringWithin(at(1), 30, NOW) === true);

  // Inclusive boundaries.
  t("exactly now → true (lower edge inclusive)", isExpiringWithin(NOW, 30, NOW) === true);
  t("exactly now + 30 days → true (upper edge inclusive)", isExpiringWithin(at(30 * DAY_MS), 30, NOW) === true);

  // Outside the window.
  t("1ms in the past → false (already expired)", isExpiringWithin(at(-1), 30, NOW) === false);
  t("long past → false", isExpiringWithin("2026-01-01T00:00:00.000Z", 30, NOW) === false);
  t("1ms beyond the window → false", isExpiringWithin(at(30 * DAY_MS + 1), 30, NOW) === false);
  t("far beyond the window → false", isExpiringWithin(at(365 * DAY_MS), 30, NOW) === false);

  // Window size is respected.
  t("7-day window excludes a 10-day expiry", isExpiringWithin(at(10 * DAY_MS), 7, NOW) === false);
  t("7-day window includes a 6-day expiry", isExpiringWithin(at(6 * DAY_MS), 7, NOW) === true);
  t("zero-day window: only 'exactly now' qualifies", isExpiringWithin(NOW, 0, NOW) === true && isExpiringWithin(at(1), 0, NOW) === false);

  // Determinism + garbage tolerance (pure function of its inputs).
  t("deterministic (same inputs twice)", isExpiringWithin(at(DAY_MS), 30, NOW) === isExpiringWithin(at(DAY_MS), 30, NOW));
  t("unparseable validUntil → false", isExpiringWithin("not-a-date", 30, NOW) === false);
  t("unparseable nowIso → false", isExpiringWithin(at(DAY_MS), 30, "garbage") === false);
}

main()
  .then(() => {
    if (failures) {
      console.error(`\n${failures} document-link assertion(s) FAILED`);
      process.exit(1);
    }
    console.log("\nAll document-link assertions passed.");
  })
  .catch((err) => {
    console.error("assert-doclinks crashed:", err);
    process.exit(1);
  });
