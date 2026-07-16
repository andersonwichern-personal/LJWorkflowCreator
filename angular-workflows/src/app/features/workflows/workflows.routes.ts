import { Routes } from '@angular/router';
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
        path: ':id/edit',
        loadComponent: () =>
          import('./pages/workflow-builder.page').then((m) => m.WorkflowBuilderPage),
      },
    ],
  },
];
