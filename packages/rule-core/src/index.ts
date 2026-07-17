/**
 * @sweet/rule-core — the framework-neutral rule spine shared by both tracks
 * (Next.js "Vercel" track and the Angular admin console).
 *
 * PURE TypeScript ONLY. No react, next, prisma, supabase, or DOM imports may
 * ever land in this package — `scripts/assert-core-purity.ts` enforces it and
 * the package tsconfig omits the "dom" lib so violations fail to compile.
 *
 * A semantic change here is a change to the contract BOTH tracks depend on.
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
