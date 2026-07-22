import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { interpretRule } from '../../../core/interpretation';
import { STATE_LABELS, workflowState } from '../../../core/orgPolicy';
import { lintRule } from '../../../core/ruleLinter';
import {
  WorkflowRule,
  condFieldLabel,
  getAction,
  isValuelessOperator,
  paramKeyFor,
  scopeLabel,
  walkLeaves,
} from '../../../core/vocabulary';
import { ConfirmationDialog } from '../../../shared/confirmation-dialog';
import { LJ_PRIMITIVES } from '../../../shared/lj/lj';
import {
  SaveOutcome,
  WorkflowRecord,
  WorkflowsService,
} from '../data/workflows.service';

type PendingAction = 'activate' | 'pause' | 'resume' | 'delete';

interface ConfirmationState {
  action: PendingAction;
  row: WorkflowRecord;
  title: string;
  description: string;
  confirmLabel: string;
  danger: boolean;
}

function armedRule(rule: WorkflowRule): WorkflowRule {
  return { ...rule, controls: { ...rule.controls, mode: 'armed' } };
}

/** Structural, semantic, and completeness gate for any transition into live actions. */
function activationBlocker(rule: WorkflowRule): string | null {
  const candidate = armedRule(rule);
  if (candidate.actions.length === 0) return 'Add at least one action before activation.';

  const incompleteCondition = walkLeaves(candidate.conditions).find(
    (condition) =>
      !isValuelessOperator(condition.operator) && !scopeLabel(condition.value).trim()
  );
  if (incompleteCondition) {
    return `${condFieldLabel(incompleteCondition.field)} still needs a value.`;
  }

  const incompleteAction = [...candidate.actions, ...(candidate.else ?? [])].find((action) => {
    const definition = getAction(action.action);
    return (
      definition?.paramKind !== undefined &&
      definition.paramKind !== 'none' &&
      !scopeLabel(action.params[paramKeyFor(action.action)]).trim()
    );
  });
  if (incompleteAction) {
    return `${getAction(incompleteAction.action)?.label ?? 'An action'} still needs a destination or value.`;
  }

  return lintRule(candidate).issues.find((issue) => issue.severity === 'error')?.message ?? null;
}

/** Client-facing workflow index: an editorial operations view, not a rule table. */
@Component({
  selector: 'wf-workflows-list-page',
  imports: [...LJ_PRIMITIVES, RouterLink, DatePipe, ConfirmationDialog],
  template: `
    <lj-page>
      <header header class="page-header">
        <lj-box class="header" [padding]="0">
          <div class="header-inner">
            <div class="heading-copy">
              <p class="eyebrow">Operations</p>
              <h1 lj-page-heading>Workflows</h1>
              <p class="intro">See what is running, what is being observed, and what needs you.</p>
            </div>
          </div>
        </lj-box>
      </header>

      <section class="overview" aria-label="Workflow overview">
        <p><strong>{{ rows().length }}</strong> total</p>
        <p><strong>{{ activeCount() }}</strong> active</p>
        <p><strong>{{ observingCount() }}</strong> observing</p>
        <p [class.attention-count]="attentionCount() > 0">
          <strong>{{ attentionCount() }}</strong> need attention
        </p>
      </section>

      <div class="list-tools">
        <label class="search-label" for="workflow-search">Find a workflow</label>
        <div class="search-wrap">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.5"></circle>
            <path d="m16 16 4 4"></path>
          </svg>
          <input
            id="workflow-search"
            class="search"
            type="search"
            placeholder="Search by name or purpose"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
        </div>
      </div>

      <div class="announcements" aria-live="polite">
        @if (notice(); as message) {
          <p class="notice">{{ message }}</p>
        }
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
      </div>

      @if (loading()) {
        <div class="loading" role="status">
          <span class="loading-line"></span>
          <span class="loading-line short"></span>
          <span class="sr-only">Loading workflows…</span>
        </div>
      } @else if (filtered().length === 0) {
        <section class="empty">
          <p class="eyebrow">{{ query().trim() ? 'No match' : 'A clear slate' }}</p>
          <h2>{{ query().trim() ? 'No workflows found' : 'Create your first workflow' }}</h2>
          <p>
            {{
              query().trim()
                ? 'Try a different name or phrase.'
                : 'Describe the operational outcome you want. Sweet will help you review it before anything runs.'
            }}
          </p>
          @if (!query().trim()) {
            <button lj-button class="primary" type="button" (click)="create()">
              Create workflow
            </button>
          }
        </section>
      } @else {
        <section class="workflow-index data-surface" aria-labelledby="workflow-index-title">
          <h2 id="workflow-index-title" class="sr-only">Your workflows</h2>
          <div class="column-headings" aria-hidden="true">
            <span>Workflow and purpose</span>
            <span>Status</span>
            <span>Recent activity</span>
            <span>Attention</span>
            <span></span>
          </div>
          <ul class="workflow-list">
            @for (row of filtered(); track row.id) {
              <li class="workflow-row">
                <div class="identity">
                  <a class="name" [routerLink]="['/workflows', row.id]">{{ row.name }}</a>
                  <p class="purpose">{{ purpose(row) }}</p>
                </div>
                <div class="meta status-meta">
                  <span class="mobile-label">Status</span>
                  <span class="status" [attr.data-state]="stateOf(row)">
                    <span class="status-dot" aria-hidden="true"></span>
                    {{ stateLabel(row).label }}
                  </span>
                </div>
                <div class="meta activity">
                  <span class="mobile-label">Recent activity</span>
                  <span>Updated {{ row.updatedAt | date: 'MMM d, y' }}</span>
                  <small>{{ row.updatedAt | date: 'h:mm a' }}</small>
                </div>
                <div class="meta attention" [attr.data-attention]="attentionTone(row)">
                  <span class="mobile-label">Attention</span>
                  <span>{{ attentionLabel(row) }}</span>
                </div>
                <div class="row-actions">
                  <a class="view-link" [routerLink]="['/workflows', row.id]">
                    View <span aria-hidden="true">→</span>
                  </a>
                  @if (stateOf(row) === 'observing') {
                    <button
                      type="button"
                      class="quiet-action"
                      [disabled]="busyId() === row.id"
                      (click)="ask('activate', row)"
                    >
                      Activate
                    </button>
                  } @else if (stateOf(row) === 'active') {
                    <button
                      type="button"
                      class="quiet-action"
                      [disabled]="busyId() === row.id"
                      (click)="ask('pause', row)"
                    >
                      Pause
                    </button>
                  } @else {
                    <button
                      type="button"
                      class="quiet-action"
                      [disabled]="busyId() === row.id"
                      (click)="ask('resume', row)"
                    >
                      Resume
                    </button>
                  }
                  <button
                    type="button"
                    class="delete-action"
                    [disabled]="busyId() === row.id"
                    [attr.aria-label]="'Delete ' + row.name"
                    (click)="ask('delete', row)"
                  >
                    Delete
                  </button>
                </div>
              </li>
            }
          </ul>
        </section>
      }
    </lj-page>

    @if (confirmation(); as dialog) {
      <sweet-confirmation-dialog
        [open]="true"
        [title]="dialog.title"
        [description]="dialog.description"
        [confirmLabel]="dialog.confirmLabel"
        [danger]="dialog.danger"
        (confirmed)="confirmAction()"
        (cancelled)="confirmation.set(null)"
      />
    }
  `,
  styles: `
    :host { display: block; }
    .page-header { display: block; padding: var(--space-6) 0 var(--space-3); }
    .header-inner {
      width: 100%; margin: 0; padding-inline: clamp(24px, 3vw, 40px);
      display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-6);
    }
    .heading-copy { max-width: 42rem; }
    .eyebrow { margin: 0 0 var(--space-2); }
    .intro { margin: var(--space-2) 0 0; color: var(--text-dim); font-size: var(--text-sm); }
    .header-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-3); flex-wrap: wrap; }
    .proposals-link {
      min-height: 40px; display: inline-flex; align-items: center; gap: var(--space-2);
      padding: 8px 12px; border-radius: var(--radius-md); color: var(--text);
      font-size: var(--text-sm); font-weight: 750; text-decoration: none;
    }
    .proposals-link:hover { background: var(--surface-hover); }
    .badge {
      min-width: 1.35rem; height: 1.35rem; display: inline-grid; place-items: center;
      padding: 0 .35rem; border-radius: var(--radius-pill); background: var(--warn-bg);
      color: var(--warn-text); font-size: .68rem; font-weight: 850;
    }
    .overview {
      display: flex; align-items: center; gap: 0; margin-top: var(--space-3); padding: var(--space-3) var(--space-4);
      border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
      color: var(--text-dim); font-size: var(--text-xs); box-shadow: var(--shadow-soft);
    }
    .overview p { margin: 0; padding: 0 var(--space-5); border-left: 1px solid var(--border); }
    .overview p:first-child { padding-left: 0; border-left: 0; }
    .overview strong { color: var(--text); font-size: var(--text-sm); }
    .overview .attention-count strong { color: var(--warn-text); }
    .list-tools { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-4) 0 var(--space-3); }
    .search-label { color: var(--text-dim); font-size: var(--text-sm); font-weight: 700; }
    .search-wrap { position: relative; width: min(100%, 22rem); }
    .search-wrap svg {
      position: absolute; left: .85rem; top: 50%; width: 1rem; transform: translateY(-50%);
      fill: none; stroke: var(--text-soft); stroke-width: 1.8; pointer-events: none;
    }
    .search {
      width: 100%; min-height: 38px; padding: .5rem .75rem .5rem 2.35rem;
      border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--surface); color: var(--text); outline: none;
      transition: border-color var(--motion-fast) ease, background var(--motion-fast) ease;
    }
    .search:focus { border-color: var(--brand); background: var(--surface); box-shadow: var(--focus-ring); }
    .search::placeholder { color: var(--text-soft); }
    .announcements:empty { display: none; }
    .notice, .error { margin: 0 0 var(--space-4); padding: .75rem 1rem; border-radius: var(--radius-md); font-size: var(--text-sm); }
    .notice { background: var(--info-bg); color: var(--info); }
    .error { background: var(--danger-bg); color: var(--danger); }
    .column-headings, .workflow-row {
      display: grid; grid-template-columns: minmax(15rem, 1.75fr) minmax(7rem, .58fr) minmax(8.5rem, .7fr) minmax(8.5rem, .72fr) auto;
      column-gap: var(--space-6); align-items: center;
    }
    .workflow-index { overflow: hidden; }
    .column-headings {
      padding: 9px var(--space-4); border-bottom: 1px solid var(--border); background: var(--surface-inset); color: var(--text-soft);
      font-size: .68rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
    }
    .workflow-list { list-style: none; margin: 0; padding: 0; }
    .workflow-row {
      min-height: 4.75rem; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border);
      transition: background var(--motion-fast) ease;
    }
    .workflow-row:last-child { border-bottom: 0; }
    .workflow-row:hover { background: var(--surface-inset); }
    .identity { min-width: 0; }
    .name {
      color: var(--text); font-size: var(--text-sm); font-weight: 780; letter-spacing: -.01em;
      text-decoration: none; text-underline-offset: .2em;
    }
    .name:hover { color: var(--brand-text); text-decoration: underline; }
    .purpose {
      display: -webkit-box; margin: .2rem 0 0; overflow: hidden; color: var(--text-dim);
      font-size: var(--text-xs); line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
    }
    .meta { color: var(--text-dim); font-size: var(--text-sm); }
    .mobile-label { display: none; }
    .status { display: inline-flex; align-items: center; gap: .55rem; color: var(--text); font-weight: 700; }
    .status-dot { width: .55rem; height: .55rem; border-radius: 50%; background: var(--text-soft); }
    .status[data-state='active'] .status-dot { background: var(--success); box-shadow: 0 0 0 4px var(--success-bg); }
    .status[data-state='observing'] .status-dot { background: var(--brand); box-shadow: 0 0 0 4px var(--info-bg); }
    .activity { display: flex; flex-direction: column; gap: .12rem; }
    .activity small { color: var(--text-soft); font-size: var(--text-xs); }
    .attention { font-weight: 650; }
    .attention[data-attention='review'] { color: var(--warn-text); }
    .attention[data-attention='clear'] { color: var(--success); }
    .row-actions { display: flex; align-items: center; justify-content: flex-end; gap: .2rem; }
    .view-link, .quiet-action, .delete-action {
      min-height: 34px; display: inline-flex; align-items: center; justify-content: center;
      padding: .4rem .55rem; border: 0; border-radius: var(--radius-md); background: transparent;
      color: var(--text-dim); font: inherit; font-size: var(--text-xs); font-weight: 750;
      text-decoration: none; white-space: nowrap; cursor: pointer;
    }
    .view-link { color: var(--brand-text); }
    .view-link:hover, .quiet-action:hover { background: var(--surface-hover); color: var(--text); }
    .delete-action { color: var(--text-soft); }
    .delete-action:hover { background: var(--danger-bg); color: var(--danger); }
    .quiet-action:disabled, .delete-action:disabled { opacity: .45; cursor: wait; }
    .loading { padding: var(--space-16) 0; border-top: 1px solid var(--border); }
    .loading-line { display: block; width: min(32rem, 82%); height: 1rem; border-radius: var(--radius-pill); background: var(--surface-inset); animation: breathe 1.5s ease-in-out infinite alternate; }
    .loading-line.short { width: min(21rem, 54%); margin-top: var(--space-3); animation-delay: 160ms; }
    .empty { min-height: 110px; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
    .empty h2 { margin: 0; font-size: var(--text-lg); letter-spacing: -.02em; }
    .empty > p:not(.eyebrow) { margin: var(--space-2) 0 var(--space-4); color: var(--text-dim); font-size: var(--text-sm); }
    @keyframes breathe { to { opacity: .45; } }
    @media (max-width: 1080px) {
      .column-headings, .workflow-row { grid-template-columns: minmax(14rem, 1.5fr) 7rem 8.6rem minmax(8rem, .7fr); }
      .column-headings span:last-child { display: none; }
      .row-actions { grid-column: 1 / -1; justify-content: flex-start; margin-top: var(--space-3); }
    }
    @media (max-width: 760px) {
      .page-header { padding-top: var(--space-5); }
      .header-inner { align-items: flex-start; flex-direction: column; gap: var(--space-5); }
      .header-actions { width: 100%; justify-content: flex-start; }
      .intro { font-size: var(--text-md); }
      .overview { overflow-x: auto; padding-bottom: var(--space-6); }
      .overview p { flex: 0 0 auto; }
      .list-tools { align-items: flex-start; flex-direction: column; padding-top: var(--space-6); }
      .search-wrap { width: 100%; }
      .column-headings { display: none; }
      .workflow-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); padding: var(--space-6) 0; }
      .identity { grid-column: 1 / -1; }
      .status-meta, .activity, .attention { display: flex; flex-direction: column; align-items: flex-start; gap: .3rem; }
      .mobile-label { display: block; color: var(--text-soft); font-size: .66rem; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
      .row-actions { grid-column: 1 / -1; margin-top: 0; padding-top: var(--space-2); border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent); }
    }
    @media (max-width: 430px) {
      .overview {
        display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
        padding: 0; overflow: visible;
      }
      .overview p { min-width: 0; padding: var(--space-3) var(--space-4); }
      .overview p:nth-child(odd) { border-left: 0; }
      .overview p:nth-child(n + 3) { border-top: 1px solid var(--border); }
      .workflow-row { grid-template-columns: 1fr; }
      .identity, .row-actions { grid-column: 1; }
      .row-actions { flex-wrap: wrap; }
    }
    @media (prefers-reduced-motion: reduce) { .loading-line { animation: none; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowsListPage {
  private readonly service = inject(WorkflowsService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly rows = signal<WorkflowRecord[]>([]);
  protected readonly query = signal('');
  protected readonly busyId = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmation = signal<ConfirmationState | null>(null);

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.rows();
    return this.rows().filter((row) => {
      const purpose = this.purpose(row).toLowerCase();
      return row.name.toLowerCase().includes(q) || purpose.includes(q);
    });
  });
  protected readonly pendingProposals = computed(
    () => this.rows().filter((row) => row.proposalStatus === 'pending').length
  );
  protected readonly activeCount = computed(
    () => this.rows().filter((row) => workflowState(row) === 'active').length
  );
  protected readonly observingCount = computed(
    () => this.rows().filter((row) => workflowState(row) === 'observing').length
  );
  protected readonly attentionCount = computed(
    () =>
      this.rows().filter(
        (row) => row.proposalStatus === 'pending' || workflowState(row) === 'paused'
      ).length
  );

  constructor() {
    this.reload();
  }

  private reload() {
    this.loading.set(true);
    this.service.list().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error: Error) => {
        this.error.set(error.message || 'Workflows could not be loaded.');
        this.loading.set(false);
      },
    });
  }

  protected create() {
    void this.router.navigate(['/workflows', 'new']);
  }

  protected purpose(row: WorkflowRecord) {
    return interpretRule(row.ruleJson).summary;
  }

  protected stateOf(row: WorkflowRecord) {
    return workflowState(row);
  }

  protected stateLabel(row: WorkflowRecord) {
    return STATE_LABELS[workflowState(row)];
  }

  protected attentionTone(row: WorkflowRecord) {
    if (row.proposalStatus === 'pending' || workflowState(row) === 'paused') return 'review';
    if (workflowState(row) === 'active') return 'clear';
    return 'quiet';
  }

  protected attentionLabel(row: WorkflowRecord) {
    if (row.proposalStatus === 'pending') return 'Review requested';
    if (workflowState(row) === 'paused') return 'Paused by your team';
    if (workflowState(row) === 'observing') return 'Observation in progress';
    return 'No attention needed';
  }

  protected ask(action: PendingAction, row: WorkflowRecord) {
    this.notice.set(null);
    this.error.set(null);
    const blocker = this.activationIssue(action, row);
    if (blocker) {
      this.reportActivationBlock(row.name, blocker);
      return;
    }
    const content: Record<PendingAction, Omit<ConfirmationState, 'action' | 'row'>> = {
      activate: {
        title: `Activate “${row.name}”?`,
        description:
          'This workflow will stop observing and begin taking real actions. Some organizations require a second reviewer before activation.',
        confirmLabel: 'Activate workflow',
        danger: false,
      },
      pause: {
        title: `Pause “${row.name}”?`,
        description:
          'The workflow will stop watching requests and taking actions until it is resumed.',
        confirmLabel: 'Pause workflow',
        danger: false,
      },
      resume: {
        title: `Resume “${row.name}”?`,
        description:
          workflowState(row) === 'paused' && row.ruleJson.controls.mode === 'armed'
            ? 'The workflow will return to active operation and begin taking real actions again.'
            : 'The workflow will return to observation and continue recording what it would do.',
        confirmLabel: 'Resume workflow',
        danger: false,
      },
      delete: {
        title: `Delete “${row.name}”?`,
        description: 'This removes the workflow and its pending reviews. This action cannot be undone.',
        confirmLabel: 'Delete workflow',
        danger: true,
      },
    };
    this.confirmation.set({ action, row, ...content[action] });
  }

  protected confirmAction() {
    const pending = this.confirmation();
    if (!pending) return;
    const blocker = this.activationIssue(pending.action, pending.row);
    if (blocker) {
      this.confirmation.set(null);
      this.reportActivationBlock(pending.row.name, blocker);
      return;
    }
    this.confirmation.set(null);
    this.busyId.set(pending.row.id);

    if (pending.action === 'delete') {
      this.service.remove(pending.row.id).subscribe({
        next: () => {
          this.rows.update((rows) => rows.filter((row) => row.id !== pending.row.id));
          this.busyId.set(null);
          this.notice.set(`“${pending.row.name}” was deleted.`);
        },
        error: (error: Error) => this.fail(error),
      });
      return;
    }

    if (pending.action === 'activate') {
      const ruleJson = {
        ...pending.row.ruleJson,
        controls: { ...pending.row.ruleJson.controls, mode: 'armed' as const },
      };
      this.service
        .update(pending.row.id, {
          name: pending.row.name,
          description: pending.row.description,
          ruleJson,
          expectedVersion: pending.row.version,
        })
        .subscribe({
          next: (outcome) => this.applyOutcome(outcome, pending.action, pending.row.name),
          error: (error: Error) => this.fail(error),
        });
      return;
    }

    this.service.toggle(pending.row.id, pending.action === 'resume').subscribe({
      next: (outcome) => this.applyOutcome(outcome, pending.action, pending.row.name),
      error: (error: Error) => this.fail(error),
    });
  }

  private applyOutcome(outcome: SaveOutcome, action: PendingAction, name: string) {
    this.rows.update((rows) =>
      rows.map((row) => (row.id === outcome.record.id ? outcome.record : row))
    );
    this.busyId.set(null);
    if (outcome.kind === 'proposed') {
      this.notice.set(`The change to “${name}” was sent for review.`);
      return;
    }
    const verb = action === 'activate' ? 'activated' : action === 'pause' ? 'paused' : 'resumed';
    this.notice.set(`“${name}” was ${verb}.`);
  }

  private activationIssue(action: PendingAction, row: WorkflowRecord): string | null {
    const startsLiveActions =
      action === 'activate' ||
      (action === 'resume' && row.ruleJson.controls.mode === 'armed');
    return startsLiveActions ? activationBlocker(row.ruleJson) : null;
  }

  private reportActivationBlock(name: string, reason: string) {
    this.error.set(
      `“${name}” cannot be activated yet. ${reason} Review the workflow before trying again.`
    );
  }

  private fail(error: Error) {
    this.busyId.set(null);
    this.error.set(error.message || 'That change could not be completed.');
  }
}
