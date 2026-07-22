import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { UserSessionService } from '../../../core/user-session.service';
import { WorkflowsService } from '../data/workflows.service';

/**
 * The Workflows hub's internal pages presented as tabs — All Workflows /
 * Reviews / Create-or-Propose — mounted at the top of the list, review-queue,
 * and composer views. The rail stays flat (side-nav-v2 spec, commit 72576c9):
 * these pages never nest under it, and Dashboard is a top-level rail
 * destination, not a subtab, so it does not appear here.
 *
 * Reviews carries the pending-proposal count. Hosts that already hold fresher
 * data (the queue page itself, the list's row markers) pass [pendingCount];
 * otherwise the component fetches once from the route-scoped WorkflowsService.
 * The create tab is role-aware: makers (junior analysts) see "Propose
 * workflow" because their submissions enter the review queue.
 */
@Component({
  selector: 'wf-workflows-tabs',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="workflows-tabs" aria-label="Workflows sections">
      <a routerLink="/workflows" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
        All Workflows
      </a>
      <a routerLink="/workflows/proposals" routerLinkActive="active">
        Reviews
        @if (pending(); as count) {
          <span class="badge" [attr.aria-label]="count + ' pending'">{{ count }}</span>
        }
      </a>
      <a routerLink="/workflows/new" routerLinkActive="active">
        {{ session.mustProposeWorkflow() ? 'Propose workflow' : 'Create workflow' }}
      </a>
    </nav>
  `,
  styles: `
    :host { display: block; }
    .workflows-tabs {
      display: flex; align-items: stretch; gap: var(--space-1);
      border-bottom: 1px solid var(--border);
      overflow-x: auto;
    }
    a {
      min-height: 40px; display: inline-flex; align-items: center; gap: var(--space-2);
      margin-bottom: -1px; padding: 0 var(--space-3);
      border-bottom: 2px solid transparent;
      color: var(--text-dim); font-size: var(--text-sm); font-weight: 750;
      text-decoration: none; white-space: nowrap;
      transition: color var(--motion-fast) ease, border-color var(--motion-fast) ease;
    }
    a:hover { color: var(--text); }
    a.active { border-bottom-color: var(--brand); color: var(--brand-text); }
    .badge {
      min-width: 1.35rem; height: 1.35rem; display: inline-grid; place-items: center;
      padding: 0 0.35rem; border-radius: var(--radius-pill);
      background: var(--warn-bg); color: var(--warn-text);
      font-size: 0.68rem; font-weight: 850;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowsTabs {
  protected readonly session = inject(UserSessionService);
  private readonly service = inject(WorkflowsService);

  /** Live count from the host page; when omitted the component fetches once. */
  readonly pendingCount = input<number | null>(null);
  private readonly fetched = signal<number | null>(null);
  protected readonly pending = computed(() => this.pendingCount() ?? this.fetched() ?? 0);

  constructor() {
    this.service.listProposals().subscribe({
      next: (rows) => this.fetched.set(rows.filter((p) => p.status === 'pending').length),
      error: () => this.fetched.set(null), // badge stays hidden; tabs still navigate
    });
  }
}
