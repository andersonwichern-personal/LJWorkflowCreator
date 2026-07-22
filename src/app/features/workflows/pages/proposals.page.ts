import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ConfirmationDialog } from '../../../shared/confirmation-dialog';
import { LJ_PRIMITIVES } from '../../../shared/lj/lj';
import { UserSessionService } from '../../../core/user-session.service';
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

      <section class="queue-surface data-surface" aria-label="Workflow review queue">
        @if (loading()) {
          <p class="state" aria-live="polite">Loading review queue…</p>
        } @else if (rows().length === 0) {
          <div class="empty" aria-labelledby="empty-title">
            <span class="empty-mark" aria-hidden="true">
              <svg viewBox="0 0 16 16"><path d="m3 8 3 3 7-7" /></svg>
            </span>
            <div>
              <h2 id="empty-title">Everything is reviewed</h2>
              <p>New changes that need a second set of eyes will appear here.</p>
            </div>
          </div>
        } @else {
          <div class="queue-columns" aria-hidden="true">
            <span>Workflow</span><span>Proposed changes</span><span>Submitted</span><span>Status</span><span>Actions</span>
          </div>
          <div class="review-list">
            @for (proposal of reviewRows(); track proposal.id) {
              <article class="proposal" [class.decided]="proposal.status !== 'pending'">
                <div class="proposal-main">
                  <div class="proposal-identity"><h2>{{ proposal.workflowName }}</h2></div>
                  <ul class="change-list" aria-label="Proposed changes">
                    @if (proposal.proposedName) { <li>Rename to “{{ proposal.proposedName }}”</li> }
                    @if (proposal.proposedEnabled !== null) { <li>{{ enabledChangeLabel(proposal) }}</li> }
                    @if (modeChangeLabel(proposal); as modeChange) { <li class="live-change">{{ modeChange }}</li> }
                    <li>Update how this workflow behaves</li>
                  </ul>
                  <div class="submitted"><span class="mobile-label">Submitted</span>{{ proposal.createdAt | date: 'MMM d, h:mm a' }}</div>
                  <span
                    class="status status-chip"
                    [class.applied]="proposal.status === 'applied'"
                    [class.rejected]="proposal.status === 'rejected'"
                  >{{ statusLabel(proposal.status) }}</span>
                  <div class="decision-actions" aria-label="Review decision">
                    @if (proposal.status === 'pending') {
                      @if (session.canApproveProposals()) {
                        <button type="button" lj-button class="danger" [disabled]="processingId() === proposal.id" (click)="requestDecision(proposal, 'reject')">Decline</button>
                        <button type="button" lj-button class="primary" [disabled]="processingId() === proposal.id" (click)="requestDecision(proposal, 'approve')">
                          {{ processingId() === proposal.id ? 'Applying…' : 'Approve change' }}
                        </button>
                      } @else {
                        <span class="role-gated-badge" title="Junior Analysts cannot approve proposals">Awaiting Admin / Manager Review</span>
                      }
                    }
                  </div>
                </div>

                <button
                  type="button"
                  class="expand"
                  [attr.aria-label]="'Internal details for ' + proposal.workflowName"
                  [attr.aria-expanded]="openId() === proposal.id"
                  [attr.aria-controls]="'proposal-diff-' + proposal.id"
                  (click)="toggleOpen(proposal.id)"
                >
                  <span>Internal details</span>
                  <span aria-hidden="true">{{ openId() === proposal.id ? '−' : '+' }}</span>
                </button>

                @if (openId() === proposal.id) {
                  <div class="technical" role="region" [attr.aria-label]="'Rule comparison for ' + proposal.workflowName" [id]="'proposal-diff-' + proposal.id">
                    <div class="technical-heading">
                      <p class="eyebrow">Advanced · rule data</p>
                      <p>Compare the current definition with the proposed definition.</p>
                    </div>
                    <div class="diff">
                      <div class="pane"><div class="pane-title">Current definition</div><pre tabindex="0">{{ currentJson() }}</pre></div>
                      <div class="pane"><div class="pane-title">Proposed definition</div><pre tabindex="0">{{ stringify(proposal.proposedRule) }}</pre></div>
                    </div>
                  </div>
                }
              </article>
            }
          </div>
        }
      </section>
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
      width: 100%; margin: 0;
      padding: var(--space-4) clamp(24px, 3vw, 40px) var(--space-3);
    }
    .back {
      min-height: 34px; margin: 0 0 var(--space-3); padding: 0;
      border: 0; background: transparent; color: var(--text-dim);
      font-weight: 750; cursor: pointer;
    }
    .back:hover { color: var(--text); }
    .masthead { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-6); }
    .eyebrow { margin: 0 0 var(--space-2); }
    .lede { max-width: 40rem; margin: var(--space-2) 0 0; color: var(--text-dim); font-size: var(--text-sm); }
    .count {
      min-height: 30px; display: flex; flex: 0 0 auto; align-items: baseline; gap: var(--space-2);
      padding: 5px 9px; border: 1px solid var(--border); border-radius: var(--radius-pill);
      background: var(--surface); color: var(--text-dim);
    }
    .count strong { color: var(--text); font-size: var(--text-sm); line-height: 1; }
    .count span { font-size: var(--text-xs); font-weight: 750; }
    .count.zero strong { color: var(--text-soft); }
    .queue-surface { overflow: hidden; }
    .state { margin: 0; color: var(--text-dim); padding: var(--space-8) var(--space-4); }
    .empty {
      min-height: 110px; display: flex; align-items: center; gap: var(--space-4);
      padding: var(--space-4);
    }
    .empty-mark {
      display: grid; place-items: center; width: 2rem; height: 2rem; flex: none;
      border: 1px solid #b9ddce; border-radius: 50%; color: var(--success); background: var(--success-bg);
    }
    .empty-mark svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .empty h2 { margin: 0; font-size: var(--text-md); }
    .empty p { margin: var(--space-1) 0 0; color: var(--text-dim); font-size: var(--text-sm); }
    .queue-columns, .proposal-main {
      display: grid; grid-template-columns: minmax(150px, 1fr) minmax(230px, 1.55fr) 120px 100px minmax(170px, auto);
      align-items: center; gap: var(--space-4);
    }
    .queue-columns { padding: 8px var(--space-4); border-bottom: 1px solid var(--border); background: var(--surface-inset); color: var(--text-soft); font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .proposal { border-bottom: 1px solid var(--border); }
    .proposal:last-child { border-bottom: 0; }
    .proposal.decided h2 { color: var(--text-dim); }
    .proposal-main { min-height: 68px; padding: var(--space-3) var(--space-4); }
    .proposal-identity { min-width: 0; }
    h2 { margin: 0; overflow-wrap: anywhere; font-size: var(--text-sm); line-height: 1.35; letter-spacing: -.01em; }
    .change-list { margin: 0; padding: 0; list-style: none; color: var(--text-dim); font-size: var(--text-xs); }
    .change-list li + li { margin-top: 2px; }
    .change-list li::before { content: '·'; margin-right: var(--space-2); color: var(--brand); font-weight: 900; }
    .change-list .live-change { color: var(--danger); font-weight: 800; }
    .change-list .live-change::before { content: '→'; color: var(--danger); }
    .submitted { color: var(--text-dim); font-size: var(--text-xs); }
    .mobile-label { display: none; }
    .status { color: var(--warn-text); }
    .status.applied { border-color: #b9ddce; background: var(--success-bg); color: var(--success); }
    .status.rejected { color: var(--text-dim); }
    .decision-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
    .role-gated-badge { font-size: var(--text-xs); font-weight: 700; color: var(--warn-text); background: var(--warn-bg); padding: 4px 8px; border-radius: var(--radius-pill); min-width: 0; }
    .expand {
      width: 100%; min-height: 36px; display: flex; align-items: center; justify-content: space-between;
      margin: 0; padding: 7px var(--space-4);
      border: 0; border-top: 1px solid var(--border); background: var(--surface-inset);
      color: var(--text-dim); font-size: var(--text-xs); font-weight: 750; cursor: pointer;
    }
    .expand:hover { color: var(--text); }
    .technical { min-width: 0; max-width: 100%; padding: var(--space-4); border-top: 1px solid var(--border); background: var(--surface-inset); }
    .technical-heading { display: flex; align-items: end; justify-content: space-between; gap: var(--space-6); }
    .technical-heading .eyebrow { margin: 0; }
    .technical-heading > p:last-child { margin: 0; color: var(--text-dim); font-size: var(--text-xs); }
    .diff { min-width: 0; max-width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-3); margin-top: var(--space-3); }
    .pane { min-width: 0; max-width: 100%; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; background: var(--surface); }
    .pane-title {
      padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border);
      color: var(--text-dim); font-size: .68rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
    }
    pre {
      max-height: 22rem; margin: 0; padding: var(--space-3); overflow: auto;
      color: var(--sweet-graphite); font: .72rem/1.65 var(--font-mono);
    }
    .error-bar {
      margin-top: var(--space-6); padding: var(--space-4);
      border-left: 3px solid var(--danger); color: var(--danger); background: var(--danger-bg);
      font-size: var(--text-sm);
    }
    @media (max-width: 940px) {
      .queue-columns { display: none; }
      .proposal-main { grid-template-columns: minmax(0, 1fr) auto; align-items: start; }
      .proposal-identity { grid-column: 1; }
      .status { grid-column: 2; grid-row: 1; }
      .change-list { grid-column: 1 / -1; }
      .submitted { grid-column: 1; }
      .decision-actions { grid-column: 2; }
      .diff { grid-template-columns: 1fr; }
    }
    @media (max-width: 600px) {
      .page-header { padding-top: var(--space-3); }
      .masthead { align-items: flex-start; flex-direction: column; gap: var(--space-3); }
      .proposal-main { grid-template-columns: 1fr; }
      .proposal-identity, .status, .change-list, .submitted, .decision-actions { grid-column: 1; grid-row: auto; }
      .mobile-label { display: block; margin-bottom: 2px; color: var(--text-soft); font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
      .decision-actions { display: grid; grid-template-columns: 1fr; width: 100%; }
      .decision-actions button { width: 100%; }
      .technical-heading { align-items: flex-start; flex-direction: column; gap: var(--space-2); }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalsPage {
  private readonly service = inject(WorkflowsService);
  private readonly router = inject(Router);
  protected readonly session = inject(UserSessionService);

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
