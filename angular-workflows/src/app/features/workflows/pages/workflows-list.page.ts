import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LJ_PRIMITIVES } from '../../../shared/lj/lj';
import { VocabularyChip } from '../ui/vocabulary-chip';
import { WorkflowRecord, WorkflowsService } from '../data/workflows.service';

/**
 * The /workflows list — Templates-list idiom per the admin scan: name/mode/
 * updated columns, search, row actions, teal "Create New" primary.
 */
@Component({
  selector: 'wf-workflows-list-page',
  imports: [...LJ_PRIMITIVES, RouterLink, DatePipe, VocabularyChip],
  template: `
    <lj-page>
      <header header>
        <lj-box class="header" [padding]="4">
          <lj-box-row [paddingBlockEnd]="4">
            <h1 lj-page-heading>Workflows</h1>
            <wf-vocabulary-chip />
            <span class="spacer"></span>
            <input
              class="search"
              type="search"
              placeholder="Search workflows…"
              [value]="query()"
              (input)="query.set($any($event.target).value)"
            />
            <button lj-button (click)="goProposals()">
              Proposals
              @if (pendingProposals() > 0) {
                <span class="badge">{{ pendingProposals() }}</span>
              }
            </button>
            <button lj-button class="primary" (click)="create()">Create New</button>
          </lj-box-row>
        </lj-box>
      </header>

      @if (loading()) {
        <p class="state">Loading workflows…</p>
      } @else if (filtered().length === 0) {
        <p class="state">No workflows yet — create the first one.</p>
      } @else {
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Mode</th>
              <th>Enabled</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (row of filtered(); track row.id) {
              <tr>
                <td>
                  <a class="name" [routerLink]="[row.id, 'edit']">{{ row.name }}</a>
                  @if (row.description) {
                    <div class="desc">{{ row.description }}</div>
                  }
                </td>
                <td>
                  <span class="mode" [class.armed]="row.ruleJson.controls.mode === 'armed'">
                    {{ row.ruleJson.controls.mode }}
                  </span>
                  @if (row.proposalStatus === 'pending') {
                    <span class="mode proposal" title="A change is awaiting review">proposal pending</span>
                  }
                </td>
                <td>
                  <button
                    type="button"
                    class="toggle"
                    [class.on]="row.enabled"
                    (click)="toggle(row)"
                    [attr.aria-label]="row.enabled ? 'Disable' : 'Enable'"
                  >
                    <span class="knob"></span>
                  </button>
                </td>
                <td class="dim">{{ row.updatedAt | date: 'MMM d, h:mm a' }}</td>
                <td class="actions">
                  <a [routerLink]="[row.id, 'edit']">Edit</a>
                  <button type="button" class="danger" (click)="remove(row)">Delete</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </lj-page>
  `,
  styles: `
    .spacer { flex: 1; }
    .search {
      font: inherit; font-size: 13px; padding: 8px 12px; width: 240px;
      border: 1px solid var(--border); border-radius: 8px;
      background: var(--surface-inset); color: var(--text); outline: none;
    }
    .search:focus { border-color: var(--brand); }
    .state { color: var(--text-dim); font-size: 14px; padding: 32px 4px; }
    .table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; }
    th {
      text-align: left; font-size: 11px; font-weight: 700; letter-spacing: 0.05em;
      text-transform: uppercase; color: var(--text-dim);
      padding: 8px 12px; border-bottom: 1px solid var(--border);
    }
    td { padding: 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    .name { font-weight: 600; color: var(--text); text-decoration: none; }
    .name:hover { color: var(--brand-text); }
    .desc { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
    .dim { color: var(--text-dim); }
    .mode {
      font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 10px;
      background: var(--surface-inset); color: var(--text-dim);
    }
    .mode.armed { background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); }
    .mode.proposal { margin-left: 6px; background: var(--warn-bg); color: var(--warn-text); }
    .badge {
      font-size: 10px; font-weight: 800; border-radius: 999px; padding: 1px 7px;
      background: var(--warn-bg); color: var(--warn-text);
    }
    .toggle {
      width: 36px; height: 20px; border-radius: 999px; border: 1px solid var(--border);
      background: var(--surface-inset); cursor: pointer; position: relative; padding: 0;
    }
    .toggle .knob {
      position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
      border-radius: 50%; background: var(--text-dim); transition: transform 120ms ease;
    }
    .toggle.on { background: var(--brand); border-color: var(--brand); }
    .toggle.on .knob { background: #fff; transform: translateX(16px); }
    .actions { text-align: right; white-space: nowrap; }
    .actions a { color: var(--brand-text); font-weight: 600; text-decoration: none; margin-right: 12px; }
    .actions .danger {
      font: inherit; font-size: 13px; font-weight: 600; color: var(--danger);
      background: none; border: 0; cursor: pointer; padding: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowsListPage {
  private readonly service = inject(WorkflowsService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly rows = signal<WorkflowRecord[]>([]);
  protected readonly query = signal('');

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const rows = this.rows();
    if (!q) return rows;
    return rows.filter(
      (row) => row.name.toLowerCase().includes(q) || (row.description ?? '').toLowerCase().includes(q)
    );
  });

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
      error: () => this.loading.set(false),
    });
  }

  protected readonly pendingProposals = computed(
    () => this.rows().filter((row) => row.proposalStatus === 'pending').length
  );

  protected create() {
    void this.router.navigate(['/workflows', 'new', 'edit']);
  }

  protected goProposals() {
    void this.router.navigate(['/workflows', 'proposals']);
  }

  protected toggle(row: WorkflowRecord) {
    this.service.toggle(row.id, !row.enabled).subscribe({
      next: (outcome) =>
        // 'saved' applies the flip; 'proposed' leaves the row as-is but now
        // carrying the pending-proposal marker — both are the outcome record.
        this.rows.update((rows) =>
          rows.map((r) => (r.id === outcome.record.id ? outcome.record : r))
        ),
    });
  }

  protected remove(row: WorkflowRecord) {
    if (!confirm(`Delete "${row.name}"? This cannot be undone.`)) return;
    this.service.remove(row.id).subscribe({
      next: () => this.rows.update((rows) => rows.filter((r) => r.id !== row.id)),
    });
  }
}
