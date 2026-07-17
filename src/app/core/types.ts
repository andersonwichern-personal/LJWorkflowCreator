/**
 * GENERATED from packages/rule-core/src/types.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/rule-core contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
import { WorkflowRule } from "./vocabulary";

/**
 * Persisted workflow record — the framework-neutral shape consumed by Angular
 * services and core evaluators. Transport and persistence stay outside the core.
 */
export interface WorkflowRecord {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  ruleJson: WorkflowRule;
  /** Phase 8 §12 — optimistic-concurrency version; echo back as expectedVersion on save. */
  version: number;
  createdAt: string;
  updatedAt: string;
  pendingProposalId?: string;
  proposalStatus?: string;
}
