import { CanMatchFn, Routes } from '@angular/router';

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
  { path: '', pathMatch: 'full', redirectTo: 'workflows' },
  {
    path: 'workflows',
    data: { mobileLayout: 'responsive' },
    loadChildren: () => import('./features/workflows/workflows.routes').then((m) => m.routes),
    canMatch: [authenticatedMatchGuard],
  },
  { path: '**', redirectTo: 'workflows' },
];
