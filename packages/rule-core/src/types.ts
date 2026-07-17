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
