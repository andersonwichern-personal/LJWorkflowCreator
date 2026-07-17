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
