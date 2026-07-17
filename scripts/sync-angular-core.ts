/**
 * sync-angular-core — one-way sync gate from @sweet/rule-core to the Angular
 * track's vendored copy at src/app/core/.
 *
 * The two-track doctrine (docs/agent/task.md) says a semantic change to the
 * rule core must land on both tracks. This script makes that mechanical:
 * the package is the single source of truth; the vendored copy is generated.
 *
 *   npm run sync:angular-core           # regenerate the vendored copy
 *   tsx scripts/sync-angular-core.ts --check   # CI gate: fail on drift
 *
 * Managed set: every .ts in packages/rule-core/src except index.ts (the
 * package barrel — Angular imports modules directly). Angular-owned files in
 * src/app/core/ (api.ts, fourEyes.ts, …) are never touched.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const ROOT = join(__dirname, "..");
const PKG_SRC = join(ROOT, "packages", "rule-core", "src");
const VENDOR_DIR = join(ROOT, "src", "app", "core");

const CHECK = process.argv.includes("--check");

/** Deterministic provenance banner — a pure function of the filename. */
function banner(name: string): string {
  return [
    "/**",
    ` * GENERATED from packages/rule-core/src/${name} — DO NOT EDIT BY HAND.`,
    " * Vendored copy of the @sweet/rule-core contract for the Angular track",
    " * (two-track doctrine: docs/agent/task.md). To change it, edit the package",
    " * and run `npm run sync:angular-core` at the repo root. `npm test` fails",
    " * on drift via this script's --check mode.",
    " */",
    "",
  ].join("\n");
}

const managed = readdirSync(PKG_SRC)
  .filter((f) => f.endsWith(".ts") && f !== "index.ts")
  .sort();

if (managed.length === 0) {
  console.error("✗ sync-angular-core: no source files found in packages/rule-core/src");
  process.exit(1);
}

const drifted: string[] = [];
let written = 0;

for (const file of managed) {
  const expected = banner(basename(file)) + readFileSync(join(PKG_SRC, file), "utf8");
  const target = join(VENDOR_DIR, file);
  let actual: string | null = null;
  try {
    actual = readFileSync(target, "utf8");
  } catch {
    /* missing → drift */
  }
  if (actual === expected) continue;
  if (CHECK) {
    drifted.push(actual === null ? `${file} (missing)` : file);
  } else {
    writeFileSync(target, expected);
    written++;
    console.log(`  synced ${file}`);
  }
}

if (CHECK) {
  if (drifted.length > 0) {
    console.error(`\n✗ Angular vendored core has drifted from @sweet/rule-core (${drifted.length}):\n`);
    for (const f of drifted) console.error(`  • ${f}`);
    console.error("\nRun `npm run sync:angular-core` at the repo root and commit the result.\n");
    process.exit(1);
  }
  console.log(`✓ Angular vendored core in sync — ${managed.length} files match @sweet/rule-core.`);
} else {
  console.log(
    written === 0
      ? `✓ Nothing to sync — ${managed.length} files already match.`
      : `✓ Synced ${written}/${managed.length} files into src/app/core/.`
  );
}
