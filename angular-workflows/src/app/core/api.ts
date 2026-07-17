/**
 * TYPE-ONLY SHIM for the Angular track. The Vercel track's lib/api.ts is a
 * same-origin Next.js fetch client — explicitly on the do-not-carry-over list
 * (two-track doctrine) — so it is NOT ported. The `WorkflowRecord` shape now
 * lives in the synced rule core (./types, generated from @sweet/rule-core),
 * so this shim just re-exports it for existing `core/api` importers.
 */
export type { WorkflowRecord } from "./types";
