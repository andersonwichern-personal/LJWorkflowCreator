/**
 * TYPE-ONLY SHIM for existing `core/api` importers. `WorkflowRecord` lives in
 * the synced rule core (`./types`, generated from @sweet/rule-core), so this
 * module only re-exports the contract.
 */
export type { WorkflowRecord } from "./types";
