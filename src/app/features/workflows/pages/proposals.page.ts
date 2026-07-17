import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ConfirmationDialog } from '../../../shared/confirmation-dialog';
import { LJ_PRIMITIVES } from '../../../shared/lj/lj';
import { WorkflowProposal, WorkflowRecord, WorkflowsService } from '../data/workflows.service';

interface ReviewDecision {
  proposal: WorkflowProposal;
  action: 'approve' | 'reject';
}

/**
 * Four-eyes checker queue (Phase 13 §2.3): pending proposals with a
 * current-vs-proposed rule diff, approve/reject. The maker saved a change on a
 * protected workflow; a second pair of eyes decides here.
 */
@Component({
  selector: 'wf-proposals-page',
  imports: [...LJ_PRIMITIVES, DatePipe, ConfirmationDialog],
  template: `
    <lj-page>
      <header header class="page-header">
        <button type="button" class="back" (click)="back()">← Workflows</button>
        <div class="masthead">
          <div>
            <p class="eyebrow">Review queue</p>
            <h1 lj-page-heading>Changes awaiting review</h1>
            <p class="lede">
              A second reviewer confirms important changes before they become active.
            </p>
          </div>
          <div class="count" [class.zero]="pending().length === 0" aria-live="polite">
            <strong>{{ pending().length }}</strong>
            <span>{{ pending().length === 1 ? 'change needs' : 'changes need' }} review</span>
          </div>
        </div>
      </header>

      @if (loading()) {
        <p class="state" aria-live="polite">Loading review queue…</p>
      } @else if (rows().length === 0) {
        <section class="empty" aria-labelledby="empty-title">
          <span class="empty-mark" aria-hidden="true">✓</span>
          <div>
            <h2 id="empty-title">Everything is reviewed</h2>
            <p>New changes that need a second set of eyes will appear here.</p>
          </div>
        </section>
      } @else {
        <div class="review-list">
          @for (proposal of reviewRows(); track proposal.id) {
            <article class="proposal" [class.decided]="proposal.status !== 'pending'">
              <div class="proposal-main">
                <div class="proposal-copy">
                  <div class="meta">
                    <span
                      class="status"
                      [class.applied]="proposal.status === 'applied'"
                      [class.rejected]="proposal.status === 'rejected'"
                    >
                      {{ statusLabel(proposal.status) }}
                    </span>
                    <span>{{ proposal.createdAt | date: 'MMM d, h:mm a' }}</span>
                  </div>
                  <h2>{{ proposal.workflowName }}</h2>
                  <ul class="change-list" aria-label="Proposed changes">
                    @if (proposal.proposedName) {
                      <li>Rename to “{{ proposal.proposedName }}”</li>
                    }
                    @if (proposal.proposedEnabled !== null) {
                      <li>{{ enabledChangeLabel(proposal) }}</li>
                    }
                    @if (modeChangeLabel(proposal); as modeChange) {
                      <li class="live-change">{{ modeChange }}</li>
                    }
                    <li>Update how this workflow behaves</li>
                  </ul>
                </div>

                @if (proposal.status === 'pending') {
                  <div class="decision-actions" aria-label="Review decision">
                    <button
                      lj-button
                      class="danger"
                      [disabled]="processingId() === proposal.id"
                      (click)="requestDecision(proposal, 'reject')"
                    >
                      Decline
                    </button>
                    <button
                      lj-button
                      class="primary"
                      [disabled]="processingId() === proposal.id"
                      (click)="requestDecision(proposal, 'approve')"
                    >
                      {{ processingId() === proposal.id ? 'Applying…' : 'Approve change' }}
                    </button>
                  </div>
                }
              </div>

              <button
                type="button"
                class="expand"
                [attr.aria-expanded]="openId() === proposal.id"
                [attr.aria-controls]="'proposal-diff-' + proposal.id"
                (click)="toggleOpen(proposal.id)"
              >
                <span>Internal details</span>
                <span aria-hidden="true">{{ openId() === proposal.id ? '−' : '+' }}</span>
              </button>

              @if (openId() === proposal.id) {
                <div class="technical" [id]="'proposal-diff-' + proposal.id">
                  <div class="technical-heading">
                    <p class="eyebrow">Advanced · rule data</p>
                    <p>Compare the current definition with the proposed definition.</p>
                  </div>
                  <div class="diff">
                    <div class="pane">
                      <div class="pane-title">Current definition</div>
                      <pre tabindex="0">{{ currentJson() }}</pre>
                    </div>
                    <div class="pane">
                      <div class="pane-title">Proposed definition</div>
                      <pre tabindex="0">{{ stringify(proposal.proposedRule) }}</pre>
                    </div>
                  </div>
                </div>
              }
            </article>
          }
        </div>
      }
      @if (error(); as message) {
        <div class="error-bar" role="alert">{{ message }}</div>
      }

      <sweet-confirmation-dialog
        [open]="!!decision()"
        [title]="decisionTitle()"
        [description]="decisionDescription()"
        [confirmLabel]="decision()?.action === 'reject' ? 'Decline change' : 'Approve change'"
        [danger]="decision()?.action === 'reject'"
        (confirmed)="confirmDecision()"
        (cancelled)="cancelDecision()"
      />
    </lj-page>
  `,
  styles: `
    .page-header {
      width: min(100%, 1240px); margin: 0 auto;
      padding: var(--space-8) clamp(1rem, 3vw, 3rem) var(--space-12);
      border-bottom: 1px solid var(--border);
    }
    .back {
      min-height: 42px; margin: 0 0 var(--space-10); padding: 0;
      border: 0; background: transparent; color: var(--text-dim);
      font-weight: 750; cursor: pointer;
    }
    .back:hover { color: var(--text); }
    .masthead { display: flex; align-items: end; justify-content: space-between; gap: var(--space-10); }
    .eyebrow { margin: 0 0 var(--space-3); }
    .lede { max-width: 40rem; margin: var(--space-5) 0 0; color: var(--text-dim); font-size: var(--text-lg); }
    .count {
      display: grid; flex: 0 0 auto; justify-items: end; color: var(--text-dim);
    }
    .count strong { color: var(--text); font-size: clamp(2.5rem, 5vw, 4.5rem); line-height: .9; letter-spacing: -.06em; }
    .count span { margin-top: var(--space-2); font-size: var(--text-xs); font-weight: 750; }
    .count.zero strong { color: var(--text-soft); }
    .state { color: var(--text-dim); padding: var(--space-16) 0; }
    .empty {
      display: flex; align-items: flex-start; gap: var(--space-5);
      padding: var(--space-16) 0; border-bottom: 1px solid var(--border);
    }
    .empty-mark {
      display: grid; place-items: center; width: 2.5rem; height: 2.5rem;
      border-radius: 50%; color: var(--success); background: var(--success-bg); font-weight: 800;
    }
    .empty h2 { margin: 0; font-size: var(--text-lg); }
    .empty p { margin: var(--space-2) 0 0; color: var(--text-dim); }
    .review-list { border-top: 1px solid var(--border); }
    .proposal { padding: var(--space-10) 0 var(--space-6); border-bottom: 1px solid var(--border); }
    .proposal.decided h2 { color: var(--text-dim); }
    .proposal-main { display: flex; justify-content: space-between; align-items: center; gap: var(--space-10); }
    .proposal-copy { min-width: 0; }
    .meta { display: flex; align-items: center; gap: var(--space-3); color: var(--text-soft); font-size: var(--text-xs); }
    .status { color: var(--warn-text); font-weight: 800; }
    .status.applied { color: var(--success); }
    .status.rejected { color: var(--text-dim); }
    h2 { margin: var(--space-3) 0 0; font-size: clamp(1.35rem, 2.5vw, 2rem); line-height: 1.15; letter-spacing: -.025em; }
    .change-copy { margin: var(--space-3) 0 0; color: var(--text-dim); }
    .change-list { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); margin: var(--space-3) 0 0; padding: 0; list-style: none; color: var(--text-dim); }
    .change-list li::before { content: '·'; margin-right: var(--space-2); color: var(--brand); font-weight: 900; }
    .change-list .live-change { color: var(--danger); font-weight: 800; }
    .change-list .live-change::before { content: '→'; color: var(--danger); }
    .decision-actions { display: flex; align-items: center; gap: var(--space-3); flex: 0 0 auto; }
    .expand {
      width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: space-between;
      margin-top: var(--space-5); padding: var(--space-3) 0 0;
      border: 0; border-top: 1px solid transparent; background: transparent;
      color: var(--text-dim); font-size: var(--text-xs); font-weight: 750; cursor: pointer;
    }
    .expand:hover { color: var(--text); }
    .technical { margin-top: var(--space-4); padding: var(--space-6); background: var(--surface-inset); border-radius: var(--radius-lg); }
    .technical-heading { display: flex; align-items: end; justify-content: space-between; gap: var(--space-6); }
    .technical-heading .eyebrow { margin: 0; }
    .technical-heading > p:last-child { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }
    .diff { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-4); margin-top: var(--space-5); }
    .pane { min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; background: var(--surface); }
    .pane-title {
      padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border);
      color: var(--text-dim); font-size: .68rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
    }
    pre {
      max-height: 26rem; margin: 0; padding: var(--space-4); overflow: auto;
      color: var(--sweet-graphite); font: .72rem/1.65 var(--font-mono);
    }
    .error-bar {
      margin-top: var(--space-6); padding: var(--space-4);
      border-left: 3px solid var(--danger); color: var(--danger); background: var(--danger-bg);
      font-size: var(--text-sm);
    }
    @media (max-width: 900px) {
      .masthead, .proposal-main { align-items: flex-start; }
      .proposal-main { flex-direction: column; }
      .decision-actions { align-self: stretch; justify-content: flex-end; }
      .diff { grid-template-columns: 1fr; }
    }
    @media (max-width: 600px) {
      .page-header { padding-top: var(--space-6); padding-bottom: var(--space-8); }
      .back { margin-bottom: var(--space-8); }
      .masthead { align-items: flex-start; flex-direction: column; }
      .count { justify-items: start; }
      .count strong { font-size: 2.5rem; }
      .proposal { padding-block: var(--space-8) var(--space-5); }
      .decision-actions { display: grid; grid-template-columns: 1fr; width: 100%; }
      .decision-actions button { width: 100%; }
      .technical { margin-inline: calc(-1 * var(--space-2)); padding: var(--space-4); }
      .technical-heading { align-items: flex-start; flex-direction: column; gap: var(--space-2); }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalsPage {
  private readonly service = inject(WorkflowsService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly rows = signal<WorkflowProposal[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly openId = signal<string | null>(null);
  protected readonly processingId = signal<string | null>(null);
  protected readonly decision = signal<ReviewDecision | null>(null);
  private readonly currentRecords = signal<Record<string, WorkflowRecord>>({});
  private readonly currentRecordErrors = signal<Record<string, boolean>>({});
  private currentLoadGeneration = 0;

  protected readonly pending = computed(() => this.rows().filter((p) => p.status === 'pending'));
  protected readonly reviewRows = computed(() =>
    [...this.rows()].sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
  );
  protected readonly currentJson = computed(() => {
    const openId = this.openId();
    const proposal = this.rows().find((row) => row.id === openId);
    if (!proposal) return 'Loading current definition…';
    const record = this.currentRecords()[proposal.workflowId];
    if (record) return JSON.stringify(record.ruleJson, null, 2);
    return this.currentRecordErrors()[proposal.workflowId]
      ? 'Current definition unavailable.'
      : 'Loading current definition…';
  });

  constructor() {
    this.reload();
  }

  private reload() {
    const generation = ++this.currentLoadGeneration;
    this.loading.set(true);
    this.error.set(null);
    this.currentRecords.set({});
    this.currentRecordErrors.set({});
    this.service.listProposals().subscribe({
      next: (rows) => {
        if (generation !== this.currentLoadGeneration) return;
        this.rows.set(rows);
        this.loading.set(false);
        this.loadCurrentRecords(rows, generation);
      },
      error: (error: Error) => {
        if (generation !== this.currentLoadGeneration) return;
        this.error.set(error.message);
        this.loading.set(false);
      },
    });
  }

  private loadCurrentRecords(rows: WorkflowProposal[], generation: number) {
    const workflowIds = [...new Set(rows.map((proposal) => proposal.workflowId))];
    for (const workflowId of workflowIds) {
      this.service.get(workflowId).subscribe({
        next: (record) => {
          if (generation !== this.currentLoadGeneration) return;
          this.currentRecords.update((records) => ({ ...records, [workflowId]: record }));
        },
        error: () => {
          if (generation !== this.currentLoadGeneration) return;
          this.currentRecordErrors.update((errors) => ({ ...errors, [workflowId]: true }));
          const openProposal = rows.find((proposal) => proposal.id === this.openId());
          if (openProposal?.workflowId === workflowId) {
            this.error.set('The current workflow definition could not be loaded.');
          }
        },
      });
    }
  }

  protected stringify(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  protected statusLabel(status: WorkflowProposal['status']): string {
    if (status === 'applied') return 'Applied';
    if (status === 'rejected') return 'Declined';
    return 'Needs review';
  }

  protected enabledChangeLabel(proposal: WorkflowProposal): string {
    if (proposal.proposedEnabled === false) return 'Pause workflow';
    return proposal.proposedRule.controls.mode === 'armed'
      ? 'Resume live actions'
      : 'Resume in Observing';
  }

  protected modeChangeLabel(proposal: WorkflowProposal): string | null {
    const proposedMode = proposal.proposedRule.controls.mode;
    const currentMode = this.currentRecords()[proposal.workflowId]?.ruleJson.controls.mode;
    if (proposedMode === 'armed' && currentMode === 'shadow') {
      return 'Activate live actions — changes from Observing to Active';
    }
    if (proposedMode === 'armed' && currentMode === undefined) {
      return 'Active mode proposed — live actions will run after approval';
    }
    if (proposedMode === 'shadow' && currentMode === 'armed') {
      return 'Stop live actions — changes from Active to Observing';
    }
    return null;
  }

  protected toggleOpen(id: string) {
    if (this.openId() === id) {
      this.openId.set(null);
      return;
    }
    this.openId.set(id);
    const proposal = this.rows().find((p) => p.id === id);
    if (!proposal) return;
    if (this.currentRecordErrors()[proposal.workflowId]) {
      this.error.set('The current workflow definition could not be loaded.');
    }
  }

  protected requestDecision(proposal: WorkflowProposal, action: ReviewDecision['action']) {
    this.decision.set({ proposal, action });
  }

  protected decisionTitle(): string {
    const decision = this.decision();
    if (!decision) return '';
    return decision.action === 'approve' ? 'Approve this change?' : 'Decline this change?';
  }

  protected decisionDescription(): string {
    const decision = this.decision();
    if (!decision) return '';
    if (decision.action === 'reject') {
      return `The proposed changes to “${decision.proposal.workflowName}” will not be applied.`;
    }
    const liveChange = this.modeChangeLabel(decision.proposal);
    return liveChange
      ? `The proposed changes to “${decision.proposal.workflowName}” will be applied. ${liveChange}.`
      : `The proposed changes to “${decision.proposal.workflowName}” will be applied.`;
  }

  protected confirmDecision() {
    const decision = this.decision();
    if (!decision) return;
    this.decision.set(null);
    if (decision.action === 'approve') this.approve(decision.proposal);
    else this.reject(decision.proposal);
  }

  protected cancelDecision() {
    this.decision.set(null);
  }

  private approve(proposal: WorkflowProposal) {
    this.processingId.set(proposal.id);
    this.service.approveProposal(proposal.id).subscribe({
      next: () => {
        this.processingId.set(null);
        this.reload();
      },
      error: (error: Error) => {
        this.processingId.set(null);
        this.error.set(error.message);
      },
    });
  }

  private reject(proposal: WorkflowProposal) {
    this.processingId.set(proposal.id);
    this.service.rejectProposal(proposal.id).subscribe({
      next: () => {
        this.processingId.set(null);
        this.reload();
      },
      error: (error: Error) => {
        this.processingId.set(null);
        this.error.set(error.message);
      },
    });
  }

  protected back() {
    void this.router.navigate(['/workflows']);
  }
}
