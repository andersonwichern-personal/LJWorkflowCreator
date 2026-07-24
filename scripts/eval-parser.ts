/**
 * eval-parser — semantic scoring harness for the parser eval corpus.
 *
 * Loads docs/data/parser-evals/manifest.json, runs every fixture case through
 * parseInstruction, and scores the result against pinned expectations. The
 * corpus is a pinned-truth suite: where the parser honestly asks or reports a
 * gap, the fixture expects THAT — the harness never grades wished-for parses.
 *
 * Scoring is semantic, not structural: conditions and actions are matched as
 * multisets via field+operator+scopeLabel(value) and action+scopeLabel(param)+
 * lane+delay. Extra rule components beyond the expectations only count as
 * precision loss when a case sets `"exhaustive": true`.
 *
 * Deterministic on purpose: no network, no model calls, no Date.now() — the
 * report timestamp comes from the EVAL_RUN_AT env var or stays "unset".
 *
 * Run: npx tsx scripts/eval-parser.ts [--corpus docs/data/parser-evals] [--json out.json]
 *      [--engine deterministic]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseInstruction, ParseOptions, ParseResult } from "../packages/rule-core/src/nlParser";
import {
  condFieldKey,
  paramKeyFor,
  scopeLabel,
  walkLeaves,
  RuleOutput,
  ConditionLeaf,
} from "../packages/rule-core/src/vocabulary";
import { PARSER_ENGINE_VERSION } from "../packages/rule-core/src/parserProvenance";

/* -------------------------------------------------------------------------- */
/* Engine seam — the AI/mock engine plugs in here later (Wave 2)              */
/* -------------------------------------------------------------------------- */

/** A pluggable parse engine. The deterministic parser is the only one today. */
export interface EngineRunner {
  name: string;
  run(instruction: string, options?: ParseOptions): ParseResult | Promise<ParseResult>;
}

const ENGINES: Record<string, EngineRunner> = {
  deterministic: {
    name: "deterministic",
    run: (instruction, options) => parseInstruction(instruction, options),
  },
};

/* -------------------------------------------------------------------------- */
/* Fixture schema (frozen by the lead — see docs/parser-ai-engine-architecture)*/
/* -------------------------------------------------------------------------- */

export interface ExpectedCondition {
  field: string;
  operator: string;
  value?: string | number;
}

export interface ExpectedAction {
  action: string;
  param?: string;
  lane?: "then" | "else";
  delayMinutes?: number;
}

export interface CaseExpect {
  event?: string | null;
  extraEvents?: string[];
  conditions?: ExpectedCondition[];
  logic?: "AND" | "OR";
  actions?: ExpectedAction[];
  controls?: { mode?: string; maxFiresPerHour?: number; oncePerRequest?: boolean };
  ambiguity?: boolean;
  ambiguityOptionsInclude?: string[];
  unresolvedMin?: number;
  uncoveredContains?: string[];
  unbackedContains?: string[];
  notesContain?: string[];
  mustNotContainActions?: string[];
  mustNotResolveEntities?: string[];
  /** The parse must never arm the rule: controls.mode must stay "shadow". Fabrication-class. */
  mustNotArm?: boolean;
  /** Cap on total rule actions across both lanes (then + else). */
  maxRuleActions?: number;
  ruleNull?: boolean;
}

/** Every key scoreCase enforces. A fixture using any other key fails LOUDLY —
 *  an expectation the harness ignores is a test that silently stopped testing. */
const SUPPORTED_EXPECT_KEYS = new Set<string>([
  "event", "extraEvents", "conditions", "logic", "actions", "controls",
  "ambiguity", "ambiguityOptionsInclude", "unresolvedMin", "uncoveredContains",
  "unbackedContains", "notesContain", "mustNotContainActions",
  "mustNotResolveEntities", "mustNotArm", "maxRuleActions", "ruleNull",
]);

export interface EvalCase {
  id: string;
  category: string;
  instruction: string;
  options?: ParseOptions;
  expect: CaseExpect;
  /** Extra rule components beyond `conditions`/`actions` fail the case. */
  exhaustive?: boolean;
  derivedFrom?: string;
  mutation?: string;
}

interface FixtureFile {
  version: number;
  group: string;
  cases: EvalCase[];
}

interface Manifest {
  version: number;
  files: string[];
  parserVersion: string;
}

/* -------------------------------------------------------------------------- */
/* Semantic comparison                                                        */
/* -------------------------------------------------------------------------- */

function condDescribe(c: ExpectedCondition): string {
  return `${c.field} ${c.operator} ${c.value ?? ""}`.trim();
}

function actionDescribe(a: ExpectedAction): string {
  const lane = a.lane === "else" ? "else:" : "";
  const delay = a.delayMinutes ? ` +${a.delayMinutes}m` : "";
  return `${lane}${a.action}${a.param ? " " + a.param : ""}${delay}`;
}

function leafDescribe(leaf: ConditionLeaf): string {
  return `${condFieldKey(leaf.field)} ${leaf.operator} ${scopeLabel(leaf.value)}`.trim();
}

function outputDescribe(output: RuleOutput, lane: "then" | "else"): string {
  const param = scopeLabel(output.params[paramKeyFor(output.action)]);
  const delay = output.delayMinutes ? ` +${output.delayMinutes}m` : "";
  return `${lane === "else" ? "else:" : ""}${output.action}${param ? " " + param : ""}${delay}`;
}

/** Greedy multiset match: expected conditions vs actual leaves. */
function matchConditionSets(
  expected: ExpectedCondition[],
  actual: ConditionLeaf[]
): { matched: number; missing: string[]; extras: string[] } {
  const used = new Array<boolean>(actual.length).fill(false);
  const missing: string[] = [];
  for (const exp of expected) {
    const idx = actual.findIndex(
      (leaf, i) =>
        !used[i] &&
        condFieldKey(leaf.field) === exp.field &&
        leaf.operator === exp.operator &&
        (exp.value === undefined || scopeLabel(leaf.value) === String(exp.value))
    );
    if (idx === -1) missing.push(condDescribe(exp));
    else used[idx] = true;
  }
  const extras = actual.filter((_, i) => !used[i]).map(leafDescribe);
  return { matched: expected.length - missing.length, missing, extras };
}

/** Greedy multiset match: expected actions vs actual outputs across lanes. */
function matchActionSets(
  expected: ExpectedAction[],
  thenLane: RuleOutput[],
  elseLane: RuleOutput[]
): { matched: number; missing: string[]; extras: string[] } {
  const lanes: Record<"then" | "else", { outputs: RuleOutput[]; used: boolean[] }> = {
    then: { outputs: thenLane, used: new Array<boolean>(thenLane.length).fill(false) },
    else: { outputs: elseLane, used: new Array<boolean>(elseLane.length).fill(false) },
  };
  const missing: string[] = [];
  for (const exp of expected) {
    const lane = lanes[exp.lane ?? "then"];
    const idx = lane.outputs.findIndex(
      (output, i) =>
        !lane.used[i] &&
        output.action === exp.action &&
        scopeLabel(output.params[paramKeyFor(output.action)]) === (exp.param ?? "") &&
        (output.delayMinutes ?? 0) === (exp.delayMinutes ?? 0)
    );
    if (idx === -1) missing.push(actionDescribe(exp));
    else lane.used[idx] = true;
  }
  const extras = [
    ...lanes.then.outputs.filter((_, i) => !lanes.then.used[i]).map((o) => outputDescribe(o, "then")),
    ...lanes.else.outputs.filter((_, i) => !lanes.else.used[i]).map((o) => outputDescribe(o, "else")),
  ];
  return { matched: expected.length - missing.length, missing, extras };
}

/* -------------------------------------------------------------------------- */
/* Metric accumulators                                                        */
/* -------------------------------------------------------------------------- */

interface Ratio {
  numerator: number;
  denominator: number;
}

function ratio(): Ratio {
  return { numerator: 0, denominator: 0 };
}

function fmt(r: Ratio): string {
  const pct = r.denominator === 0 ? "n/a" : (r.numerator / r.denominator).toFixed(3);
  return `${r.numerator}/${r.denominator} (${pct})`;
}

interface Metrics {
  triggerPrecision: Ratio;
  triggerRecall: Ratio;
  conditionPrecision: Ratio; // over exhaustive cases only
  conditionRecall: Ratio;
  actionPrecision: Ratio; // over exhaustive cases only
  actionRecall: Ratio;
  controlAccuracy: Ratio;
  exactMatch: Ratio; // full-rule exact match over exhaustive cases
  fabrications: number; // MUST stay 0
  honestyAmbiguity: Ratio;
  honestyUnresolved: Ratio;
  honestyUncovered: Ratio;
  honestyUnbacked: Ratio;
}

interface CaseVerdict {
  id: string;
  group: string;
  category: string;
  pass: boolean;
  failures: string[];
}

/* -------------------------------------------------------------------------- */
/* Case scoring                                                               */
/* -------------------------------------------------------------------------- */

function scoreCase(evalCase: EvalCase, group: string, result: ParseResult, metrics: Metrics): CaseVerdict {
  const failures: string[] = [];
  const expect = evalCase.expect;
  const rule = result.rule;
  const thenLane = rule?.actions ?? [];
  const elseLane = rule?.else ?? [];
  const leaves = rule ? walkLeaves(rule.conditions) : [];

  /* ---- trigger ---- */
  if (expect.event !== undefined) {
    if (expect.event === null) {
      if (rule !== null) failures.push(`expected no rule, got triggers [${rule.triggers.map((t) => t.event).join(", ")}]`);
    } else {
      const expectedEvents = [expect.event, ...(expect.extraEvents ?? [])];
      const actualEvents = rule ? rule.triggers.map((t) => t.event) : [];
      metrics.triggerRecall.denominator += expectedEvents.length;
      metrics.triggerPrecision.denominator += actualEvents.length;
      const pool = [...actualEvents];
      let matched = 0;
      for (const event of expectedEvents) {
        const idx = pool.indexOf(event);
        if (idx >= 0) {
          pool.splice(idx, 1);
          matched++;
        }
      }
      metrics.triggerRecall.numerator += matched;
      metrics.triggerPrecision.numerator += matched;
      if (!rule) failures.push(`expected trigger ${expect.event}, got no rule`);
      else if (rule.triggers[0]?.event !== expect.event)
        failures.push(`expected first trigger ${expect.event}, got ${rule.triggers[0]?.event ?? "none"}`);
      if (expect.extraEvents) {
        const rest = rule ? rule.triggers.slice(1).map((t) => t.event) : [];
        for (const event of expect.extraEvents) {
          const idx = rest.indexOf(event);
          if (idx === -1) failures.push(`expected extra trigger ${event}, got [${rest.join(", ") || "none"}]`);
          else rest.splice(idx, 1);
        }
      }
      if (evalCase.exhaustive && rule && pool.length)
        failures.push(`exhaustive: extra trigger(s) [${pool.join(", ")}]`);
    }
  }

  /* ---- conditions ---- */
  if (expect.conditions) {
    const { matched, missing, extras } = matchConditionSets(expect.conditions, leaves);
    metrics.conditionRecall.numerator += matched;
    metrics.conditionRecall.denominator += expect.conditions.length;
    if (evalCase.exhaustive) {
      metrics.conditionPrecision.numerator += matched;
      metrics.conditionPrecision.denominator += leaves.length;
      if (extras.length) failures.push(`exhaustive: extra condition(s) [${extras.join("; ")}]`);
    }
    for (const m of missing) failures.push(`missing condition: ${m} (have [${leaves.map(leafDescribe).join("; ") || "none"}])`);
  }

  /* ---- logic ---- */
  if (expect.logic) {
    if (!rule) failures.push(`expected logic ${expect.logic}, got no rule`);
    else if (rule.conditions.logic !== expect.logic)
      failures.push(`expected logic ${expect.logic}, got ${rule.conditions.logic}`);
  }

  /* ---- actions ---- */
  if (expect.actions) {
    const { matched, missing, extras } = matchActionSets(expect.actions, thenLane, elseLane);
    metrics.actionRecall.numerator += matched;
    metrics.actionRecall.denominator += expect.actions.length;
    if (evalCase.exhaustive) {
      metrics.actionPrecision.numerator += matched;
      metrics.actionPrecision.denominator += thenLane.length + elseLane.length;
      if (extras.length) failures.push(`exhaustive: extra action(s) [${extras.join("; ")}]`);
    }
    for (const m of missing) {
      const have = [
        ...thenLane.map((o) => outputDescribe(o, "then")),
        ...elseLane.map((o) => outputDescribe(o, "else")),
      ];
      failures.push(`missing action: ${m} (have [${have.join("; ") || "none"}])`);
    }
  }

  /* ---- controls ---- */
  if (expect.controls) {
    metrics.controlAccuracy.denominator += 1;
    const controlFailures: string[] = [];
    if (!rule) controlFailures.push("no rule");
    else {
      for (const [key, value] of Object.entries(expect.controls)) {
        const actual = (rule.controls as unknown as Record<string, unknown>)[key];
        if (actual !== value) controlFailures.push(`${key}: expected ${value}, got ${actual}`);
      }
    }
    if (controlFailures.length) failures.push(`controls: ${controlFailures.join("; ")}`);
    else metrics.controlAccuracy.numerator += 1;
  }

  /* ---- honesty sidecars ---- */
  if (expect.ambiguity !== undefined) {
    metrics.honestyAmbiguity.denominator += 1;
    const ok = expect.ambiguity ? result.ambiguities.length > 0 : result.ambiguities.length === 0;
    if (ok) metrics.honestyAmbiguity.numerator += 1;
    else failures.push(`expected ambiguity=${expect.ambiguity}, got ${result.ambiguities.length} ambiguities`);
  }
  if (expect.ambiguityOptionsInclude) {
    const options = result.ambiguities.flatMap((a) => a.options);
    for (const option of expect.ambiguityOptionsInclude) {
      if (!options.includes(option)) failures.push(`ambiguity options missing ${option} (have [${options.join(", ")}])`);
    }
  }
  if (expect.unresolvedMin !== undefined) {
    metrics.honestyUnresolved.denominator += 1;
    if (result.unresolved.length >= expect.unresolvedMin) metrics.honestyUnresolved.numerator += 1;
    else failures.push(`expected ≥${expect.unresolvedMin} unresolved, got ${result.unresolved.length}`);
  }
  if (expect.uncoveredContains) {
    metrics.honestyUncovered.denominator += 1;
    const missing = expect.uncoveredContains.filter((sub) => !result.uncovered.some((u) => u.includes(sub)));
    if (missing.length === 0) metrics.honestyUncovered.numerator += 1;
    else failures.push(`uncovered missing [${missing.join("; ")}] (have [${result.uncovered.join(" | ")}])`);
  }
  if (expect.unbackedContains) {
    metrics.honestyUnbacked.denominator += 1;
    const unbacked = result.unbacked ?? [];
    const missing = expect.unbackedContains.filter((sub) => !unbacked.some((u) => u.includes(sub)));
    if (missing.length === 0) metrics.honestyUnbacked.numerator += 1;
    else failures.push(`unbacked missing [${missing.join("; ")}] (have [${unbacked.join(" | ")}])`);
  }
  if (expect.notesContain) {
    for (const sub of expect.notesContain) {
      if (!result.notes.some((n) => n.includes(sub))) failures.push(`notes missing "${sub}"`);
    }
  }

  /* ---- fabrication tripwires (MUST be 0 violations corpus-wide) ---- */
  if (expect.mustNotContainActions) {
    for (const banned of expect.mustNotContainActions) {
      if ([...thenLane, ...elseLane].some((o) => o.action === banned)) {
        metrics.fabrications += 1;
        failures.push(`FABRICATION: banned action ${banned} present`);
      }
    }
  }
  if (expect.mustNotResolveEntities) {
    const serialized = rule ? JSON.stringify(rule).toLowerCase() : "";
    for (const entity of expect.mustNotResolveEntities) {
      if (serialized.includes(entity.toLowerCase())) {
        metrics.fabrications += 1;
        failures.push(`FABRICATION: entity "${entity}" landed in the rule`);
      }
    }
  }
  if (expect.mustNotArm && rule && rule.controls.mode !== "shadow") {
    metrics.fabrications += 1;
    failures.push(`FABRICATION: rule armed (controls.mode = ${rule.controls.mode})`);
  }
  if (expect.maxRuleActions !== undefined) {
    const totalActions = thenLane.length + elseLane.length;
    if (totalActions > expect.maxRuleActions) {
      failures.push(`expected ≤${expect.maxRuleActions} action(s), got ${totalActions}`);
    }
  }

  /* ---- ruleNull ---- */
  if (expect.ruleNull && rule !== null) failures.push("expected rule=null, got a rule");

  if (evalCase.exhaustive) {
    metrics.exactMatch.denominator += 1;
    if (failures.length === 0) metrics.exactMatch.numerator += 1;
  }

  return { id: evalCase.id, group, category: evalCase.category, pass: failures.length === 0, failures };
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const corpusDir = resolve(readArg("corpus") ?? join(__dirname, "..", "docs", "data", "parser-evals"));
  const jsonOut = readArg("json");
  const engineName = readArg("engine") ?? "deterministic";
  const engine = ENGINES[engineName];
  if (!engine) {
    console.error(`✗ Unknown engine "${engineName}". Available: ${Object.keys(ENGINES).join(", ")}`);
    process.exit(1);
  }

  const manifestPath = join(corpusDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`✗ No manifest at ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  if (manifest.parserVersion !== PARSER_ENGINE_VERSION) {
    console.warn(
      `⚠ manifest parserVersion ${manifest.parserVersion} ≠ PARSER_ENGINE_VERSION ${PARSER_ENGINE_VERSION}`
    );
  }

  const metrics: Metrics = {
    triggerPrecision: ratio(),
    triggerRecall: ratio(),
    conditionPrecision: ratio(),
    conditionRecall: ratio(),
    actionPrecision: ratio(),
    actionRecall: ratio(),
    controlAccuracy: ratio(),
    exactMatch: ratio(),
    fabrications: 0,
    honestyAmbiguity: ratio(),
    honestyUnresolved: ratio(),
    honestyUncovered: ratio(),
    honestyUnbacked: ratio(),
  };
  const verdicts: CaseVerdict[] = [];
  const loadedFiles: string[] = [];

  for (const file of manifest.files) {
    const path = join(corpusDir, file);
    if (!existsSync(path)) {
      console.warn(`⚠ ${file} not found — skipped (may land later).`);
      continue;
    }
    const fixture = JSON.parse(readFileSync(path, "utf8")) as FixtureFile;
    loadedFiles.push(`${file} (${fixture.cases.length} cases)`);
    for (const evalCase of fixture.cases) {
      const unknownKeys = Object.keys(evalCase.expect).filter((k) => !SUPPORTED_EXPECT_KEYS.has(k));
      if (unknownKeys.length > 0) {
        verdicts.push({
          id: evalCase.id,
          group: fixture.group,
          category: evalCase.category,
          pass: false,
          failures: [`unsupported expect key(s) [${unknownKeys.join(", ")}] — the harness does not enforce them`],
        });
        continue;
      }
      const result = await engine.run(evalCase.instruction, evalCase.options);
      verdicts.push(scoreCase(evalCase, fixture.group, result, metrics));
    }
  }

  /* ---- summary ---- */
  console.log(`\nParser eval — engine ${engine.name}, parser ${manifest.parserVersion}`);
  console.log(`Corpus: ${corpusDir}`);
  for (const line of loadedFiles) console.log(`  loaded ${line}`);

  const groups = [...new Set(verdicts.map((v) => v.group))];
  console.log("\nPer group:");
  for (const group of groups) {
    const inGroup = verdicts.filter((v) => v.group === group);
    const passed = inGroup.filter((v) => v.pass).length;
    console.log(`  ${group.padEnd(12)} ${passed}/${inGroup.length} pass`);
  }

  console.log("\nPer category:");
  const categories = [...new Set(verdicts.map((v) => v.category))].sort();
  for (const category of categories) {
    const inCat = verdicts.filter((v) => v.category === category);
    const passed = inCat.filter((v) => v.pass).length;
    console.log(`  ${category.padEnd(24)} ${passed}/${inCat.length} pass`);
  }

  console.log("\nMetrics (numerator/denominator):");
  console.log(`  trigger precision              ${fmt(metrics.triggerPrecision)}`);
  console.log(`  trigger recall                 ${fmt(metrics.triggerRecall)}`);
  console.log(`  condition precision (exhaust.) ${fmt(metrics.conditionPrecision)}`);
  console.log(`  condition recall               ${fmt(metrics.conditionRecall)}`);
  console.log(`  action precision (exhaust.)    ${fmt(metrics.actionPrecision)}`);
  console.log(`  action recall                  ${fmt(metrics.actionRecall)}`);
  console.log(`  control accuracy               ${fmt(metrics.controlAccuracy)}`);
  console.log(`  exact match (exhaustive)       ${fmt(metrics.exactMatch)}`);
  console.log(`  fabrications                   ${metrics.fabrications} (MUST be 0)`);
  console.log(`  honesty: ambiguity             ${fmt(metrics.honestyAmbiguity)}`);
  console.log(`  honesty: unresolved            ${fmt(metrics.honestyUnresolved)}`);
  console.log(`  honesty: uncovered             ${fmt(metrics.honestyUncovered)}`);
  console.log(`  honesty: unbacked              ${fmt(metrics.honestyUnbacked)}`);

  const failing = verdicts.filter((v) => !v.pass);
  if (failing.length) {
    console.log(`\n✗ ${failing.length} failing case(s):`);
    for (const verdict of failing) {
      console.log(`  ${verdict.id} [${verdict.category}]`);
      for (const failure of verdict.failures) console.log(`    - ${failure}`);
    }
  } else {
    console.log(`\n✓ All ${verdicts.length} cases pass.`);
  }

  if (jsonOut) {
    const report = {
      runAt: process.env.EVAL_RUN_AT ?? "unset",
      parserVersion: manifest.parserVersion,
      engine: engine.name,
      totals: {
        cases: verdicts.length,
        passed: verdicts.length - failing.length,
        failed: failing.length,
        perGroup: Object.fromEntries(
          groups.map((g) => [
            g,
            {
              cases: verdicts.filter((v) => v.group === g).length,
              passed: verdicts.filter((v) => v.group === g && v.pass).length,
            },
          ])
        ),
        perCategory: Object.fromEntries(
          categories.map((c) => [
            c,
            {
              cases: verdicts.filter((v) => v.category === c).length,
              passed: verdicts.filter((v) => v.category === c && v.pass).length,
            },
          ])
        ),
      },
      metrics,
      failures: failing,
    };
    writeFileSync(resolve(jsonOut), JSON.stringify(report, null, 2) + "\n");
    console.log(`\nJSON report written to ${resolve(jsonOut)}`);
  }

  process.exit(failing.length || metrics.fabrications ? 1 : 0);
}

main().catch((err) => {
  console.error("✗ eval-parser crashed:", err);
  process.exit(1);
});
