export {};

// Phase 8 §12 — exercises the REAL optimistic-concurrency primitives
// (lib/optimisticWrite.ts): the conflict error's payload, the shared 409
// body shape, and the type-guard discrimination routes rely on.

import {
  VersionConflictError,
  conflictPayload,
  isVersionConflict,
} from "../lib/optimisticWrite";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

// 1. VersionConflictError carries the server's version + current record.
const current = { id: "wf-1", name: "Renewal chase", version: 7 };
const err = new VersionConflictError(7, current);
t("carries currentVersion", err.currentVersion === 7);
t("carries the current record by reference", err.current === current);
t("is a real Error", err instanceof Error);
t("has the discriminating name", err.name === "VersionConflictError");
t("message names the server version", err.message.includes("7"), err.message);

// 2. conflictPayload: the exact 409 body shape shared by every guarded route.
const payload = conflictPayload(err);
t("payload.conflict is literal true", payload.conflict === true);
t("payload.currentVersion mirrors the error", payload.currentVersion === 7);
t("payload.current passes the record through", payload.current === current);
t("payload.error is the error message", payload.error === err.message);
t(
  "payload has exactly { error, conflict, currentVersion, current }",
  JSON.stringify(Object.keys(payload).sort()) === JSON.stringify(["conflict", "current", "currentVersion", "error"]),
  Object.keys(payload).join(",")
);
t("payload survives JSON round-trip intact", JSON.stringify(JSON.parse(JSON.stringify(payload))) === JSON.stringify(payload));

// A different version/record produces a matching payload (no hardcoding).
const err2 = new VersionConflictError(41, null);
const payload2 = conflictPayload(err2);
t("payload tracks a different version", payload2.currentVersion === 41 && payload2.current === null);

// 3. isVersionConflict: true/false discrimination.
t("isVersionConflict(VersionConflictError) → true", isVersionConflict(err) === true);
t("isVersionConflict(plain Error) → false", isVersionConflict(new Error("nope")) === false);
t("isVersionConflict(look-alike object) → false", isVersionConflict({ currentVersion: 7, current, name: "VersionConflictError" }) === false);
t("isVersionConflict(null) → false", isVersionConflict(null) === false);
t("isVersionConflict(undefined) → false", isVersionConflict(undefined) === false);
t("isVersionConflict(string) → false", isVersionConflict("conflict") === false);

// The guard narrows: after the check, typed fields are reachable.
const unknownErr: unknown = err;
if (isVersionConflict(unknownErr)) {
  t("guard narrows to the typed error", unknownErr.currentVersion === 7 && unknownErr.current === current);
} else {
  t("guard narrows to the typed error", false, "guard rejected a genuine VersionConflictError");
}

if (failures) {
  console.error(`\n${failures} version-guard assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll version-guard assertions passed.");
