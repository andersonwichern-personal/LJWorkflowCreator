/**
 * @sweet/rule-core — the framework-neutral rule spine for the Angular
 * Workflow Creator.
 *
 * PURE TypeScript ONLY. Framework, persistence, and DOM imports may not land
 * here — `scripts/assert-core-purity.ts` enforces the boundary and the package
 * tsconfig omits the "dom" lib so violations fail to compile.
 *
 * Semantic changes here flow into the generated Angular vendored copy.
 */
export * from "./types";
export * from "./vocabulary";
export * from "./conditionTree";
export * from "./fuzzy";
export * from "./platformData";
export * from "./ruleValidation";
export * from "./ruleEvaluator";
export * from "./ruleEngine";
export * from "./ruleLinter";
export * from "./nlParser";
