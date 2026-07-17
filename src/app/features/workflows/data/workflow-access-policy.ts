import { InjectionToken, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export type WorkflowInternalAuditAction =
  | 'internal-tools-opened'
  | 'definition-write-requested';

export interface WorkflowInternalAuditEvent {
  action: WorkflowInternalAuditAction;
  workflowId?: string;
  occurredAt: string;
}

/**
 * Host-owned authorization and audit seam for technical workflow editing.
 * The standalone client fails closed: the admin shell must explicitly grant
 * the capability and provide its durable audit writer.
 */
export interface WorkflowAccessPolicy {
  canUseInternalTools: boolean;
  record(event: WorkflowInternalAuditEvent): void;
}

export const WORKFLOW_ACCESS_POLICY = new InjectionToken<WorkflowAccessPolicy>(
  'WORKFLOW_ACCESS_POLICY',
  {
    providedIn: 'root',
    factory: () => ({ canUseInternalTools: false, record: () => undefined }),
  }
);

/** Deny and redirect unless the authenticated host grants and audits access. */
export const requireInternalWorkflowTools: CanActivateFn = (route) => {
  const policy = inject(WORKFLOW_ACCESS_POLICY);
  const router = inject(Router);
  if (!policy.canUseInternalTools) return router.createUrlTree(['/workflows']);

  try {
    policy.record({
      action: 'internal-tools-opened',
      workflowId: route.paramMap.get('id') ?? undefined,
      occurredAt: new Date().toISOString(),
    });
    return true;
  } catch {
    // An internal editor that cannot be audited is not an authorized editor.
    return router.createUrlTree(['/workflows']);
  }
};
