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
// Later Brain modules (contextCompiler, orchestrator, consultant, …) are added
// here by the lead at integration — do not add exports in specialist branches.
