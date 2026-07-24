/**
 * @sweet/workflow-brain — package barrel.
 *
 * Angular never imports this file; it imports the vendored copies under
 * src/app/brain/ (managed by scripts/sync-angular-core.ts). Core tests import
 * modules directly by path.
 */
export * from "./ports";
export * from "./context";
export * from "./brainState";
export * from "./contextCompiler";
export * from "./aiPort";
export * from "./orchestrator";
export * from "./candidateNormalization";
export * from "./proposals";
export * from "./recommendations";
export * from "./consultant";
export * from "./ghostSuggestions";
export * from "./observability";
