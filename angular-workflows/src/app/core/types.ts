/**
 * GENERATED from packages/rule-core/src/types.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/rule-core contract for the Angular track
 * (two-track doctrine: docs/agent/task.md). To change it, edit the package
 * and run `npm run sync:angular-core` at the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
import { WorkflowRule } from "./vocabulary";

/**
 * Persisted workflow record — the framework-neutral shape shared by every host
 * (Next.js API client, Angular admin console). The transport/persistence layer
 * lives per-track; this is only the contract they agree on.
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
