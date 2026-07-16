/**
 * TYPE-ONLY SHIM of the Vercel track's lib/api.ts, carrying just the
 * `WorkflowRecord` shape that core/ruleEngine.ts imports. The rest of
 * lib/api.ts is a same-origin Next.js fetch client — explicitly on the
 * do-not-carry-over list (two-track doctrine) — so it is NOT ported.
 * Keep this type in lockstep with lib/api.ts's WorkflowRecord.
 */
import { WorkflowRule } from './vocabulary';

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
