import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LJ_PRIMITIVES } from '../../../shared/lj/lj';
import { WorkflowProposal, WorkflowRecord, WorkflowsService } from '../data/workflows.service';

/**
 * Four-eyes checker queue (Phase 13 §2.3): pending proposals with a
 * current-vs-proposed rule diff, approve/reject. The maker saved a change on a
 * protected workflow; a second pair of eyes decides here.
 */
@Component({
  selector: 'wf-proposals-page',
  imports: [...LJ_PRIMITIVES, DatePipe],
  template: `
    <lj-page>
      <header header>
        <lj-box class="header" [padding]="4">
          <lj-box-row [paddingBlockEnd]="4">
            <button lj-button (click)="back()">← Workflows</button>
            <h1 lj-page-heading>Proposals</h1>
            <span class="count" [class.zero]="pending().length === 0">{{ pending().length }} pending</span>
          </lj-box-row>
        </lj-box>
      </header>

      @if (loading()) {
        <p class="state">Loading proposals…</p>
      } @else if (rows().length === 0) {
        <p class="state">
          Nothing here. Edits to an enabled or armed workflow arrive as proposals for a second
          pair of eyes — save one in the builder to see the flow.
        </p>
      } @else {
        @for (proposal of rows(); track proposal.id) {
          <section class="card" [class.decided]="proposal.status !== 'pending'">
            <div class="head">
              <b>{{ proposal.workflowName }}</b>
              @if (proposal.proposedName) {
                <span class="rename">→ rename to “{{ proposal.proposedName }}”</span>
              }
              @if (proposal.proposedEnabled !== null) {
                <span class="chip">{{ proposal.proposedEnabled ? 'enable' : 'disable' }}</span>
              }
              <span class="chip status" [class.applied]="proposal.status === 'applied'" [class.rejected]="proposal.status === 'rejected'">
                {{ proposal.status }}
              </span>
              <span class="spacer"></span>
              <span class="when">{{ proposal.createdAt | date: 'MMM d, h:mm a' }}</span>
              <button type="button" class="expand" (click)="toggleOpen(proposal.id)">
                {{ openId() === proposal.id ? 'Hide diff' : 'View diff' }}
              </button>
              @if (proposal.status === 'pending') {
                <button lj-button class="danger" (click)="reject(proposal)">Reject</button>
                <button lj-button class="primary" (click)="approve(proposal)">Approve & apply</button>
              }
            </div>

            @if (openId() === proposal.id) {
              <div class="diff">
                <div class="pane">
                  <div class="pane-title">Current rule</div>
                  <pre>{{ currentJson() }}</pre>
                </div>
                <div class="pane">
                  <div class="pane-title">Proposed rule</div>
                  <pre>{{ stringify(proposal.proposedRule) }}</pre>
                </div>
              </div>
            }
          </section>
        }
      }
      @if (error(); as message) {
        <div class="error-bar">{{ message }}</div>
      }
    </lj-page>
  `,
  styles: `
    .count {
      font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 12px;
      background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn-text);
    }
    .count.zero { background: var(--surface-inset); color: var(--text-dim); }
    .state { color: var(--text-dim); font-size: 14px; padding: 32px 4px; max-width: 560px; }
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 14px; padding: 14px 18px; margin-top: 14px;
    }
    .card.decided { opacity: 0.6; }
    .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 14px; }
    .rename { font-size: 12px; color: var(--text-dim); }
    .spacer { flex: 1; }
    .when { font-size: 12px; color: var(--text-dim); }
    .chip {
      font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 10px;
      background: var(--surface-inset); color: var(--text-dim);
    }
    .chip.status { text-transform: uppercase; letter-spacing: 0.04em; }
    .chip.applied { background: color-mix(in srgb, var(--brand) 15%, transparent); color: var(--brand-text); }
    .chip.rejected { background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); }
    .expand {
      font: inherit; font-size: 12px; font-weight: 600; color: var(--brand-text);
      background: none; border: 0; cursor: pointer;
    }
    .diff { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
    .pane { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    .pane-title {
      font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--text-dim); padding: 8px 12px; background: var(--surface-inset);
    }
    pre {
      margin: 0; padding: 12px; font-size: 11px; line-height: 1.5; overflow: auto;
      max-height: 380px; font-family: ui-monospace, Menlo, monospace;
    }
    .error-bar {
      font-size: 13px; color: var(--danger); margin-top: 16px;
      background: color-mix(in srgb, var(--danger) 9%, transparent);
      border-radius: 10px; padding: 10px 14px;
    }
    @media (max-width: 900px) { .diff { grid-template-columns: 1fr; } }
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
  private readonly currentRecord = signal<WorkflowRecord | null>(null);

  protected readonly pending = computed(() => this.rows().filter((p) => p.status === 'pending'));
  protected readonly currentJson = computed(() => {
    const record = this.currentRecord();
    return record ? JSON.stringify(record.ruleJson, null, 2) : '…';
  });

  constructor() {
    this.reload();
  }

  private reload() {
    this.loading.set(true);
    this.service.listProposals().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error: Error) => {
        this.error.set(error.message);
        this.loading.set(false);
      },
    });
  }

  protected stringify(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  protected toggleOpen(id: string) {
    if (this.openId() === id) {
      this.openId.set(null);
      return;
    }
    this.openId.set(id);
    this.currentRecord.set(null);
    const proposal = this.rows().find((p) => p.id === id);
    if (!proposal) return;
    this.service.get(proposal.workflowId).subscribe({
      next: (record) => this.currentRecord.set(record),
      error: () => this.currentRecord.set(null),
    });
  }

  protected approve(proposal: WorkflowProposal) {
    this.service.approveProposal(proposal.id).subscribe({
      next: () => this.reload(),
      error: (error: Error) => this.error.set(error.message),
    });
  }

  protected reject(proposal: WorkflowProposal) {
    this.service.rejectProposal(proposal.id).subscribe({
      next: () => this.reload(),
      error: (error: Error) => this.error.set(error.message),
    });
  }

  protected back() {
    void this.router.navigate(['/workflows']);
  }
}
