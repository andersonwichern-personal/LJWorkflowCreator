/**
 * sync-angular-core — one-way sync gate from the packages to the Angular
 * application's vendored copies.
 *
 * The packages are the single source of truth; this script generates the
 * vendored copies and the check mode prevents drift.
 *
 *   npm run sync:angular-core           # regenerate the vendored copies
 *   tsx scripts/sync-angular-core.ts --check   # CI gate: fail on drift
 *
 * Two mirrors are managed (every .ts except index.ts — the package barrels;
 * Angular imports modules directly). Angular-owned files in the vendor dirs
 * (api.ts, fourEyes.ts, …) are never touched.
 *
 *   packages/rule-core/src/*.ts      → src/app/core/   (content verbatim)
 *   packages/workflow-brain/src/*.ts → src/app/brain/  (rule-core imports
 *                                      rewritten: ../../rule-core/src/ → ../core/)
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const ROOT = join(__dirname, "..");
const CHECK = process.argv.includes("--check");

/** Deterministic provenance banner — a pure function of the mirror + filename. */
function banner(sourcePrefix: string, packageName: string, name: string): string {
  return [
    "/**",
    ` * GENERATED from ${sourcePrefix}${name} — DO NOT EDIT BY HAND.`,
    ` * Vendored copy of the ${packageName} contract for Angular.`,
    " * To change it, edit the package and run `npm run sync:angular-core` at",
    " * the repo root. `npm test` fails",
    " * on drift via this script's --check mode.",
    " */",
    "",
  ].join("\n");
}

interface Mirror {
  packageName: string;
  /** Human label used in drift/check messages. */
  label: string;
  srcDir: string;
  vendorDir: string;
  /** True source path prefix named in the banner. */
  sourcePrefix: string;
  /** Content transform applied before the banner is prepended. */
  rewrite: (content: string) => string;
}

const MIRRORS: Mirror[] = [
  {
    packageName: "@sweet/rule-core",
    label: "Angular vendored core",
    srcDir: join(ROOT, "packages", "rule-core", "src"),
    vendorDir: join(ROOT, "src", "app", "core"),
    sourcePrefix: "packages/rule-core/src/",
    rewrite: (content) => content,
  },
  {
    packageName: "@sweet/workflow-brain",
    label: "Angular vendored brain",
    srcDir: join(ROOT, "packages", "workflow-brain", "src"),
    vendorDir: join(ROOT, "src", "app", "brain"),
    sourcePrefix: "packages/workflow-brain/src/",
    // The vendored brain sits one level under src/app, next to the vendored
    // core — the package-relative reach becomes a sibling-directory reach.
    rewrite: (content) => content.split("../../rule-core/src/").join("../core/"),
  },
];

let failed = false;

for (const mirror of MIRRORS) {
  const managed = readdirSync(mirror.srcDir)
    .filter((f) => f.endsWith(".ts") && f !== "index.ts")
    .sort();

  if (managed.length === 0) {
    console.error(`✗ sync-angular-core: no source files found in ${mirror.sourcePrefix}`);
    process.exit(1);
  }

  const drifted: string[] = [];
  let written = 0;

  for (const file of managed) {
    const source = readFileSync(join(mirror.srcDir, file), "utf8");
    const expected = banner(mirror.sourcePrefix, mirror.packageName, basename(file)) + mirror.rewrite(source);
    const target = join(mirror.vendorDir, file);
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
      mkdirSync(mirror.vendorDir, { recursive: true });
      writeFileSync(target, expected);
      written++;
      console.log(`  synced ${file}`);
    }
  }

  if (CHECK) {
    if (drifted.length > 0) {
      failed = true;
      console.error(`\n✗ ${mirror.label} has drifted from ${mirror.packageName} (${drifted.length}):\n`);
      for (const f of drifted) console.error(`  • ${f}`);
      console.error("\nRun `npm run sync:angular-core` at the repo root and commit the result.\n");
    } else {
      console.log(`✓ ${mirror.label} in sync — ${managed.length} files match ${mirror.packageName}.`);
    }
  } else {
    console.log(
      written === 0
        ? `✓ Nothing to sync — ${managed.length} files already match ${mirror.packageName}.`
        : `✓ Synced ${written}/${managed.length} ${mirror.packageName} files into ${mirror.vendorDir.slice(ROOT.length + 1)}/.`
    );
  }
}

if (CHECK && failed) {
  process.exit(1);
}
