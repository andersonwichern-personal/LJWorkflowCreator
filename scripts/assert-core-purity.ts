/**
 * assert-core-purity — the wall that keeps @sweet/rule-core framework-neutral.
 *
 * The core feeds the generated Angular vendored copy. If UI-framework or
 * persistence bindings leak into it, they leak into Angular too. This test
 * fails the build immediately so the boundary survives without manual review.
 *
 * Run: tsx scripts/assert-core-purity.ts   (also `npm run assert:core-purity`)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CORE_DIR = join(__dirname, "..", "packages", "rule-core", "src");

/** Import specifiers that must never appear in the core. */
const BANNED_IMPORTS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /from\s+["']react["']|from\s+["']react-dom["']|from\s+["']react\//, why: "react" },
  { pattern: /from\s+["']next["']|from\s+["']next\//, why: "next" },
  { pattern: /from\s+["']@prisma\/|from\s+["']prisma["']/, why: "prisma" },
  { pattern: /from\s+["']@supabase\//, why: "supabase" },
  { pattern: /from\s+["']pg["']/, why: "pg (raw db driver)" },
  // No reaching back into the host tree — that reverses the dependency.
  { pattern: /from\s+["']@\/|from\s+["']\.\.\/\.\.\//, why: "host tree (@/… or ../../)" },
];

/** DOM/browser globals that betray a UI dependency. */
const BANNED_GLOBALS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bdocument\.\w/, why: "document" },
  { pattern: /\bwindow\.\w/, why: "window" },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const violations: string[] = [];
const files = walk(CORE_DIR);

for (const file of files) {
  const rel = file.slice(file.indexOf("packages"));
  if (file.endsWith(".tsx")) {
    violations.push(`${rel}: .tsx files are not allowed in the core (JSX is UI).`);
    continue;
  }
  const src = readFileSync(file, "utf8");
  for (const { pattern, why } of BANNED_IMPORTS) {
    if (pattern.test(src)) violations.push(`${rel}: imports ${why} — belongs outside the core.`);
  }
  for (const { pattern, why } of BANNED_GLOBALS) {
    if (pattern.test(src)) violations.push(`${rel}: references ${why} — the core must not touch the DOM.`);
  }
}

if (violations.length > 0) {
  console.error(`\n✗ @sweet/rule-core purity violated (${violations.length}):\n`);
  for (const v of violations) console.error(`  • ${v}`);
  console.error("\nThe rule core is framework-neutral. Move host-specific code outside it.\n");
  process.exit(1);
}

console.log(`✓ @sweet/rule-core is pure — ${files.length} files, no framework/DOM leakage.`);
