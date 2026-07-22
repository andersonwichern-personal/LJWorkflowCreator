import { CanMatchFn, Routes } from '@angular/router';
import { WorkflowsApiService, provideWorkflowsService } from './features/workflows/data/workflows.service';

/**
 * DEV-HARNESS SEAM: in the admin monorepo this is the real
 * `authenticatedMatchGuard` (plus the shell route's retailer-employee guard).
 * Here it always allows — the standalone workspace has no auth boundary.
 */
export const authenticatedMatchGuard: CanMatchFn = () => true;

/**
 * Route shape lifted from the 2026-07-16 admin scan ("Recommended route shape
 * for Workflow Creator") so the feature registration transplants verbatim.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    providers: [WorkflowsApiService, provideWorkflowsService()],
    loadComponent: () =>
      import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
    canMatch: [authenticatedMatchGuard],
  },
  {
    path: 'workflows',
    data: { mobileLayout: 'responsive' },
    loadChildren: () => import('./features/workflows/workflows.routes').then((m) => m.routes),
    canMatch: [authenticatedMatchGuard],
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage),
    canMatch: [authenticatedMatchGuard],
  },
  {
    path: 'account',
    loadComponent: () => import('./features/account/account.page').then((m) => m.AccountPage),
    canMatch: [authenticatedMatchGuard],
  },
  { path: '**', redirectTo: 'dashboard' },
];
