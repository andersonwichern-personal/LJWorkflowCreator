import { Routes } from '@angular/router';
import { requireInternalWorkflowTools } from './data/workflow-access-policy';
import { WorkflowsApiService, provideWorkflowsService } from './data/workflows.service';

/**
 * Lazy child routes for the /workflows feature — the transplant unit. In the
 * admin monorepo these register under the authenticated shell exactly like
 * /templates does (scan §1 "Route Registration Pattern"); the editor nests as
 * `:id/edit`, matching `/templates/forms/:uuid/edit`.
 */
export const routes: Routes = [
  {
    path: '',
    providers: [WorkflowsApiService, provideWorkflowsService()],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/workflows-list.page').then((m) => m.WorkflowsListPage),
      },
      {
        path: 'proposals',
        loadComponent: () => import('./pages/proposals.page').then((m) => m.ProposalsPage),
      },
      {
        // AI-first composer (roadmap MVP 2) — the client's default create
        // path. The token builder stays at `new/edit` for internal roles
        // (role gating proper is roadmap Phase 8).
        path: 'new',
        loadComponent: () =>
          import('./pages/workflow-composer.page').then((m) => m.WorkflowComposerPage),
      },
      {
        path: ':id/edit',
        canActivate: [requireInternalWorkflowTools],
        loadComponent: () =>
          import('./pages/workflow-builder.page').then((m) => m.WorkflowBuilderPage),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./pages/workflow-detail.page').then((m) => m.WorkflowDetailPage),
      },
    ],
  },
];
